from conftest import send


def _react(client, account, message_id, emoji):
    return client.put(
        f"/api/messages/{message_id}/reaction", json={"emoji": emoji}, headers=account.headers
    )


def _message(client, account, conversation_id, message_id):
    listed = client.get(
        f"/api/conversations/{conversation_id}/messages", headers=account.headers
    ).json()
    return next(m for m in listed if m["id"] == message_id)


def test_react_replace_and_remove(client, alice, bob, direct):
    cid = direct["id"]
    message = send(client, alice, cid, "big news").json()

    first = _react(client, bob, message["id"], "👍")
    assert first.status_code == 200
    assert first.json() == [{"user_id": bob.id, "emoji": "👍"}]

    # One reaction per user: reacting again swaps it.
    swapped = _react(client, bob, message["id"], "❤️")
    assert swapped.json() == [{"user_id": bob.id, "emoji": "❤️"}]

    _react(client, alice, message["id"], "😂")
    reactions = _message(client, alice, cid, message["id"])["reactions"]
    assert {(r["user_id"], r["emoji"]) for r in reactions} == {(bob.id, "❤️"), (alice.id, "😂")}

    removed = client.delete(f"/api/messages/{message['id']}/reaction", headers=bob.headers)
    assert removed.json() == [{"user_id": alice.id, "emoji": "😂"}]
    # Removing again is harmless.
    assert client.delete(f"/api/messages/{message['id']}/reaction", headers=bob.headers).status_code == 200


def test_reaction_validation(client, alice, direct):
    message = send(client, alice, direct["id"], "x").json()
    assert _react(client, alice, message["id"], "").status_code == 422
    assert _react(client, alice, message["id"], "   ").status_code == 422
    assert _react(client, alice, message["id"], "a" * 40).status_code == 422


def test_only_members_can_react(client, alice, carol, direct):
    message = send(client, alice, direct["id"], "x").json()
    assert _react(client, carol, message["id"], "👍").status_code == 403
    assert _react(client, alice, 9999, "👍").status_code == 404


def test_cannot_react_across_a_block(client, alice, bob, direct):
    message = send(client, alice, direct["id"], "x").json()
    contact = client.post(
        "/api/contacts", json={"contact_user_id": bob.id}, headers=alice.headers
    ).json()
    client.post(f"/api/contacts/{contact['id']}/block", headers=alice.headers)
    assert _react(client, bob, message["id"], "👍").status_code == 403
