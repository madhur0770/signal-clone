from conftest import send


def test_direct_conversation_is_created_once(client, alice, bob):
    first = client.post(
        "/api/conversations",
        json={"type": "direct", "member_ids": [bob.id]},
        headers=alice.headers,
    )
    assert first.status_code == 201

    # Either side asking again gets the same conversation back.
    again = client.post(
        "/api/conversations",
        json={"type": "direct", "member_ids": [alice.id]},
        headers=bob.headers,
    )
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert {m["user_id"] for m in first.json()["members"]} == {alice.id, bob.id}


def test_direct_conversation_validation(client, alice, bob, carol):
    self_chat = client.post(
        "/api/conversations", json={"type": "direct", "member_ids": [alice.id]}, headers=alice.headers
    )
    assert self_chat.status_code == 400
    too_many = client.post(
        "/api/conversations",
        json={"type": "direct", "member_ids": [bob.id, carol.id]},
        headers=alice.headers,
    )
    assert too_many.status_code == 400
    unknown = client.post(
        "/api/conversations", json={"type": "direct", "member_ids": [999]}, headers=alice.headers
    )
    assert unknown.status_code == 404


def test_group_creation_rules(client, alice, bob):
    no_name = client.post(
        "/api/conversations", json={"type": "group", "member_ids": [bob.id]}, headers=alice.headers
    )
    assert no_name.status_code == 400
    alone = client.post(
        "/api/conversations",
        json={"type": "group", "name": "Solo", "member_ids": [alice.id]},
        headers=alice.headers,
    )
    assert alone.status_code == 400


def test_group_creator_is_admin(group, alice, bob, carol):
    roles = {m["user_id"]: m["role"] for m in group["members"]}
    assert roles == {alice.id: "admin", bob.id: "member", carol.id: "member"}


def test_list_includes_last_message_and_unread_count(client, alice, bob, direct):
    cid = direct["id"]
    send(client, alice, cid, "first")
    send(client, alice, cid, "second")

    bobs = client.get("/api/conversations", headers=bob.headers).json()
    assert bobs[0]["last_message"]["content"] == "second"
    assert bobs[0]["unread_count"] == 2

    alices = client.get("/api/conversations", headers=alice.headers).json()
    assert alices[0]["unread_count"] == 0  # your own messages are never unread

    client.post(f"/api/conversations/{cid}/read", headers=bob.headers)
    assert client.get("/api/conversations", headers=bob.headers).json()[0]["unread_count"] == 0


def test_list_is_sorted_by_latest_activity(client, alice, bob, carol, direct):
    other = client.post(
        "/api/conversations", json={"type": "direct", "member_ids": [carol.id]}, headers=alice.headers
    ).json()
    send(client, alice, direct["id"], "bump")
    order = [c["id"] for c in client.get("/api/conversations", headers=alice.headers).json()]
    assert order == [direct["id"], other["id"]]


def test_only_members_can_read_a_conversation(client, carol, direct):
    assert client.get(f"/api/conversations/{direct['id']}", headers=carol.headers).status_code == 403
    assert client.get("/api/conversations/9999", headers=carol.headers).status_code == 404


def test_only_admins_add_members(client, alice, bob, carol, register):
    dave = register("Dave")
    group = client.post(
        "/api/conversations",
        json={"type": "group", "name": "Two", "member_ids": [bob.id]},
        headers=alice.headers,
    ).json()
    path = f"/api/conversations/{group['id']}/members"

    assert client.post(path, json={"user_id": carol.id}, headers=bob.headers).status_code == 403
    added = client.post(path, json={"user_id": carol.id}, headers=alice.headers)
    assert added.status_code == 200
    assert carol.id in {m["user_id"] for m in added.json()["members"]}
    assert client.post(path, json={"user_id": carol.id}, headers=alice.headers).status_code == 400
    assert client.post(path, json={"user_id": 999}, headers=alice.headers).status_code == 404
    assert dave.id not in {m["user_id"] for m in added.json()["members"]}


def test_cannot_change_membership_of_a_direct_chat(client, carol, direct, alice):
    path = f"/api/conversations/{direct['id']}/members"
    assert client.post(path, json={"user_id": carol.id}, headers=alice.headers).status_code == 400


