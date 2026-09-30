import uuid
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from app import db


def utc_now():
    """Returns the current UTC timestamp with timezone awareness."""
    return datetime.now(timezone.utc)


def generate_uuid():
    """Generates standard 36-character UUID string for MySQL compatibility."""
    return str(uuid.uuid4())


class User(db.Model):
    """
    Application user profile with native password hashing via Werkzeug (PBKDF2-SHA256).
    """
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(100), nullable=True)
    system_role = db.Column(
        db.String(20),
        nullable=False,
        default="USER",
        index=True
    )
    account_status = db.Column(
        db.String(20),
        nullable=False,
        default="ACTIVE",
        index=True
    )
    created_at = db.Column(
        db.DateTime,
        default=utc_now,
        nullable=False
    )
    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False
    )

    team_memberships = db.relationship(
        "TeamMember",
        backref="user",
        lazy=True,
        cascade="all, delete-orphan",
        foreign_keys="TeamMember.user_id"
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": str(self.id),
            "email": self.email,
            "display_name": self.display_name,
            "system_role": self.system_role,
            "account_status": self.account_status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Team(db.Model):
    """
    Organizational team workspace.
    """
    __tablename__ = "teams"

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    name = db.Column(db.String(100), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    active_status = db.Column(
        db.String(20),
        nullable=False,
        default="ACTIVE",
        index=True
    )
    created_by = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    created_at = db.Column(
        db.DateTime,
        default=utc_now,
        nullable=False
    )
    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False
    )

    members = db.relationship(
        "TeamMember",
        backref="team",
        lazy=True,
        cascade="all, delete-orphan",
        foreign_keys="TeamMember.team_id"
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "name": self.name,
            "description": self.description,
            "active_status": self.active_status,
            "created_by": str(self.created_by) if self.created_by else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TeamMember(db.Model):
    """
    Junction table mapping users to teams with role assignments.
    """
    __tablename__ = "team_members"
    __table_args__ = (
        db.UniqueConstraint("team_id", "user_id", name="uq_team_member"),
    )

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    team_id = db.Column(
        db.String(36),
        db.ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    team_role = db.Column(
        db.String(20),
        nullable=False,
        default="MEMBER",
        index=True
    )
    joined_at = db.Column(
        db.DateTime,
        default=utc_now,
        nullable=False
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "team_id": str(self.team_id),
            "user_id": str(self.user_id),
            "team_role": self.team_role,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
        }


class Task(db.Model):
    """
    Task management entity supporting personal and team ownership.
    """
    __tablename__ = "tasks"

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    priority = db.Column(
        db.String(20),
        nullable=False,
        default="MEDIUM",
        index=True
    )
    status = db.Column(
        db.String(20),
        nullable=False,
        default="PENDING",
        index=True
    )
    created_by = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    assigned_user_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    assigned_team_id = db.Column(
        db.String(36),
        db.ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    owner_user_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    due_date = db.Column(db.Date, nullable=True, index=True)
    created_at = db.Column(
        db.DateTime,
        default=utc_now,
        nullable=False
    )
    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "status": self.status,
            "created_by": str(self.created_by) if self.created_by else None,
            "assigned_user_id": str(self.assigned_user_id) if self.assigned_user_id else None,
            "assigned_team_id": str(self.assigned_team_id) if self.assigned_team_id else None,
            "owner_user_id": str(self.owner_user_id) if self.owner_user_id else None,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }