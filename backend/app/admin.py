from flask import Blueprint, jsonify, request, g
from app import db
from app.models import User, Team, TeamMember, Task
from app.authz import (
    auth_required, architect_required, ROOT_ARCHITECT_EMAIL,
    SYSTEM_ROLE_ADMIN, SYSTEM_ROLE_USER,
)

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@admin_bp.route("/users", methods=["GET"])
@auth_required
@architect_required
def list_users():
    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify({
        "users": [
            {
                "id": str(u.id),
                "email": u.email,
                "display_name": u.display_name,
                "system_role": u.system_role,
                "account_status": u.account_status,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ],
        "total": len(users),
    }), 200


@admin_bp.route("/users/<user_id>/role", methods=["PUT"])
@auth_required
@architect_required
def update_user_system_role(user_id):
    """Promote or demote between USER and ADMIN roles."""
    target = db.session.get(User, str(user_id))
    if not target:
        return jsonify({"message": "User not found"}), 404

    if target.id == g.current_user.id:
        return jsonify({"message": "Architect cannot alter their own system role"}), 400

    if target.email and target.email.strip().lower() == ROOT_ARCHITECT_EMAIL:
        return jsonify({"message": "The root Architect role cannot be changed"}), 400

    data = request.get_json(silent=True) or {}
    new_role = (data.get("system_role") or "").strip().upper()
    if new_role not in (SYSTEM_ROLE_USER, SYSTEM_ROLE_ADMIN):
        return jsonify({"message": "Invalid system_role. Must be USER or ADMIN"}), 400

    target.system_role = new_role
    db.session.commit()
    return jsonify({"message": f"Updated {target.email} role to {new_role}", "user": target.to_dict()}), 200


@admin_bp.route("/users/<user_id>/status", methods=["PUT"])
@auth_required
@architect_required
def update_user_status(user_id):
    target = db.session.get(User, str(user_id))
    if not target:
        return jsonify({"message": "User not found"}), 404

    if target.id == g.current_user.id:
        return jsonify({"message": "Architect cannot alter their own account status"}), 400

    if target.email and target.email.strip().lower() == ROOT_ARCHITECT_EMAIL:
        return jsonify({"message": "The root Architect account cannot be suspended"}), 400

    data = request.get_json(silent=True) or {}
    new_status = (data.get("account_status") or "").strip().upper()
    if new_status not in ("ACTIVE", "SUSPENDED", "DISABLED"):
        return jsonify({"message": "Invalid account_status. Must be ACTIVE, SUSPENDED or DISABLED"}), 400

    target.account_status = new_status
    db.session.commit()
    return jsonify({"message": f"Updated {target.email} status to {new_status}", "user": target.to_dict()}), 200


def _purge_user_rows(uid):
    """Detach or remove all foreign-key references to user, then delete the user row."""
    uid_str = str(uid)
    led_team_ids = [m.team_id for m in TeamMember.query.filter_by(user_id=uid_str, team_role="LEADER").all()]

    # Clear references in tasks and teams
    Task.query.filter_by(created_by=uid_str).update({"created_by": None}, synchronize_session=False)
    Task.query.filter_by(assigned_user_id=uid_str).update({"assigned_user_id": None}, synchronize_session=False)
    Task.query.filter_by(owner_user_id=uid_str).update({"owner_user_id": None}, synchronize_session=False)
    Team.query.filter_by(created_by=uid_str).update({"created_by": None}, synchronize_session=False)

    # Delete team memberships
    TeamMember.query.filter_by(user_id=uid_str).delete(synchronize_session=False)

    # Re-elect a leader for teams where this user was the leader
    for tid in led_team_ids:
        if not TeamMember.query.filter_by(team_id=tid, team_role="LEADER").first():
            nxt = TeamMember.query.filter_by(team_id=tid).order_by(TeamMember.joined_at.asc()).first()
            if nxt:
                nxt.team_role = "LEADER"

    db.session.query(User).filter(User.id == uid_str).delete(synchronize_session=False)


@admin_bp.route("/users/<user_id>", methods=["DELETE"])
@auth_required
@architect_required
def delete_user(user_id):
    target = db.session.get(User, str(user_id))
    if not target:
        return jsonify({"message": "User not found"}), 404

    if target.id == g.current_user.id:
        return jsonify({"message": "Architect cannot delete their own account"}), 400

    if target.email and target.email.strip().lower() == ROOT_ARCHITECT_EMAIL:
        return jsonify({"message": "The root Architect account cannot be deleted"}), 400

    try:
        email = target.email
        _purge_user_rows(str(target.id))
        db.session.commit()
        return jsonify({"message": f"User {email} deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Failed to delete user: {str(e)}"}), 500