def test_admin_removes_member_but_members_cannot_remove_others(client, alice, bob, carol, group):
    base = f"/api/conversations/{group['id']}/members"
    assert client.delete(f"{base}/{carol.id}", headers=bob.headers).status_code == 403
    assert client.delete(f"{base}/{carol.id}", headers=alice.headers).status_code == 204
    assert client.delete(f"{base}/{carol.id}", headers=alice.headers).status_code == 404

    remaining = client.get(f"/api/conversations/{group['id']}", headers=alice.headers).json()
    assert {m["user_id"] for m in remaining["members"]} == {alice.id, bob.id}


def test_member_can_leave(client, bob, alice, group):
    path = f"/api/conversations/{group['id']}/members/{bob.id}"
    assert client.delete(path, headers=bob.headers).status_code == 204
    assert client.get(f"/api/conversations/{group['id']}", headers=bob.headers).status_code == 403


def test_group_keeps_an_admin_when_the_last_admin_leaves(client, alice, bob, group):
    path = f"/api/conversations/{group['id']}/members/{alice.id}"
    assert client.delete(path, headers=alice.headers).status_code == 204

    members = client.get(f"/api/conversations/{group['id']}", headers=bob.headers).json()["members"]
    assert any(m["role"] == "admin" for m in members)


def test_conversation_is_deleted_when_the_last_member_leaves(client, alice, bob):
    group = client.post(
        "/api/conversations",
        json={"type": "group", "name": "Pair", "member_ids": [bob.id]},
        headers=alice.headers,
    ).json()
    send(client, alice, group["id"], "bye")
    for account in (alice, bob):
        path = f"/api/conversations/{group['id']}/members/{account.id}"
        assert client.delete(path, headers=account.headers).status_code == 204
    assert client.get(f"/api/conversations/{group['id']}", headers=alice.headers).status_code == 404


def test_change_member_role(client, alice, bob, group):
    path = f"/api/conversations/{group['id']}/members/{bob.id}"
    promoted = client.patch(path, json={"role": "admin"}, headers=alice.headers)
    assert promoted.status_code == 200
    assert {m["user_id"]: m["role"] for m in promoted.json()["members"]}[bob.id] == "admin"
    assert client.patch(path, json={"role": "member"}, headers=bob.headers).status_code == 200

    # The group must never be left without an admin.
    own = f"/api/conversations/{group['id']}/members/{alice.id}"
    assert client.patch(own, json={"role": "member"}, headers=alice.headers).status_code == 400
    # Members can't change roles.
    assert client.patch(path, json={"role": "admin"}, headers=bob.headers).status_code == 403


def test_rename_group_and_set_timer(client, alice, bob, group):
    path = f"/api/conversations/{group['id']}"
    assert client.patch(path, json={"name": "Nope"}, headers=bob.headers).status_code == 403

    renamed = client.patch(path, json={"name": "  New name "}, headers=alice.headers)
    assert renamed.json()["name"] == "New name"
    assert client.patch(path, json={"name": " "}, headers=alice.headers).status_code == 400

    timer = client.patch(path, json={"disappear_after_seconds": 3600}, headers=alice.headers)
    assert timer.json()["disappear_after_seconds"] == 3600
    off = client.patch(path, json={"disappear_after_seconds": 0}, headers=alice.headers)
    assert off.json()["disappear_after_seconds"] is None
    assert off.json()["name"] == "New name"  # untouched fields stay as they were


def test_timer_values_are_limited_to_presets(client, alice, direct):
    path = f"/api/conversations/{direct['id']}"
    assert client.patch(path, json={"disappear_after_seconds": 17}, headers=alice.headers).status_code == 422
    assert client.patch(path, json={"disappear_after_seconds": 30}, headers=alice.headers).status_code == 200


def test_direct_chats_have_no_name_and_anyone_can_set_the_timer(client, bob, direct):
    path = f"/api/conversations/{direct['id']}"
    assert client.patch(path, json={"name": "x"}, headers=bob.headers).status_code == 400
    assert client.patch(path, json={"disappear_after_seconds": 300}, headers=bob.headers).status_code == 200
