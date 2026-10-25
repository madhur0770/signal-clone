import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlmodel import create_engine

os.environ.setdefault("SECRET_KEY", "test-secret-key")

from app import database  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import websocket as ws_module  # noqa: E402


@dataclass
class Account:
    id: int
    token: str
    phone: str
    headers: dict[str, str]
    user: dict


@pytest.fixture()
def engine(tmp_path, monkeypatch: pytest.MonkeyPatch):
    test_engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False},
    )
    # Everything (REST sessions, websocket sessions, the purge loop) reads database.engine.
    monkeypatch.setattr(database, "engine", test_engine)
    database.create_db_and_tables(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    ws_module.manager.active_connections.clear()
    yield
    ws_module.manager.active_connections.clear()


@pytest.fixture()
def client(engine) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def register(client: TestClient) -> Callable[..., Account]:
    counter = {"n": 0}

    def _register(name: str | None = None, phone: str | None = None) -> Account:
        counter["n"] += 1
        phone = phone or f"+1555000{counter['n']:04d}"
        body = {
            "phone_number": phone,
            "otp": "123456",
            "display_name": name or f"User {counter['n']}",
            "username": f"user{counter['n']}x",
        }
        response = client.post("/api/auth/verify-otp", json=body)
        assert response.status_code == 200, response.text
        data = response.json()
        return Account(
            id=data["user"]["id"],
            token=data["access_token"],
            phone=phone,
            headers={"Authorization": f"Bearer {data['access_token']}"},
            user=data["user"],
        )

    return _register


@pytest.fixture()
def alice(register) -> Account:
    return register("Alice")


@pytest.fixture()
def bob(register) -> Account:
    return register("Bob")


@pytest.fixture()
def carol(register) -> Account:
    return register("Carol")


@pytest.fixture()
def direct(client: TestClient, alice: Account, bob: Account) -> dict:
    response = client.post(
        "/api/conversations",
        json={"type": "direct", "member_ids": [bob.id]},
        headers=alice.headers,
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture()
def group(client: TestClient, alice: Account, bob: Account, carol: Account) -> dict:
    response = client.post(
        "/api/conversations",
        json={"type": "group", "name": "Crew", "member_ids": [bob.id, carol.id]},
        headers=alice.headers,
    )
    assert response.status_code == 201
    return response.json()


def send(client: TestClient, account: Account, conversation_id: int, content: str = "hi", **extra):
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": content, **extra},
        headers=account.headers,
    )
    return response
