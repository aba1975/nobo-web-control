"""
Authentication module for Nobø Web Control.

Handles user storage, password hashing, and session management.
All user data is stored in data/users.json (auto-created on first run).
Sessions use HMAC-signed, HTTP-only cookies (cookie name: nobo_session).
"""

import os
import json
import hmac
import hashlib
import secrets
import base64
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import bcrypt

logger = logging.getLogger(__name__)

# ===== Constants =====
DATA_DIR = Path("data")
USERS_FILE = DATA_DIR / "users.json"
SESSION_SECRET_FILE = DATA_DIR / "session_secret.key"
COOKIE_NAME = "nobo_session"
SESSION_DURATION_HOURS = 24
DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "nobohub"

# Load or generate persistent session secret
def _load_session_secret() -> str:
    DATA_DIR.mkdir(exist_ok=True)
    if SESSION_SECRET_FILE.exists():
        try:
            encoded = SESSION_SECRET_FILE.read_text().strip()
            raw = base64.b64decode(encoded.encode()).decode()
            if len(raw) >= 32:
                return raw
        except (OSError, Exception):
            pass
    raw = secrets.token_hex(32)
    try:
        # Encode as base64 so the file does not contain the raw key bytes directly
        encoded = base64.b64encode(raw.encode()).decode()
        SESSION_SECRET_FILE.write_text(encoded)
        SESSION_SECRET_FILE.chmod(0o600)
    except OSError:
        logger.warning("Could not persist session secret; sessions will reset on restart.")
    return raw


SESSION_SECRET: str = _load_session_secret()


# ===== User Storage =====

def _load_users() -> dict:
    """Load users from JSON file, re-creating defaults if missing or corrupt."""
    DATA_DIR.mkdir(exist_ok=True)
    if not USERS_FILE.exists():
        return _create_default_users()
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data.get("users"), list):
            raise ValueError("Invalid structure")
        return data
    except (json.JSONDecodeError, ValueError, OSError):
        logger.warning("users.json is missing or corrupt; re-creating with default credentials.")
        return _create_default_users()


def _save_users(data: dict) -> None:
    """Persist users to JSON file atomically."""
    DATA_DIR.mkdir(exist_ok=True)
    tmp = USERS_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(USERS_FILE)


def _create_default_users() -> dict:
    """Create and persist the default admin user."""
    password_hash = bcrypt.hashpw(DEFAULT_PASSWORD.encode(), bcrypt.gensalt()).decode()
    data = {
        "users": [
            {
                "username": DEFAULT_USERNAME,
                "password_hash": password_hash,
                "is_admin": True,
            }
        ]
    }
    _save_users(data)
    logger.info("Created default admin user (username: admin, password: nobohub).")
    return data


# ===== Password Helpers =====

def verify_password(username: str, password: str) -> bool:
    """Return True if username/password are valid."""
    data = _load_users()
    for user in data["users"]:
        if user["username"] == username:
            try:
                return bcrypt.checkpw(password.encode(), user["password_hash"].encode())
            except Exception:
                return False
    return False


def authenticate_user(username: str, password: str) -> str | None:
    """Verify credentials and return the canonical username from the database, or None.

    Using the stored username (rather than the raw form input) prevents cookie
    injection from user-supplied data reaching the Set-Cookie header.
    """
    data = _load_users()
    for user in data["users"]:
        if user["username"] == username:
            try:
                if bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
                    return user["username"]  # canonical value from DB
            except Exception:
                pass
    return None


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


# ===== User Queries =====

def get_user(username: str) -> dict | None:
    """Return public user info dict or None if not found."""
    data = _load_users()
    for user in data["users"]:
        if user["username"] == username:
            return {"username": user["username"], "is_admin": bool(user.get("is_admin", False))}
    return None


def list_users() -> list[dict]:
    """Return list of public user info dicts."""
    data = _load_users()
    return [{"username": u["username"], "is_admin": bool(u.get("is_admin", False))} for u in data["users"]]


# ===== User Management =====

