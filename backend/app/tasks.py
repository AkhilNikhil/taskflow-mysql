import uuid
from datetime import date
from flask import Blueprint, request, jsonify, g
from sqlalchemy import or_
from app import db
from app.models import Task, Team, TeamMember, User
from app.authz import (
    auth_required,
    is_team_leader,
    is_team_member,
    SYSTEM_ROLE_ARCHITECT,
    SYSTEM_ROLE_ADMIN,
)

tasks_bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")

VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH"}
VALID_STATUSES = {"PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
MAX_BULK_LIMIT = 10


def parse_due_date(raw):
    """Returns (date | None, error | None). Accepts 'YYYY-MM-DD', empty or None."""
    if raw in (None, ""):
        return None, None
    try:
        return date.fromisoformat(str(raw)[:10]), None
    except ValueError:
        return None, "Invalid due_date. Use YYYY-MM-DD"


def format_tasks_output(tasks) -> list:
    """Batch-format tasks: pre-fetches users and teams to eliminate N+1 queries."""
    tasks = list(tasks)
    if not tasks:
        return []

    user_ids, team_ids = set(), set()
    for t in tasks:
        for uid in (t.owner_user_id, t.assigned_user_id, t.created_by):
            if uid:
                user_ids.add(str(uid))
        if t.assigned_team_id:
            team_ids.add(str(t.assigned_team_id))

    users = {str(u.id): u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    teams = {str(tm.id): tm for tm in Team.query.filter(Team.id.in_(team_ids)).all()} if team_ids else {}

    def put_person(d, prefix, uid):
        u = users.get(str(uid)) if uid else None
        d[f"{prefix}_name"] = u.display_name if u else None
        d[f"{prefix}_email"] = u.email if u else None

    result = []
    for t in tasks:
        d = t.to_dict()
        team = teams.get(str(t.assigned_team_id)) if t.assigned_team_id else None
        d["assigned_team_name"] = team.name if team else None
        put_person(d, "owner", t.owner_user_id)
        put_person(d, "assigned_user", t.assigned_user_id)
        put_person(d, "created_by", t.created_by)
        result.append(d)
    return result


def format_task_output(task: Task) -> dict:
    return format_tasks_output([task])[0]


@tasks_bp.route("", methods=["GET"])
@auth_required
def list_tasks():
    is_privileged = g.current_user.system_role in (SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN)
    user_team_ids = [m.team_id for m in g.current_user.team_memberships]

    query = Task.query

    if not is_privileged:
        conditions = [
            Task.created_by == g.current_user.id,
            Task.assigned_user_id == g.current_user.id,
            Task.owner_user_id == g.current_user.id,
        ]
        if user_team_ids:
            conditions.append(Task.assigned_team_id.in_(user_team_ids))
        query = query.filter(or_(*conditions))

    status_filter = request.args.get("status")
    if status_filter and status_filter.upper() in VALID_STATUSES:
        query = query.filter_by(status=status_filter.upper())

    priority_filter = request.args.get("priority")
    if priority_filter and priority_filter.upper() in VALID_PRIORITIES:
        query = query.filter_by(priority=priority_filter.upper())

    team_id_filter = request.args.get("team_id")
    if team_id_filter:
        query = query.filter_by(assigned_team_id=str(team_id_filter).strip())

    tasks = query.order_by(Task.created_at.desc()).all()
    formatted = format_tasks_output(tasks)

    return jsonify({"tasks": formatted, "total": len(formatted)}), 200


@tasks_bp.route("/<task_id>", methods=["GET"])
@auth_required
def get_task(task_id):
    task = db.session.get(Task, str(task_id))
    if not task:
        return jsonify({"message": "Task not found"}), 404

    is_privileged = g.current_user.system_role in (SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN)
    user_team_ids = [m.team_id for m in g.current_user.team_memberships]

    can_access = (
        is_privileged
        or task.created_by == g.current_user.id
        or task.assigned_user_id == g.current_user.id
        or task.owner_user_id == g.current_user.id
        or (task.assigned_team_id and task.assigned_team_id in user_team_ids)
    )
    if not can_access:
        return jsonify({"message": "Forbidden: You do not have access to this task"}), 403

    return jsonify({"task": format_task_output(task)}), 200


@tasks_bp.route("", methods=["POST"])
@auth_required
def create_task():
    data = request.get_json(silent=True) or {}
    is_bulk = False
    if isinstance(data, list):
        is_bulk = True
        task_items = data
    elif "tasks" in data and isinstance(data["tasks"], list):
        is_bulk = True
        task_items = data["tasks"]
    else:
        task_items = [data]

    if len(task_items) > MAX_BULK_LIMIT:
        return jsonify({
            "message": f"Bulk task creation exceeds maximum limit of {MAX_BULK_LIMIT} tasks per request"
        }), 400

    if not task_items or len(task_items) == 0:
        return jsonify({"message": "No task data provided"}), 400

    created_tasks = []
    is_privileged = g.current_user.system_role in (SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN)

    for idx, item in enumerate(task_items):
        if not isinstance(item, dict):
            return jsonify({"message": f"Task at index {idx} must be an object"}), 400

        title = (item.get("title") or "").strip()
        if not title:
            return jsonify({"message": f"Task at index {idx} requires a non-empty title"}), 400

        if len(title) > 255:
            return jsonify({"message": f"Task title at index {idx} exceeds 255 characters"}), 400

        description = (item.get("description") or "").strip() or None
        priority = (item.get("priority") or "MEDIUM").upper()
        status = (item.get("status") or "PENDING").upper()

        if priority not in VALID_PRIORITIES:
            return jsonify({
                "message": f"Invalid priority '{priority}' at index {idx}. Must be one of: {', '.join(VALID_PRIORITIES)}"
            }), 400

        if status not in VALID_STATUSES:
            return jsonify({
                "message": f"Invalid status '{status}' at index {idx}. Must be one of: {', '.join(VALID_STATUSES)}"
            }), 400

        due, due_err = parse_due_date(item.get("due_date"))
        if due_err:
            return jsonify({"message": f"{due_err} (task at index {idx})"}), 400

        raw_team_id = item.get("assigned_team_id")
        raw_user_id = item.get("assigned_user_id")

        team_id_str = None
        user_id_str = None

        if raw_team_id:
            team_id_str = str(raw_team_id).strip()
            team = db.session.get(Team, team_id_str)
            if not team:
                return jsonify({"message": f"Assigned team at index {idx} does not exist"}), 404

            if not is_privileged and not is_team_member(g.current_user.id, team_id_str):
                return jsonify({
                    "message": f"Forbidden: You are not a member of team '{team.name}'"
                }), 403

        if raw_user_id:
            user_id_str = str(raw_user_id).strip()
            target_user = db.session.get(User, user_id_str)
            if not target_user:
                # Fallback: check if a TeamMember ID was submitted
                tm = db.session.get(TeamMember, user_id_str)
                if tm:
                    target_user = db.session.get(User, str(tm.user_id))
                    if target_user:
                        user_id_str = str(target_user.id)

            if not target_user:
                return jsonify({"message": f"Assigned user at index {idx} does not exist"}), 404
            if target_user.account_status in ("DISABLED", "SUSPENDED"):
                return jsonify({"message": f"Assigned user at index {idx} is {target_user.account_status.lower()}"}), 400
            if team_id_str and not is_team_member(user_id_str, team_id_str):
                return jsonify({
                    "message": f"Assigned user at index {idx} is not a member of the selected team"
                }), 400
            if not team_id_str and not is_privileged and user_id_str != g.current_user.id:
                return jsonify({
                    "message": "Personal tasks can only be assigned to yourself"
                }), 400

        new_task = Task(
            title=title,
            description=description,
            priority=priority,
            status=status,
            created_by=g.current_user.id,
            assigned_team_id=team_id_str,
            assigned_user_id=user_id_str,
            owner_user_id=user_id_str if user_id_str else (g.current_user.id if not team_id_str else None),
            due_date=due,
        )
        db.session.add(new_task)
        created_tasks.append(new_task)

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Failed to save task: {str(e)}"}), 500

    if not is_bulk:
        return jsonify({
            "message": "Task created successfully",
            "task": format_task_output(created_tasks[0])
        }), 201

    return jsonify({
        "message": f"{len(created_tasks)} tasks created successfully",
        "tasks": format_tasks_output(created_tasks)
    }), 201


@tasks_bp.route("/<task_id>", methods=["PUT"])
@auth_required
def update_task(task_id):
    task = db.session.get(Task, str(task_id))
    if not task:
        return jsonify({"message": "Task not found"}), 404

    is_privileged = g.current_user.system_role in (SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN)
    is_creator = task.created_by == g.current_user.id
    is_owner = task.owner_user_id == g.current_user.id
    is_assigned = task.assigned_user_id == g.current_user.id
    is_leader = is_team_leader(g.current_user.id, task.assigned_team_id) if task.assigned_team_id else False
    is_member = is_team_member(g.current_user.id, task.assigned_team_id) if task.assigned_team_id else False

    can_edit = is_privileged or is_creator or is_owner or is_assigned or is_leader or is_member
    if not can_edit:
        return jsonify({"message": "Forbidden: You cannot modify this task"}), 403

    data = request.get_json(silent=True) or {}

    # Handle Ownership / Claim
    if data.get("claim") is True:
        if not task.assigned_team_id:
            return jsonify({"message": "Only team tasks can be claimed by team members"}), 400
        if not is_member and not is_privileged:
            return jsonify({"message": "Forbidden: Only members of this team can claim this task"}), 403
        if task.owner_user_id and task.owner_user_id != g.current_user.id and not is_leader and not is_privileged:
            return jsonify({"message": "Task is already owned by another team member"}), 409

        task.owner_user_id = g.current_user.id
        if task.status == "PENDING":
            task.status = "IN_PROGRESS"

    elif "owner_user_id" in data:
        target_owner = data["owner_user_id"]
        if target_owner is not None:
            target_owner = str(target_owner).strip()
            if target_owner == g.current_user.id:
                if task.owner_user_id and task.owner_user_id != g.current_user.id:
                    return jsonify({"message": "Task is already owned by another team member"}), 409
            else:
                if not is_leader and not is_privileged:
                    return jsonify({"message": "Forbidden: Only team leaders can assign tasks to other members"}), 403
                if task.owner_user_id and task.owner_user_id != g.current_user.id:
                    return jsonify({"message": "Task is already owned by another team member"}), 409

            if task.assigned_team_id:
                if not is_team_member(target_owner, task.assigned_team_id):
                    return jsonify({"message": "Target owner must be a member of the assigned team"}), 400

            task.owner_user_id = target_owner
        else:
            if not is_leader and not is_privileged and not is_owner:
                return jsonify({"message": "Forbidden: Insufficient permissions to remove ownership"}), 403
            task.owner_user_id = None

    if "title" in data:
        new_title = (data["title"] or "").strip()
        if not new_title:
            return jsonify({"message": "Task title cannot be empty"}), 400
        if len(new_title) > 255:
            return jsonify({"message": "Task title exceeds 255 characters"}), 400
        task.title = new_title

    if "description" in data:
        task.description = (data["description"] or "").strip() or None

    if "priority" in data:
        new_priority = (data["priority"] or "").upper()
        if new_priority not in VALID_PRIORITIES:
            return jsonify({"message": f"Invalid priority. Must be one of: {', '.join(VALID_PRIORITIES)}"}), 400
        task.priority = new_priority

    if "due_date" in data:
        due, due_err = parse_due_date(data["due_date"])
        if due_err:
            return jsonify({"message": due_err}), 400
        task.due_date = due

    if "status" in data:
        new_status = (data["status"] or "").upper()
        if new_status not in VALID_STATUSES:
            return jsonify({"message": f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}"}), 400
        task.status = new_status

    db.session.commit()
    return jsonify({
        "message": "Task updated successfully",
        "task": format_task_output(task)
    }), 200


@tasks_bp.route("/<task_id>", methods=["DELETE"])
@auth_required
def delete_task(task_id):
    task = db.session.get(Task, str(task_id))
    if not task:
        return jsonify({"message": "Task not found"}), 404

    is_privileged = g.current_user.system_role in (SYSTEM_ROLE_ARCHITECT, SYSTEM_ROLE_ADMIN)
    is_creator = task.created_by == g.current_user.id
    is_leader = is_team_leader(g.current_user.id, task.assigned_team_id) if task.assigned_team_id else False

    if not is_privileged and not is_creator and not is_leader:
        return jsonify({"message": "Forbidden: Only creators, team leaders, or administrators can delete this task"}), 403

    db.session.delete(task)
    db.session.commit()
    return jsonify({"message": "Task deleted successfully"}), 200
