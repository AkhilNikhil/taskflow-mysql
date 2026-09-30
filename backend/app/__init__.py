import os
from dotenv import load_dotenv, find_dotenv
from flask import Flask, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy import text

load_dotenv(find_dotenv())

db = SQLAlchemy()


def _sync_schema(app):
    """Wait for MySQL to be ready and serialize table creation across workers with GET_LOCK."""
    import time
    with app.app_context():
        from app import models  # noqa: F401
        for attempt in range(15):
            try:
                with db.engine.connect() as conn:
                    conn.execute(text("SELECT GET_LOCK('taskflow_schema_lock', 60)"))
                    try:
                        db.create_all()
                        app.logger.info("Database tables initialized successfully via db.create_all().")
                        return
                    finally:
                        conn.execute(text("SELECT RELEASE_LOCK('taskflow_schema_lock')"))
            except Exception as e:
                app.logger.warning(f"Database schema auto-sync attempt {attempt + 1}/15: {e}")
                time.sleep(2)
        app.logger.error("Failed to initialize database tables after 15 attempts.")


def create_app():
    app = Flask(__name__)

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    if not os.getenv("ROOT_ARCHITECT_EMAIL"):
        raise RuntimeError(
            "ROOT_ARCHITECT_EMAIL environment variable is not set. "
            "Set it to the email that should become the super-admin (Architect) on signup."
        )

    if not os.getenv("JWT_SECRET"):
        raise RuntimeError(
            "JWT_SECRET environment variable is not set. "
            "A strong JWT secret is required to secure stateless authentication."
        )

    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 300}

    db.init_app(app)

    origins = [o.strip() for o in (os.getenv("CORS_ORIGINS") or os.getenv("FRONTEND_URL") or "").split(",") if o.strip()]
    CORS(app, origins=origins or "*")

    _sync_schema(app)

    from app.auth import auth_bp
    from app.teams import teams_bp
    from app.tasks import tasks_bp
    from app.admin import admin_bp

    for bp in (auth_bp, teams_bp, tasks_bp, admin_bp):
        app.register_blueprint(bp)

    @app.errorhandler(500)
    def internal_error(_e):
        db.session.rollback()
        return jsonify({"message": "Internal server error"}), 500

    @app.route("/")
    def home():
        return {"message": "TaskFlow MySQL API is running"}

    @app.route("/health")
    @app.route("/ping")
    @app.route("/api/health")
    def health():
        return {"status": "healthy"}, 200

    return app