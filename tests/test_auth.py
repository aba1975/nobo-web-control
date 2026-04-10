"""
Tests for the authentication layer (auth.py + /login, /logout, /auth/* routes).
All tests run with NOBO_DEMO=true so no real hub is required.
"""

import os
import json
import shutil
import tempfile

os.environ.setdefault("NOBO_DEMO", "true")

import pytest
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_data_dir(monkeypatch, tmp_path):
    """Redirect auth's DATA_DIR / USERS_FILE to a temporary directory for every test."""
    import auth
    monkeypatch.setattr(auth, "DATA_DIR", tmp_path)
    monkeypatch.setattr(auth, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setattr(auth, "SESSION_SECRET_FILE", tmp_path / "session_secret.key")
    # Re-generate a fresh session secret for each test
    monkeypatch.setattr(auth, "SESSION_SECRET", "test-secret-key-for-unit-tests-only")
    yield


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    import server
    return TestClient(server.app, raise_server_exceptions=True)


@pytest.fixture
def auth_client(client):
    """TestClient that is already logged in as admin."""
    resp = client.post(
        "/login",
        data={"username": "admin", "password": "nobohub"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    return client


# ---------------------------------------------------------------------------
# auth.py unit tests
# ---------------------------------------------------------------------------

class TestAuthModule:
    def test_default_user_created(self):
        import auth
        data = auth._load_users()
        assert len(data["users"]) == 1
        user = data["users"][0]
        assert user["username"] == "admin"
        assert user["is_admin"] is True

    def test_verify_password_correct(self):
        import auth
        auth._load_users()  # ensure default user exists
        assert auth.verify_password("admin", "nobohub") is True

    def test_verify_password_wrong(self):
        import auth
        auth._load_users()
        assert auth.verify_password("admin", "wrongpassword") is False

    def test_verify_password_unknown_user(self):
        import auth
        assert auth.verify_password("nobody", "nobohub") is False

    def test_get_user_returns_public_info(self):
        import auth
        auth._load_users()
        user = auth.get_user("admin")
        assert user is not None
        assert user["username"] == "admin"
        assert user["is_admin"] is True
        assert "password_hash" not in user

    def test_get_user_unknown_returns_none(self):
        import auth
        auth._load_users()
        assert auth.get_user("nobody") is None

    def test_add_user_success(self):
        import auth
        auth._load_users()
        ok, msg = auth.add_user("alice", "secret123")
        assert ok is True
        assert auth.verify_password("alice", "secret123") is True

    def test_add_user_duplicate_fails(self):
        import auth
        auth._load_users()
        auth.add_user("alice", "pw1")
        ok, msg = auth.add_user("alice", "pw2")
        assert ok is False
        assert "already exists" in msg

    def test_add_user_empty_username_fails(self):
        import auth
        auth._load_users()
        ok, msg = auth.add_user("", "password")
        assert ok is False

    def test_delete_user_success(self):
        import auth
        auth._load_users()
        auth.add_user("bob", "pw")
        ok, msg = auth.delete_user("bob")
        assert ok is True
        assert auth.get_user("bob") is None

    def test_delete_last_admin_fails(self):
        import auth
        auth._load_users()
        ok, msg = auth.delete_user("admin")
        assert ok is False
        assert "last admin" in msg

    def test_rename_user_success(self):
        import auth
        auth._load_users()
        ok, msg = auth.rename_user("admin", "superadmin")
        assert ok is True
        assert auth.get_user("superadmin") is not None
        assert auth.get_user("admin") is None

    def test_rename_to_existing_name_fails(self):
        import auth
        auth._load_users()
        auth.add_user("alice", "pw")
        ok, msg = auth.rename_user("admin", "alice")
        assert ok is False
        assert "already taken" in msg

    def test_change_password_success(self):
        import auth
        auth._load_users()
        ok, msg = auth.change_password("admin", "nobohub", "newpass", "newpass")
        assert ok is True
        assert auth.verify_password("admin", "newpass") is True

    def test_change_password_wrong_current(self):
        import auth
        auth._load_users()
        ok, msg = auth.change_password("admin", "wrong", "newpass", "newpass")
        assert ok is False

    def test_change_password_mismatch(self):
        import auth
        auth._load_users()
        ok, msg = auth.change_password("admin", "nobohub", "a", "b")
        assert ok is False
        assert "do not match" in msg

    def test_session_token_roundtrip(self):
        import auth
        token = auth.create_session_token("admin")
        username = auth.verify_session_token(token)
        assert username == "admin"

    def test_session_token_invalid(self):
        import auth
        assert auth.verify_session_token("notavalidtoken") is None

    def test_session_token_empty(self):
        import auth
        assert auth.verify_session_token("") is None
        assert auth.verify_session_token(None) is None

    def test_corrupt_users_file_recreates_default(self, tmp_path):
        import auth
        auth.USERS_FILE.write_text("NOT VALID JSON {{{")
        data = auth._load_users()
        assert len(data["users"]) == 1
        assert data["users"][0]["username"] == "admin"

    def test_list_users(self):
        import auth
        auth._load_users()
        auth.add_user("charlie", "pw")
        users = auth.list_users()
        usernames = [u["username"] for u in users]
        assert "admin" in usernames
        assert "charlie" in usernames


# ---------------------------------------------------------------------------
# Login / Logout route tests
# ---------------------------------------------------------------------------

class TestLoginRoutes:
    def test_get_login_page(self, client):
        r = client.get("/login", follow_redirects=False)
        assert r.status_code == 200
        assert "Sign in" in r.text

    def test_post_login_valid(self, client):
        r = client.post(
            "/login",
            data={"username": "admin", "password": "nobohub"},
            follow_redirects=False,
        )
        assert r.status_code == 302
        assert r.headers["location"] in ("/", "http://testserver/")
        assert "nobo_session" in r.cookies

    def test_post_login_invalid_password(self, client):
        r = client.post(
            "/login",
            data={"username": "admin", "password": "wrong"},
            follow_redirects=False,
        )
        assert r.status_code == 401
        assert "Invalid" in r.text

    def test_post_login_unknown_user(self, client):
        r = client.post(
            "/login",
            data={"username": "nobody", "password": "pw"},
            follow_redirects=False,
        )
        assert r.status_code == 401

    def test_logout_clears_cookie(self, client):
        # Log in first
        client.post(
            "/login",
            data={"username": "admin", "password": "nobohub"},
            follow_redirects=False,
        )
        r = client.post("/logout", follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] in ("/login", "http://testserver/login")


# ---------------------------------------------------------------------------
# UI protection (GET /) tests
# ---------------------------------------------------------------------------

class TestUIProtection:
    def test_root_unauthenticated_redirects_to_login(self, client):
        # Use a fresh client with no cookies
        from fastapi.testclient import TestClient
        import server
        fresh = TestClient(server.app, raise_server_exceptions=True)
        r = fresh.get("/", follow_redirects=False)
        assert r.status_code == 302
        assert "/login" in r.headers["location"]

    def test_root_authenticated_serves_ui(self, auth_client):
        r = auth_client.get("/", follow_redirects=False)
        # Should serve the page (200) or redirect is acceptable if already at /
        assert r.status_code in (200, 302)

    def test_api_endpoints_not_protected(self, client):
        """API endpoints must remain accessible without authentication."""
        r = client.get("/api/status")
        assert r.status_code == 200

    def test_api_health_not_protected(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# /auth/me endpoint
# ---------------------------------------------------------------------------

class TestAuthMe:
    def test_me_unauthenticated(self, client):
        from fastapi.testclient import TestClient
        import server
        fresh = TestClient(server.app, raise_server_exceptions=True)
        r = fresh.get("/auth/me")
        assert r.status_code == 401

    def test_me_authenticated(self, auth_client):
        r = auth_client.get("/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == "admin"
        assert data["is_admin"] is True


# ---------------------------------------------------------------------------
# User management endpoints
# ---------------------------------------------------------------------------

class TestUserManagement:
    def test_list_users_admin(self, auth_client):
        r = auth_client.get("/auth/users")
        assert r.status_code == 200
        data = r.json()
        assert "users" in data
        assert any(u["username"] == "admin" for u in data["users"])

    def test_list_users_unauthenticated(self, client):
        from fastapi.testclient import TestClient
        import server
        fresh = TestClient(server.app, raise_server_exceptions=True)
        r = fresh.get("/auth/users")
        assert r.status_code == 401

    def test_add_user_admin(self, auth_client):
        r = auth_client.post(
            "/auth/users",
            json={"username": "testuser", "password": "pass123", "is_admin": False},
        )
        assert r.status_code == 200

    def test_add_user_duplicate(self, auth_client):
        auth_client.post(
            "/auth/users",
            json={"username": "dupuser", "password": "pw", "is_admin": False},
        )
        r = auth_client.post(
            "/auth/users",
            json={"username": "dupuser", "password": "pw2", "is_admin": False},
        )
        assert r.status_code == 400

    def test_delete_user_admin(self, auth_client):
        auth_client.post(
            "/auth/users",
            json={"username": "todelete", "password": "pw", "is_admin": False},
        )
        r = auth_client.delete("/auth/users/todelete")
        assert r.status_code == 200

    def test_delete_last_admin_fails(self, auth_client):
        r = auth_client.delete("/auth/users/admin")
        assert r.status_code == 400

    def test_rename_user_admin(self, auth_client):
        auth_client.post(
            "/auth/users",
            json={"username": "torename", "password": "pw", "is_admin": False},
        )
        r = auth_client.put(
            "/auth/users/torename",
            json={"new_username": "renamed"},
        )
        assert r.status_code == 200

    def test_change_own_password(self, auth_client):
        r = auth_client.post(
            "/auth/users/me/password",
            json={
                "current_password": "nobohub",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            },
        )
        assert r.status_code == 200

    def test_change_own_password_wrong_current(self, auth_client):
        r = auth_client.post(
            "/auth/users/me/password",
            json={
                "current_password": "wrongpw",
                "new_password": "newpass",
                "confirm_password": "newpass",
            },
        )
        assert r.status_code == 400

    def test_change_own_password_mismatch(self, auth_client):
        r = auth_client.post(
            "/auth/users/me/password",
            json={
                "current_password": "nobohub",
                "new_password": "a",
                "confirm_password": "b",
            },
        )
        assert r.status_code == 400

    def test_admin_change_user_password(self, auth_client):
        auth_client.post(
            "/auth/users",
            json={"username": "pwuser", "password": "oldpw", "is_admin": False},
        )
        r = auth_client.post(
            "/auth/users/pwuser/password",
            json={"new_password": "newpw123", "confirm_password": "newpw123"},
        )
        assert r.status_code == 200
