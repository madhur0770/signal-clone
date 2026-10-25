from datetime import timedelta

from conftest import send
from sqlmodel import Session, select

from app.models import Message, MessageStatus, Reaction
from app.services import purge_expired
from app.timeutil import utcnow


def _set_timer(client, account, conversation_id, seconds):
    response = client.patch(
        f"/api/conversations/{conversation_id}",
        json={"disappear_after_seconds": seconds},
        headers=account.headers,
    )
    assert response.status_code == 200, response.text


def _expire(engine, message_id):
    with Session(engine) as db:
        message = db.get(Message, message_id)
        message.expires_at = utcnow() - timedelta(seconds=1)
        db.add(message)
        db.commit()


def _listed_ids(client, account, conversation_id):
    response = client.get(
        f"/api/conversations/{conversation_id}/messages", headers=account.headers
    )
    return [m["id"] for m in response.json()]


def test_messages_expire_only_when_a_timer_is_set(client, alice, direct):
    cid = direct["id"]
    before = send(client, alice, cid, "no timer").json()
    assert before["expires_at"] is None

    _set_timer(client, alice, cid, 3600)
    timed = send(client, alice, cid, "with timer").json()
    assert timed["expires_at"] is not None

    # Turning the timer off affects new messages only; the old one keeps its deadline.
    _set_timer(client, alice, cid, 0)
    after = send(client, alice, cid, "timer off").json()
    assert after["expires_at"] is None


def test_expired_messages_are_hidden_everywhere(client, engine, alice, bob, direct):
    cid = direct["id"]
    _set_timer(client, alice, cid, 30)
    keep = send(client, alice, cid, "stays").json()
    _set_timer(client, alice, cid, 0)
    gone = send(client, alice, cid, "goes").json()
    _expire(engine, gone["id"])

    assert _listed_ids(client, bob, cid) == [keep["id"]]

    summary = client.get("/api/conversations", headers=bob.headers).json()[0]
    assert summary["last_message"]["id"] == keep["id"]
    assert summary["unread_count"] == 1

    status = client.patch(
        f"/api/messages/{gone['id']}/status", json={"status": "read"}, headers=bob.headers
    )
    assert status.status_code == 404
    react = client.put(
        f"/api/messages/{gone['id']}/reaction", json={"emoji": "👍"}, headers=bob.headers
    )
    assert react.status_code == 404


def test_purge_deletes_expired_messages_and_their_children(client, engine, alice, bob, direct):
    cid = direct["id"]
    doomed = send(client, alice, cid, "doomed").json()
    survivor = send(client, bob, cid, "re: doomed", reply_to_message_id=doomed["id"]).json()
    client.put(
        f"/api/messages/{doomed['id']}/reaction", json={"emoji": "👍"}, headers=bob.headers
    )
    _expire(engine, doomed["id"])

    with Session(engine) as db:
        removed = purge_expired(db)
        assert removed == {cid: [doomed["id"]]}

        assert db.get(Message, doomed["id"]) is None
        assert db.exec(select(MessageStatus).where(MessageStatus.message_id == doomed["id"])).all() == []
        assert db.exec(select(Reaction).where(Reaction.message_id == doomed["id"])).all() == []
        # The reply outlives it, just without a dangling pointer.
        assert db.get(Message, survivor["id"]).reply_to_message_id is None

        # Nothing left to purge.
        assert purge_expired(db) == {}


def test_purge_removes_the_attachment_file(client, engine, alice, direct, tmp_path):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    uploaded = client.post(
        "/api/uploads", files={"file": ("p.png", png)}, headers=alice.headers
    ).json()
    sent = send(
        client, alice, direct["id"], "", type="image", attachment_url=uploaded["url"]
    ).json()
    assert len(list((tmp_path / "uploads").glob("*"))) == 1

    _expire(engine, sent["id"])
    with Session(engine) as db:
        purge_expired(db)
    assert list((tmp_path / "uploads").glob("*")) == []
    assert client.get(uploaded["url"]).status_code == 404


def test_timer_change_is_broadcast(client, alice, bob, direct):
    with client.websocket_connect(f"/api/ws?token={bob.token}") as ws:
        assert ws.receive_json()["type"] == "connected"
        _set_timer(client, alice, direct["id"], 300)
        event = ws.receive_json()
        assert event == {"type": "conversation_updated", "conversation_id": direct["id"]}
