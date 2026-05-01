"""Demo-grade auth: static users.json + base64 bearer tokens.

Deliberately NOT secure — tokens aren't signed, passwords are stored in
cleartext. Swap for real auth before any production use. For the reviewer-
vs-submitter persona demo it's enough to:
  - verify a username/password against users.json
  - hand out a token the frontend sends back on every request
  - resolve (token) → (user, role) on each API call
  - let routes require a specific role via FastAPI Depends

Token format: base64("<username>|<role>|<issued_at>"). Never expires.
"""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException


_USERS_PATH = Path(__file__).resolve().parent.parent / "users.json"
_VALID_ROLES = {"submitter", "reviewer"}


def _load_users() -> list[dict[str, Any]]:
    """Read users.json from disk on every call so edits take effect without a
    restart. Returns [] if the file is missing or malformed."""
    try:
        raw = _USERS_PATH.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _find_user(username: str) -> dict[str, Any] | None:
    if not username:
        return None
    for u in _load_users():
        if u.get("username") == username:
            return u
    return None


# ─── Token helpers ────────────────────────────────────────────────────────

def issue_token(user: dict) -> str:
    """Base64-encode username|role|issued_at. Not signed — anyone who has
    the token can impersonate. Demo only."""
    raw = f"{user['username']}|{user['role']}|{int(time.time())}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_token(token: str) -> dict[str, Any] | None:
    """Return {username, role, issued_at} or None if the token is malformed
    or the user no longer exists in users.json."""
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
    except Exception:
        return None
    parts = raw.split("|")
    if len(parts) != 3:
        return None
    username, role, issued_at = parts
    if role not in _VALID_ROLES:
        return None
    user = _find_user(username)
    if user is None or user.get("role") != role:
        # Role changed in users.json (or user removed) → invalidate the token
        return None
    return {
        "username": username,
        "role": role,
        "display_name": user.get("display_name") or username,
        "issued_at": int(issued_at) if issued_at.isdigit() else 0,
    }


# ─── Login ────────────────────────────────────────────────────────────────

def authenticate(username: str, password: str) -> dict | None:
    """Plaintext compare against users.json. Demo only."""
    user = _find_user(username)
    if user is None:
        return None
    if user.get("password") != password:
        return None
    role = user.get("role")
    if role not in _VALID_ROLES:
        return None
    return user


# ─── FastAPI dependencies ─────────────────────────────────────────────────

def current_user(authorization: str | None = Header(default=None)) -> dict:
    """Require a valid bearer token on the request. Raises 401 otherwise."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    info = decode_token(token)
    if info is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return info


def require_role(role: str):
    """FastAPI dependency factory — use as `user = Depends(require_role("reviewer"))`.

    The returned dependency asserts a valid token AND the role matches.
    Returns the user dict on success, raises 403 otherwise."""
    if role not in _VALID_ROLES:
        raise ValueError(f"Unknown role: {role}")

    def _dep(authorization: str | None = Header(default=None)) -> dict:
        user = current_user(authorization)
        if user["role"] != role:
            raise HTTPException(
                status_code=403,
                detail=f"This action requires the '{role}' role",
            )
        return user

    return _dep
