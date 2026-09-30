from flask import Blueprint, request, jsonify, g
from app import db
from app.models import Team, TeamMember, User, Task
from app.authz import (
    auth_required, is_team_leader,
    SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN,
    TEAM_ROLE_LEADER, TEAM_ROLE_MEMBER,
)

teams_bp = Blueprint("teams", __name__, url_prefix="/api/teams")


def _is_privileged():
    return g.current_user.system_role in (SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN)


def _leader_count(team_id):
    return TeamMember.query.filter_by(team_id=str(team_id), team_role=TEAM_ROLE_LEADER).count()


def _name_taken(name, exclude_id=None):
    q = Team.query.filter(db.func.lower(Team.name) == name.lower())
    if exclude_id:
        q = q.filter(Team.id != str(exclude_id))
    return q.first() is not None


@teams_bp.route("", methods=["POST"])
@auth_required
def create_team():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip() or None

    if not name:
        return jsonify({"message": "Team name is required"}), 400
    if len(name) > 100:
        return jsonify({"message": "Team name cannot exceed 100 characters"}), 400
    if _name_taken(name):
        return jsonify({"message": f"Team with name '{name}' already exists"}), 409

    team = Team(name=name, description=description, created_by=g.current_user.id, active_status="ACTIVE")
    db.session.add(team)
    db.session.flush()

    db.session.add(TeamMember(team_id=team.id, user_id=g.current_user.id, team_role=TEAM_ROLE_LEADER))
    db.session.commit()

    team_data = team.to_dict()
    team_data["my_role"] = TEAM_ROLE_LEADER
    team_data["member_count"] = 1
    return jsonify({"message": "Team created successfully", "team": team_data}), 201


@teams_bp.route("", methods=["GET"])
@auth_required
def list_teams():
    show_all = request.args.get("all", "true").lower() != "false"
    role_by_team = {m.team_id: m.team_role for m in g.current_user.team_memberships}

    if show_all and _is_privileged():
        teams = Team.query.order_by(Team.created_at.desc()).all()
    elif role_by_team:
        teams = Team.query.filter(Team.id.in_(list(role_by_team))).order_by(Team.created_at.desc()).all()
    else:
        teams = []

    counts = dict(
        db.session.query(TeamMember.team_id, db.func.count(TeamMember.id)).group_by(TeamMember.team_id).all()
    )

    members_by_team = {}
    if teams:
        team_ids = [t.id for t in teams]
        memberships = TeamMember.query.filter(TeamMember.team_id.in_(team_ids)).all()
        for m in memberships:
            if m.team_id not in members_by_team:
                members_by_team[m.team_id] = []
            u = m.user
            members_by_team[m.team_id].append({
                "id": str(m.id),
                "user_id": str(m.user_id),
                "team_role": m.team_role,
                "email": u.email if u else None,
                "display_name": u.display_name if u else None,
            })

    result = []
    for t in teams:
        td = t.to_dict()
        td["my_role"] = role_by_team.get(t.id)
        td["member_count"] = counts.get(t.id, 0)
        td["members"] = members_by_team.get(t.id, [])
        result.append(td)

    return jsonify({"teams": result, "total": len(result)}), 200


@teams_bp.route("/<team_id>", methods=["GET"])
@auth_required
def get_team(team_id):
    team = db.session.get(Team, str(team_id))
    if not team:
        return jsonify({"message": "Team not found"}), 404

    membership = TeamMember.query.filter_by(team_id=team.id, user_id=g.current_user.id).first()
    if not _is_privileged() and not membership:
        return jsonify({"message": "Forbidden: You are not a member of this team"}), 403

    team_data = team.to_dict()
    team_data["my_role"] = membership.team_role if membership else None
    team_data["members"] = [
        {
            "id": str(m.id),
            "user_id": str(m.user_id),
            "team_role": m.team_role,
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            "email": m.user.email if m.user else None,
            "display_name": m.user.display_name if m.user else None,
        }
        for m in team.members
    ]
    team_data["member_count"] = len(team_data["members"])
    return jsonify({"team": team_data}), 200


@teams_bp.route("/<team_id>", methods=["PUT"])
@auth_required
def update_team(team_id):
    team = db.session.get(Team, str(team_id))
    if not team:
        return jsonify({"message": "Team not found"}), 404

    if not _is_privileged() and not is_team_leader(g.current_user.id, team.id):
        return jsonify({"message": "Forbidden: Only team leaders and administrators can update team details"}), 403

    data = request.get_json(silent=True) or {}
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            return jsonify({"message": "Team name cannot be empty"}), 400
        if len(name) > 100:
            return jsonify({"message": "Team name cannot exceed 100 characters"}), 400
        if _name_taken(name, exclude_id=team.id):
            return jsonify({"message": f"Team with name '{name}' already exists"}), 409
        team.name = name

    if "description" in data:
        team.description = (data["description"] or "").strip() or None

    db.session.commit()
    return jsonify({"message": "Team updated successfully", "team": team.to_dict()}), 200


