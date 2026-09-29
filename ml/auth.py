"""JWT auth dependency for the FastAPI ML services, matching backend/shared/jwt.ts (HS256)."""
from __future__ import annotations

import hmac
import os

import jwt
from fastapi import Header, HTTPException

from db_config import get_jwt_secret


class TokenPayload:
    def __init__(self, sub: str, role: str):
        self.sub = sub
        self.role = role


def require_auth(authorization: str = Header(default="")) -> TokenPayload:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization[len("Bearer "):]
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    sub = payload.get("sub")
    role = payload.get("role")
    # Refresh tokens share the signing key; only access tokens may call APIs.
    if payload.get("token_type") != "access" or not sub or not role:
        raise HTTPException(status_code=401, detail="Invalid token")
    return TokenPayload(sub=sub, role=role)


def require_seller(payload: TokenPayload) -> None:
    if payload.role != "seller":
        raise HTTPException(status_code=403, detail="Sellers only")


def require_admin_key(x_admin_key: str = Header(default="")) -> None:
    """Operator-only endpoints: X-Admin-Key must match ADMIN_KEY in backend/.env."""
    expected = (os.getenv("ADMIN_KEY") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503, detail="Disabled: set ADMIN_KEY in backend/.env"
        )
    if not hmac.compare_digest(x_admin_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
