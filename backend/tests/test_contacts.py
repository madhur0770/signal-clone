def test_add_list_update_delete_contact(client, alice, bob):
    created = client.post(
        "/api/contacts",
        json={"contact_user_id": bob.id, "nickname": "Bobby"},
        headers=alice.headers,
    )
    assert created.status_code == 201
    contact_id = created.json()["id"]

    listed = client.get("/api/contacts", headers=alice.headers).json()
    assert [c["nickname"] for c in listed] == ["Bobby"]
    # Contacts are one-directional.
    assert client.get("/api/contacts", headers=bob.headers).json() == []

    updated = client.patch(
        f"/api/contacts/{contact_id}", json={"nickname": "Bob M."}, headers=alice.headers
    )
    assert updated.json()["nickname"] == "Bob M."

    assert client.delete(f"/api/contacts/{contact_id}", headers=alice.headers).status_code == 204
    assert client.get("/api/contacts", headers=alice.headers).json() == []


def test_cannot_add_self_twice_or_unknown_users(client, alice, bob):
    assert (
        client.post("/api/contacts", json={"contact_user_id": alice.id}, headers=alice.headers)
        .status_code
        == 400
    )
    assert (
        client.post("/api/contacts", json={"contact_user_id": 9999}, headers=alice.headers)
        .status_code
        == 404
    )
    body = {"contact_user_id": bob.id}
    assert client.post("/api/contacts", json=body, headers=alice.headers).status_code == 201
    assert client.post("/api/contacts", json=body, headers=alice.headers).status_code == 400


def test_search_excludes_self_and_existing_contacts(client, alice, bob, carol):
    results = client.get("/api/contacts/search", params={"q": "o"}, headers=alice.headers).json()
    assert {u["display_name"] for u in results} == {"Bob", "Carol"}

    client.post("/api/contacts", json={"contact_user_id": bob.id}, headers=alice.headers)
    results = client.get("/api/contacts/search", params={"q": "o"}, headers=alice.headers).json()
    assert {u["display_name"] for u in results} == {"Carol"}

    assert client.get("/api/contacts/search", params={"q": ""}, headers=alice.headers).json() == []


def test_search_matches_phone_numbers(client, alice, bob):
    results = client.get(
        "/api/contacts/search", params={"q": bob.phone[-4:]}, headers=alice.headers
    ).json()
    assert [u["id"] for u in results] == [bob.id]


def test_block_and_unblock(client, alice, bob):
    contact = client.post(
        "/api/contacts", json={"contact_user_id": bob.id}, headers=alice.headers
    ).json()
    blocked = client.post(f"/api/contacts/{contact['id']}/block", headers=alice.headers)
    assert blocked.json()["is_blocked"] is True
    unblocked = client.post(f"/api/contacts/{contact['id']}/unblock", headers=alice.headers)
    assert unblocked.json()["is_blocked"] is False


def test_cannot_touch_someone_elses_contact(client, alice, bob, carol):
    contact = client.post(
        "/api/contacts", json={"contact_user_id": bob.id}, headers=alice.headers
    ).json()
    for method, path in [
        ("patch", f"/api/contacts/{contact['id']}"),
        ("delete", f"/api/contacts/{contact['id']}"),
        ("post", f"/api/contacts/{contact['id']}/block"),
    ]:
        kwargs = {"json": {"nickname": "x"}} if method == "patch" else {}
        response = getattr(client, method)(path, headers=carol.headers, **kwargs)
        assert response.status_code == 404
