from conftest import Account


def test_request_otp_validates_phone(client):
    assert client.post("/api/auth/request-otp", json={"phone_number": "12345"}).status_code == 400
    ok = client.post("/api/auth/request-otp", json={"phone_number": "+15551234567"})
    assert ok.status_code == 200
    assert "123456" in ok.json()["message"]


def test_verify_otp_rejects_wrong_code(client):
    response = client.post(
        "/api/auth/verify-otp", json={"phone_number": "+15551234567", "otp": "000000"}
    )
    assert response.status_code == 400


def test_first_login_registers_and_second_login_reuses_user(client):
    body = {"phone_number": "+15551234567", "otp": "123456", "display_name": "  Dana  "}
    first = client.post("/api/auth/verify-otp", json=body).json()
    second = client.post("/api/auth/verify-otp", json=body).json()

    assert first["user"]["display_name"] == "Dana"
    assert second["user"]["id"] == first["user"]["id"]
    # Two logins in the same second must still produce two distinct, valid sessions.
    assert first["access_token"] != second["access_token"]
    for token in (first["access_token"], second["access_token"]):
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200


def test_default_display_name_and_generated_username(client):
    data = client.post(
        "/api/auth/verify-otp", json={"phone_number": "+15559876543", "otp": "123456"}
    ).json()
    assert data["user"]["display_name"] == "User 6543"
    assert data["user"]["username"].startswith("user_6543_")


def test_duplicate_username_is_a_conflict(client):
    first = {"phone_number": "+15550000001", "otp": "123456", "username": "taken"}
    second = {"phone_number": "+15550000002", "otp": "123456", "username": "taken"}
    assert client.post("/api/auth/verify-otp", json=first).status_code == 200
    assert client.post("/api/auth/verify-otp", json=second).status_code == 409


def test_me_requires_a_valid_token(client):
    assert client.get("/api/auth/me").status_code in (401, 403)
    bad = client.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"})
    assert bad.status_code == 401


def test_update_profile(client, alice: Account):
    response = client.patch(
        "/api/auth/me",
        json={"display_name": "Alice C.", "status_message": "At lunch"},
        headers=alice.headers,
    )
    assert response.status_code == 200
    assert response.json()["display_name"] == "Alice C."
    assert response.json()["status_message"] == "At lunch"

    # Only the fields that were sent change.
    again = client.patch("/api/auth/me", json={"status_message": "  "}, headers=alice.headers)
    assert again.json()["display_name"] == "Alice C."
    assert again.json()["status_message"] is None


def test_update_profile_rejects_blank_name(client, alice: Account):
    response = client.patch("/api/auth/me", json={"display_name": "   "}, headers=alice.headers)
    assert response.status_code == 422


def test_cannot_change_immutable_fields(client, alice: Account):
    client.patch(
        "/api/auth/me",
        json={"phone_number": "+19999999999", "username": "hacker", "is_online": False},
        headers=alice.headers,
    )
    me = client.get("/api/auth/me", headers=alice.headers).json()
    assert me["phone_number"] == alice.phone
    assert me["username"] == alice.user["username"]


def test_logout_only_revokes_the_current_session(client, alice: Account):
    other = client.post(
        "/api/auth/verify-otp", json={"phone_number": alice.phone, "otp": "123456"}
    ).json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other}"}

    assert client.post("/api/auth/logout", headers=alice.headers).status_code == 200
    assert client.get("/api/auth/me", headers=alice.headers).status_code == 401
    assert client.get("/api/auth/me", headers=other_headers).status_code == 200


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/api/health").json() == {"status": "ok"}
