import os
import jwt
from datetime import datetime, timedelta, timezone

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is not set. A secure secret is required.")

JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_DAYS = 7


class AuthError(Exception):
    def __init__(self, message, status_code=401):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def create_access_token(user):
    """
    Generates a signed JWT access token containing user identity and role claims.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.system_role,
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRATION_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt_token(token):
    """
    Decodes and validates a standard HS256 JWT access token.
    """
    if not token:
        raise AuthError("Token is missing", 401)

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthError("Token has expired", 401)
    except jwt.InvalidTokenError as e:
        raise AuthError(f"Invalid token: {str(e)}", 401)
