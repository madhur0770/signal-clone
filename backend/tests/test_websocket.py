import pytest
from conftest import send
from starlette.websockets import WebSocketDisconnect


def connect(client, account):
    return client.websocket_connect(f"/api/ws?token={account.token}")


def recv_type(ws, wanted, limit=20):
    """Read events until one of the wanted type arrives (the others are presence noise)."""
    for _ in range(limit):
        event = ws.receive_json()
        if event.get("type") == wanted:
            return event
    raise AssertionError(f"no '{wanted}' event within {limit} messages")


def test_rejects_invalid_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/ws?token=bogus"):
            pass


def test_connect_ping_and_error_handling(client, alice):
    with connect(client, alice) as ws:
        assert ws.receive_json()["type"] == "connected"

        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}

        ws.send_text("not json")
        assert ws.receive_json() == {"type": "error", "message": "Invalid JSON"}
        ws.send_text("[1, 2]")
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "teleport", "conversation_id": 1})
        assert "Unknown event type" in ws.receive_json()["message"]
        ws.send_json({"type": "message"})
        assert ws.receive_json()["type"] == "error"


def test_messages_sent_over_the_socket_reach_every_member(client, alice, bob, direct):
    cid = direct["id"]
    with connect(client, alice) as wa, connect(client, bob) as wb:
        recv_type(wa, "connected")
        recv_type(wb, "connected")

        wa.send_json({"type": "message", "conversation_id": cid, "content": "over ws"})
        for ws in (wa, wb):
            event = recv_type(ws, "message")["message"]
            assert event["content"] == "over ws"
            assert event["sender_id"] == alice.id
            assert event["conversation_id"] == cid
            assert event["sender"]["display_name"] == "Alice"

    # It was stored like any other message, and both were online so it counts as delivered.
    stored = client.get(f"/api/conversations/{cid}/messages", headers=bob.headers).json()
    assert [m["content"] for m in stored] == ["over ws"]
    bob_status = next(s for s in stored[0]["statuses"] if s["user_id"] == bob.id)
    assert bob_status["status"] == "delivered"


def test_rest_messages_are_pushed_live(client, alice, bob, direct):
    with connect(client, bob) as wb:
        recv_type(wb, "connected")
        send(client, alice, direct["id"], "via rest")
        assert recv_type(wb, "message")["message"]["content"] == "via rest"


def test_socket_messages_respect_membership_blocking_and_validation(client, alice, bob, carol, direct):
    cid = direct["id"]
    with connect(client, carol) as wc:
        recv_type(wc, "connected")
        wc.send_json({"type": "message", "conversation_id": cid, "content": "let me in"})
        assert recv_type(wc, "error")["message"] == "Not a member"

    contact = client.post(
        "/api/contacts", json={"contact_user_id": bob.id}, headers=alice.headers
    ).json()
    client.post(f"/api/contacts/{contact['id']}/block", headers=alice.headers)
    with connect(client, alice) as wa:
        recv_type(wa, "connected")
        wa.send_json({"type": "message", "conversation_id": cid, "content": "blocked"})
        assert "blocked" in recv_type(wa, "error")["message"]
        wa.send_json({"type": "message", "conversation_id": cid, "content": "   "})
        assert recv_type(wa, "error")["type"] == "error"

    assert client.get(f"/api/conversations/{cid}/messages", headers=alice.headers).json() == []


def test_offline_recipients_get_delivery_receipts_when_they_connect(client, alice, bob, direct):
    cid = direct["id"]
    message = send(client, alice, cid, "waiting for you").json()
    assert {s["user_id"]: s["status"] for s in message["statuses"]}[bob.id] == "sent"

    with connect(client, alice) as wa:
        recv_type(wa, "connected")
        with connect(client, bob) as wb:
            recv_type(wb, "connected")
            event = recv_type(wa, "messages_status")
            assert event["status"] == "delivered"
            assert event["user_id"] == bob.id
            assert event["message_ids"] == [message["id"]]

    refreshed = client.get(f"/api/conversations/{cid}/messages", headers=alice.headers).json()
    assert {s["user_id"]: s["status"] for s in refreshed[0]["statuses"]}[bob.id] == "delivered"


def test_read_receipts_are_pushed_to_the_sender(client, alice, bob, direct):
    cid = direct["id"]
    message = send(client, alice, cid, "read me").json()
    with connect(client, alice) as wa:
        recv_type(wa, "connected")
        client.post(f"/api/conversations/{cid}/read", headers=bob.headers)
        event = recv_type(wa, "messages_status")
        assert event["status"] == "read"
        assert event["message_ids"] == [message["id"]]