@teams_bp.route("/<team_id>", methods=["DELETE"])
@auth_required
def delete_team(team_id):
    team = db.session.get(Team, str(team_id))
    if not team:
        return jsonify({"message": "Team not found"}), 404

    if not _is_privileged() and not is_team_leader(g.current_user.id, team.id):
        return jsonify({"message": "Forbidden: Only team leaders and administrators can delete a team"}), 403

    try:
        # Assigned tasks survive and become unassigned personal tasks
        for t in Task.query.filter_by(assigned_team_id=team.id).all():
            t.assigned_team_id = None
            if not t.owner_user_id and not t.assigned_user_id:
                t.owner_user_id = t.created_by

        db.session.delete(team)  # TeamMember records cascade delete
        db.session.commit()
        return jsonify({"message": "Team deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Failed to delete team: {str(e)}"}), 500


@teams_bp.route("/<team_id>/members", methods=["POST"])
@auth_required
def add_team_member(team_id):
    team = db.session.get(Team, str(team_id))
    if not team:
        return jsonify({"message": "Team not found"}), 404

    if not _is_privileged() and not is_team_leader(g.current_user.id, team.id):
        return jsonify({"message": "Forbidden: Only team leaders and administrators can manage members"}), 403

    data = request.get_json(silent=True) or {}
    target_user_id = data.get("user_id")
    target_email = data.get("email")
    role = (data.get("team_role") or TEAM_ROLE_MEMBER).upper()

    if role not in (TEAM_ROLE_LEADER, TEAM_ROLE_MEMBER):
        return jsonify({"message": f"Invalid team_role. Must be {TEAM_ROLE_LEADER} or {TEAM_ROLE_MEMBER}"}), 400

    target_user = None
    if target_user_id:
        target_user = db.session.get(User, str(target_user_id))
    elif target_email:
        clean_email = str(target_email).strip().lower()
        target_user = User.query.filter(db.func.lower(User.email) == clean_email).first()

    if not target_user:
        return jsonify({"message": "User was not found. Please ensure they have registered an account."}), 404

    if target_user.account_status in ("DISABLED", "SUSPENDED"):
        return jsonify({"message": f"Cannot add a {target_user.account_status.lower()} user to a team"}), 400

    existing = TeamMember.query.filter_by(team_id=team.id, user_id=target_user.id).first()
    if existing:
        if existing.team_role == role:
            return jsonify({"message": "User already has this role", "membership": existing.to_dict()}), 200

        # Last leader guard
        if existing.team_role == TEAM_ROLE_LEADER and role == TEAM_ROLE_MEMBER and _leader_count(team.id) <= 1:
            return jsonify({"message": "A team must keep at least one leader. Promote someone else first."}), 400

        existing.team_role = role
        db.session.commit()
        return jsonify({"message": f"Updated member role to {role}", "membership": existing.to_dict()}), 200

    new_member = TeamMember(team_id=team.id, user_id=target_user.id, team_role=role)
    db.session.add(new_member)
    db.session.commit()
    return jsonify({"message": f"User added to team as {role}", "membership": new_member.to_dict()}), 201


@teams_bp.route("/<team_id>/members/<user_id>", methods=["DELETE"])
@auth_required
def remove_team_member(team_id, user_id):
    team = db.session.get(Team, str(team_id))
    if not team:
        return jsonify({"message": "Team not found"}), 404

    is_self = g.current_user.id == str(user_id)
    privileged = _is_privileged()

    if not is_self and not privileged and not is_team_leader(g.current_user.id, team.id):
        return jsonify({"message": "Forbidden: Insufficient permissions to remove this member"}), 403

    membership = TeamMember.query.filter_by(team_id=team.id, user_id=str(user_id)).first()
    if not membership:
        return jsonify({"message": "Membership record not found"}), 404

    if membership.team_role == TEAM_ROLE_LEADER:
        if not is_self and not privileged:
            return jsonify({"message": "Only administrators can remove another team leader"}), 403

        others = TeamMember.query.filter_by(team_id=team.id).count() - 1
        if _leader_count(team.id) <= 1 and others > 0:
            return jsonify({"message": "Promote another member to leader before removing the last leader"}), 400

    db.session.delete(membership)
    db.session.commit()
    return jsonify({"message": "Member removed from team successfully"}), 200
