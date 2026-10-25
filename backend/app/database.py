import os
from collections.abc import Generator

from dotenv import load_dotenv
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

load_dotenv()



def normalize_database_url(url: str) -> str:
    """Some hosts hand out "postgres://" URLs, which SQLAlchemy no longer accepts."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./signal_clone.db"))

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def ensure_schema(bind: Engine) -> list[str]:
    """Add columns that exist on the models but are missing from the database.

    ``create_all`` only creates missing *tables*, so a database created by an older
    release (for example a persisted SQLite file on the host) would be missing the
    columns added later. Every column added after the first release is nullable, so a
    plain ``ALTER TABLE ... ADD COLUMN`` is enough. Returns the columns that were added.
    """
    added: list[str] = []
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    for table in SQLModel.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present:
                continue
            column_type = column.type.compile(dialect=bind.dialect)
            with bind.begin() as connection:
                connection.execute(
                    text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}')
                )
            added.append(f"{table.name}.{column.name}")
    return added


def create_db_and_tables(bind: Engine | None = None) -> None:
    import app.models  # noqa: F401 — register tables on metadata

    target = bind or engine
    SQLModel.metadata.create_all(target)
    ensure_schema(target)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