def test_typing_only_goes_to_other_members(client, alice, bob, carol, direct):
    cid = direct["id"]
    with connect(client, alice) as wa, connect(client, bob) as wb, connect(client, carol) as wc:
        for ws in (wa, wb, wc):
            recv_type(ws, "connected")

        wc.send_json({"type": "typing", "conversation_id": cid})  # carol isn't a member
        wa.send_json({"type": "typing", "conversation_id": cid})

        event = recv_type(wb, "typing")
        assert event["user_id"] == alice.id  # carol's was dropped, so alice's is the first

        # The sender doesn't get an echo of her own typing event.
        wb.send_json({"type": "ping"})
        wa.send_json({"type": "ping"})
        seen = []
        while True:
            item = wa.receive_json()
            seen.append(item["type"])
            if item["type"] == "pong":
                break
        assert "typing" not in seen


def test_presence_is_broadcast_to_people_you_chat_with(client, alice, bob, carol, direct):
    with connect(client, alice) as wa:
        recv_type(wa, "connected")

        with connect(client, bob) as wb:
            recv_type(wb, "connected")
            online = recv_type(wa, "presence")
            assert online == {
                "type": "presence",
                "user_id": bob.id,
                "is_online": True,
                "last_seen": None,
            }

        offline = recv_type(wa, "presence")
        assert offline["user_id"] == bob.id
        assert offline["is_online"] is False
        assert offline["last_seen"] is not None

    # Carol shares no conversation with anyone, so nobody hears about her.
    with connect(client, alice) as wa:
        recv_type(wa, "connected")
        with connect(client, carol) as wc:
            recv_type(wc, "connected")
            wa.send_json({"type": "ping"})
            kinds = []
            while True:
                kinds.append(wa.receive_json()["type"])
                if kinds[-1] == "pong":
                    break
            assert "presence" not in kinds


def test_user_stays_online_until_the_last_socket_closes(client, alice, bob, direct):
    with connect(client, alice) as wa:
        recv_type(wa, "connected")
        with connect(client, bob) as first:
            recv_type(first, "connected")
            recv_type(wa, "presence")
            with connect(client, bob) as second:
                recv_type(second, "connected")
            # One of bob's two tabs closed; he is still online and nobody was told otherwise.
            me = client.get("/api/auth/me", headers=bob.headers).json()
            assert me["is_online"] is True
        assert recv_type(wa, "presence")["is_online"] is False


def test_profile_updates_are_pushed(client, alice, bob, direct):
    with connect(client, bob) as wb:
        recv_type(wb, "connected")
        client.patch("/api/auth/me", json={"display_name": "Alice Cooper"}, headers=alice.headers)
        event = recv_type(wb, "user_updated")
        assert event["user"]["id"] == alice.id
        assert event["user"]["display_name"] == "Alice Cooper"


def test_membership_events(client, alice, bob, carol, group):
    cid = group["id"]
    with connect(client, bob) as wb, connect(client, carol) as wc:
        recv_type(wb, "connected")
        recv_type(wc, "connected")

        client.delete(f"/api/conversations/{cid}/members/{carol.id}", headers=alice.headers)
        for ws in (wb, wc):  # the removed user is told too
            event = recv_type(ws, "member_removed")
            assert event["conversation_id"] == cid
            assert event["removed_user_id"] == carol.id


def test_conversation_created_event(client, alice, bob):
    with connect(client, bob) as wb:
        recv_type(wb, "connected")
        created = client.post(
            "/api/conversations", json={"type": "direct", "member_ids": [bob.id]}, headers=alice.headers
        ).json()
        event = recv_type(wb, "conversation_created")
        assert event["conversation_id"] == created["id"]
        assert event["conversation"]["id"] == created["id"]


def test_reactions_are_pushed(client, alice, bob, direct):
    message = send(client, alice, direct["id"], "react to me").json()
    with connect(client, alice) as wa:
        recv_type(wa, "connected")
        client.put(
            f"/api/messages/{message['id']}/reaction", json={"emoji": "🎉"}, headers=bob.headers
        )
        event = recv_type(wa, "reaction")
        assert event["message_id"] == message["id"]
        assert event["reactions"] == [{"user_id": bob.id, "emoji": "🎉"}]
