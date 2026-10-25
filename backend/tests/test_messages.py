from conftest import send


def _contact_id(client, owner, target):
    response = client.post(
        "/api/contacts", json={"contact_user_id": target.id}, headers=owner.headers
    )
    return response.json()["id"]


def _messages(client, account, conversation_id, **params):
    response = client.get(
        f"/api/conversations/{conversation_id}/messages", params=params, headers=account.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_send_and_list_oldest_first(client, alice, bob, direct):
    cid = direct["id"]
    for text in ("one", "two", "three"):
        assert send(client, alice, cid, text).status_code == 201
    assert [m["content"] for m in _messages(client, bob, cid)] == ["one", "two", "three"]


def test_pagination_pages_backwards(client, alice, direct):
    cid = direct["id"]
    for index in range(5):
        send(client, alice, cid, f"m{index}")

    latest = _messages(client, alice, cid, limit=2)
    assert [m["content"] for m in latest] == ["m3", "m4"]
    earlier = _messages(client, alice, cid, limit=2, before_id=latest[0]["id"])
    assert [m["content"] for m in earlier] == ["m1", "m2"]
    oldest = _messages(client, alice, cid, limit=2, before_id=earlier[0]["id"])
    assert [m["content"] for m in oldest] == ["m0"]


def test_limit_is_capped(client, alice, direct):
    response = client.get(
        f"/api/conversations/{direct['id']}/messages", params={"limit": 5000}, headers=alice.headers
    )
    assert response.status_code == 422


def test_message_content_is_validated(client, alice, direct):
    cid = direct["id"]
    assert send(client, alice, cid, "").status_code == 422
    assert send(client, alice, cid, "   \n ").status_code == 422
    assert send(client, alice, cid, "x" * 4001).status_code == 422
    assert send(client, alice, cid, "x" * 4000).status_code == 201


def test_message_content_is_trimmed(client, alice, direct):
    assert send(client, alice, direct["id"], "  hello  ").json()["content"] == "hello"


def test_non_members_cannot_read_or_write(client, alice, carol, direct):
    cid = direct["id"]
    send(client, alice, cid, "secret")
    assert send(client, carol, cid, "intrude").status_code == 403
    response = client.get(f"/api/conversations/{cid}/messages", headers=carol.headers)
    assert response.status_code == 403
    assert send(client, alice, 9999, "nowhere").status_code == 404


def test_blocking_stops_messages_in_both_directions(client, alice, bob, direct):
    cid = direct["id"]
    contact = _contact_id(client, alice, bob)

    client.post(f"/api/contacts/{contact}/block", headers=alice.headers)
    assert send(client, alice, cid, "from blocker").status_code == 403
    assert send(client, bob, cid, "from blocked").status_code == 403

    client.post(f"/api/contacts/{contact}/unblock", headers=alice.headers)
    assert send(client, alice, cid, "back").status_code == 201
    assert send(client, bob, cid, "back too").status_code == 201


def test_blocking_does_not_affect_groups(client, alice, bob, group):
    contact = _contact_id(client, alice, bob)
    client.post(f"/api/contacts/{contact}/block", headers=alice.headers)
    assert send(client, alice, group["id"], "still here").status_code == 201
    assert send(client, bob, group["id"], "me too").status_code == 201


def test_replies_carry_a_preview_of_the_original(client, alice, bob, direct):
    cid = direct["id"]
    original = send(client, alice, cid, "lunch at noon?").json()
    reply = send(client, bob, cid, "sounds good", reply_to_message_id=original["id"])
    assert reply.status_code == 201

    listed = _messages(client, alice, cid)[-1]
    assert listed["reply_to_message_id"] == original["id"]
    assert listed["reply_to"]["content"] == "lunch at noon?"
    assert listed["reply_to"]["sender_name"] == "Alice"


def test_reply_target_must_be_in_the_same_conversation(client, alice, bob, carol, direct):
    other = client.post(
        "/api/conversations", json={"type": "direct", "member_ids": [carol.id]}, headers=alice.headers
    ).json()
    elsewhere = send(client, alice, other["id"], "different chat").json()

    assert send(client, alice, direct["id"], "x", reply_to_message_id=elsewhere["id"]).status_code == 400
    assert send(client, alice, direct["id"], "x", reply_to_message_id=9999).status_code == 400


def test_recipient_status_starts_as_sent_while_offline(client, alice, bob, direct):
    message = send(client, alice, direct["id"], "ping").json()
    by_user = {s["user_id"]: s["status"] for s in message["statuses"]}
    assert by_user == {alice.id: "sent", bob.id: "sent"}


def test_status_only_moves_forward(client, alice, bob, direct):
    message = send(client, alice, direct["id"], "ping").json()
    path = f"/api/messages/{message['id']}/status"

    assert client.patch(path, json={"status": "delivered"}, headers=bob.headers).json()["status"] == "delivered"
    assert client.patch(path, json={"status": "read"}, headers=bob.headers).json()["status"] == "read"
    # Downgrades are ignored rather than applied.
    assert client.patch(path, json={"status": "delivered"}, headers=bob.headers).json()["status"] == "read"
    assert client.patch(path, json={"status": "sent"}, headers=bob.headers).status_code == 400


def test_senders_cannot_mark_their_own_messages(client, alice, direct):
    message = send(client, alice, direct["id"], "mine").json()
    response = client.patch(
        f"/api/messages/{message['id']}/status", json={"status": "read"}, headers=alice.headers
    )
    assert response.status_code == 400


def test_outsiders_cannot_change_status(client, alice, carol, direct):
    message = send(client, alice, direct["id"], "private").json()
    response = client.patch(
        f"/api/messages/{message['id']}/status", json={"status": "read"}, headers=carol.headers
    )
    assert response.status_code == 403
    assert (
        client.patch("/api/messages/9999/status", json={"status": "read"}, headers=carol.headers).status_code
        == 404
    )


def test_mark_conversation_read_in_one_call(client, alice, bob, direct):
    cid = direct["id"]
    ids = [send(client, alice, cid, f"m{i}").json()["id"] for i in range(3)]
    send(client, bob, cid, "mine")

    result = client.post(f"/api/conversations/{cid}/read", headers=bob.headers).json()
    assert sorted(result["message_ids"]) == sorted(ids)
    # Nothing left to mark the second time.
    assert client.post(f"/api/conversations/{cid}/read", headers=bob.headers).json()["message_ids"] == []

    seen = {s["status"] for m in _messages(client, alice, cid) if m["sender_id"] == alice.id
            for s in m["statuses"] if s["user_id"] == bob.id}
    assert seen == {"read"}


def test_group_message_gets_a_status_row_per_member(client, alice, bob, carol, group):
    message = send(client, alice, group["id"], "hello all").json()
    assert {s["user_id"] for s in message["statuses"]} == {alice.id, bob.id, carol.id}