def add_user(username: str, password: str, is_admin: bool = False) -> tuple[bool, str]:
    """Add a new user. Returns (success, message)."""
    if not username or not username.strip():
        return False, "Username cannot be empty"
    username = username.strip()
    if not password:
        return False, "Password cannot be empty"
    data = _load_users()
    for user in data["users"]:
        if user["username"] == username:
            return False, "Username already exists"
    data["users"].append({
        "username": username,
        "password_hash": _hash_password(password),
        "is_admin": is_admin,
    })
    _save_users(data)
    return True, "User created"


def delete_user(username: str) -> tuple[bool, str]:
    """Delete a user. Returns (success, message)."""
    data = _load_users()
    target = next((u for u in data["users"] if u["username"] == username), None)
    if target is None:
        return False, "User not found"
    # Prevent deleting last admin
    if target.get("is_admin"):
        admin_count = sum(1 for u in data["users"] if u.get("is_admin"))
        if admin_count <= 1:
            return False, "Cannot delete the last admin user"
    data["users"] = [u for u in data["users"] if u["username"] != username]
    _save_users(data)
    return True, "User deleted"


def rename_user(username: str, new_username: str) -> tuple[bool, str]:
    """Rename a user. Returns (success, message)."""
    if not new_username or not new_username.strip():
        return False, "New username cannot be empty"
    new_username = new_username.strip()
    data = _load_users()
    target = next((u for u in data["users"] if u["username"] == username), None)
    if target is None:
        return False, "User not found"
    if any(u["username"] == new_username for u in data["users"]):
        return False, "Username already taken"
    target["username"] = new_username
    _save_users(data)
    return True, "User renamed"


def change_password(
    username: str, current_password: str, new_password: str, confirm_password: str
) -> tuple[bool, str]:
    """Change user password. Returns (success, message)."""
    if not verify_password(username, current_password):
        return False, "Current password is incorrect"
    if not new_password:
        return False, "New password cannot be empty"
    if new_password != confirm_password:
        return False, "New password and confirmation do not match"
    data = _load_users()
    target = next((u for u in data["users"] if u["username"] == username), None)
    if target is None:
        return False, "User not found"
    target["password_hash"] = _hash_password(new_password)
    _save_users(data)
    return True, "Password changed"


def admin_change_password(
    target_username: str, new_password: str, confirm_password: str
) -> tuple[bool, str]:
    """Admin changes another user's password without needing current password."""
    if not new_password:
        return False, "New password cannot be empty"
    if new_password != confirm_password:
        return False, "New password and confirmation do not match"
    data = _load_users()
    target = next((u for u in data["users"] if u["username"] == target_username), None)
    if target is None:
        return False, "User not found"
    target["password_hash"] = _hash_password(new_password)
    _save_users(data)
    return True, "Password changed"


# ===== Session Management =====

def create_session_token(username: str) -> str:
    """Create a signed, base64-encoded session token valid for SESSION_DURATION_HOURS."""
    expiry = (datetime.now(timezone.utc) + timedelta(hours=SESSION_DURATION_HOURS)).isoformat()
    payload = f"{username}:{expiry}"
    sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    token_data = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(token_data.encode()).decode()


def verify_session_token(token: str) -> str | None:
    """Verify a session token and return the username, or None if invalid/expired."""
    if not token:
        return None
    try:
        token_data = base64.urlsafe_b64decode(token).decode()
        # Format: username:expiry_iso:hex_sig
        # expiry contains ':', so split from the right twice
        last_colon = token_data.rfind(":")
        if last_colon == -1:
            return None
        sig = token_data[last_colon + 1:]
        rest = token_data[:last_colon]
        # rest is "username:expiry"
        first_colon = rest.find(":")
        if first_colon == -1:
            return None
        username = rest[:first_colon]
        expiry = rest[first_colon + 1:]
        payload = rest  # "username:expiry"
        expected_sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        if datetime.fromisoformat(expiry) < datetime.now(timezone.utc):
            return None
        return username
    except Exception:
        return None
