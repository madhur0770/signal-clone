import sqlite3

from sqlalchemy import inspect
from sqlmodel import Session, create_engine, select

from app import database
from app.models import Message


def test_ensure_schema_upgrades_a_database_from_an_older_release(tmp_path):
    """A persisted DB from before attachments/timers existed must keep working after a deploy."""
    path = tmp_path / "old.db"
    legacy = sqlite3.connect(path)
    legacy.executescript(
        """
        CREATE TABLE conversations (
            id INTEGER PRIMARY KEY, type VARCHAR NOT NULL, name VARCHAR, avatar_url VARCHAR,
            created_by INTEGER NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, sender_id INTEGER NOT NULL,
            content VARCHAR NOT NULL, type VARCHAR NOT NULL, reply_to_message_id INTEGER,
            created_at DATETIME NOT NULL
        );
        INSERT INTO messages (conversation_id, sender_id, content, type, created_at)
        VALUES (1, 1, 'written by the old release', 'TEXT', '2026-07-01 10:00:00.000000');
        """
    )
    legacy.commit()
    legacy.close()

    engine = create_engine(f"sqlite:///{path}")
    database.create_db_and_tables(engine)

    columns = {c["name"] for c in inspect(engine).get_columns("messages")}
    assert {"expires_at", "attachment_url", "attachment_name", "attachment_mime", "attachment_size"} <= columns
    conversation_columns = {c["name"] for c in inspect(engine).get_columns("conversations")}
    assert "disappear_after_seconds" in conversation_columns
    # Tables that didn't exist yet were created.
    assert "message_reactions" in inspect(engine).get_table_names()

    with Session(engine) as db:
        old = db.exec(select(Message)).one()
        assert old.content == "written by the old release"
        assert old.expires_at is None
        assert old.attachment_url is None
    engine.dispose()


def test_ensure_schema_is_a_no_op_on_a_current_database(engine):
    assert database.ensure_schema(engine) == []


def test_postgres_style_urls_are_normalised():
    assert database.normalize_database_url("postgres://u:p@h:5432/db") == "postgresql://u:p@h:5432/db"
    assert database.normalize_database_url("postgresql://u:p@h/db") == "postgresql://u:p@h/db"
    assert database.normalize_database_url("sqlite:///./x.db") == "sqlite:///./x.db"
