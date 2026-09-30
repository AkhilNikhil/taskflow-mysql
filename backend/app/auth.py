import os
from flask import Blueprint, request, jsonify, g
from app import db
from app.models import User, TeamMember
from app.authz import auth_required, get_token_from_header, ROOT_ARCHITECT_EMAIL
from app.jwt_verifier import create_access_token, verify_jwt_token, AuthError

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/register", methods=["POST"])
def register():
    """
    Registers a new user with email, password, and optional display_name.
    Issues an immediate JWT token upon registration without requiring email confirmation.
    Only the configured ROOT_ARCHITECT_EMAIL receives the ARCHITECT system role.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip() or None

    if not email or "@" not in email:
        return jsonify({"message": "A valid email address is required"}), 400

    if not password or len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters long"}), 400

    existing_user = User.query.filter(db.func.lower(User.email) == email).first()
    if existing_user:
        return jsonify({"message": "An account with this email already exists"}), 409

    # Strict role assignment: Only explicit ROOT_ARCHITECT_EMAIL is promoted to ARCHITECT
    is_root = (email == ROOT_ARCHITECT_EMAIL)
    system_role = "ARCHITECT" if is_root else "USER"

    user = User(
        email=email,
        display_name=display_name or email.split("@")[0],
        system_role=system_role,
        account_status="ACTIVE",
    )
    user.set_password(password)

    try:
        db.session.add(user)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Registration failed: {str(e)}"}), 500

    token = create_access_token(user)
    return jsonify({
        "message": "User registered successfully",
        "token": token,
        "user": user.to_dict()
    }), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    """
    Authenticates user credentials and issues a signed JWT access token.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    user = User.query.filter(db.func.lower(User.email) == email).first()
    if not user or not user.check_password(password):
        return jsonify({"message": "Invalid email or password"}), 401

    if user.account_status in ("DISABLED", "SUSPENDED"):
        return jsonify({"message": f"Account is {user.account_status.lower()}"}), 403

    if user.email and user.email.strip().lower() == ROOT_ARCHITECT_EMAIL and user.system_role != "ARCHITECT":
        user.system_role = "ARCHITECT"
        db.session.commit()

    token = create_access_token(user)
    return jsonify({
        "message": "Login successful",
        "token": token,
        "user": user.to_dict()
    }), 200


@auth_bp.route("/me", methods=["GET"])
@auth_required
def get_current_user_profile():
    """
    Returns the currently authenticated user's profile and active team memberships.
    """
    user = g.current_user
    if user.email and user.email.strip().lower() == ROOT_ARCHITECT_EMAIL and user.system_role != "ARCHITECT":
        user.system_role = "ARCHITECT"
        db.session.commit()

    user_dict = user.to_dict()
    user_dict["teams"] = [
        {
            "team_id": str(m.team_id),
            "team_name": m.team.name if m.team else None,
            "team_role": m.team_role,
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
        }
        for m in user.team_memberships
    ]
    return jsonify({"user": user_dict}), 200


@auth_bp.route("/sync", methods=["POST"])
def sync_user_profile():
    """
    Compatibility endpoint for profile synchronization.
    """
    token = get_token_from_header()
    if not token:
        return jsonify({"message": "Authorization header missing or invalid"}), 401

    try:
        payload = verify_jwt_token(token)
    except AuthError as e:
        return jsonify({"message": e.message}), e.status_code

    user_id = payload.get("sub")
    user = db.session.get(User, str(user_id)) if user_id else None
    if not user:
        return jsonify({"message": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    display_name = (data.get("display_name") or "").strip() or None
    if display_name and display_name != user.display_name:
        user.display_name = display_name
        db.session.commit()

    return jsonify({"message": "User profile synchronized", "user": user.to_dict()}), 200


@auth_bp.route("/users", methods=["GET"])
@auth_required
def list_workspace_users():
    """
    Returns active workspace users.
    ARCHITECT and ADMIN see all active users; regular users see teammates + self.
    """
    current_user = g.current_user

    if current_user.system_role in ("ADMIN", "ARCHITECT"):
        users = User.query.filter_by(account_status="ACTIVE").order_by(User.email.asc()).all()
    else:
        my_team_ids = [m.team_id for m in current_user.team_memberships]
        if my_team_ids:
            teammate_user_ids = db.session.query(TeamMember.user_id).filter(
                TeamMember.team_id.in_(my_team_ids)
            ).subquery()
            users = User.query.filter(
                User.account_status == "ACTIVE",
                (User.id.in_(teammate_user_ids) | (User.id == current_user.id))
            ).order_by(User.email.asc()).all()
        else:
            users = [current_user]

    return jsonify({
        "users": [
            {"id": str(u.id), "email": u.email, "display_name": u.display_name, "system_role": u.system_role}
            for u in users
        ]
    }), 200


@auth_bp.route("/me", methods=["PUT"])
@auth_required
def update_my_profile():
    data = request.get_json(silent=True) or {}
    name = (data.get("display_name") or "").strip()
    if not name:
        return jsonify({"message": "Display name cannot be empty"}), 400
    if len(name) > 100:
        return jsonify({"message": "Display name cannot exceed 100 characters"}), 400

    g.current_user.display_name = name
    db.session.commit()
    return jsonify({"message": "Profile updated", "user": g.current_user.to_dict()}), 200


@auth_bp.route("/update-password", methods=["PUT"])
@auth_required
def update_my_password():
    data = request.get_json(silent=True) or {}
    new_password = data.get("password") or ""
    if not new_password or len(new_password) < 6:
        return jsonify({"message": "Password must be at least 6 characters long"}), 400

    g.current_user.set_password(new_password)
    db.session.commit()
    return jsonify({"message": "Password updated successfully"}), 200