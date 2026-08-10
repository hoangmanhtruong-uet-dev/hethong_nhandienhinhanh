from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    settings.upload_dir.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        inspector = inspect(connection)
        if "users" in inspector.get_table_names():
            user_columns = {column["name"] for column in inspector.get_columns("users")}
            if "role" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'member' NOT NULL"))
            if "two_factor_enabled" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT FALSE NOT NULL"))
            if "two_factor_secret" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN two_factor_secret TEXT"))
            owner_count = connection.execute(text("SELECT COUNT(*) FROM users WHERE role = 'owner'")) .scalar_one()
            if owner_count == 0:
                connection.execute(text(
                    "UPDATE users SET role = 'owner' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)"
                ))
            owner_id = connection.execute(text(
                "SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1"
            )).scalar_one_or_none()
            for table_name in ("scans", "collections", "feedback"):
                columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
                if "user_id" not in columns:
                    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN user_id VARCHAR(36)"))
            if owner_id:
                for table_name in ("scans", "collections", "feedback"):
                    columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
                    if "user_id" in columns:
                        connection.execute(
                            text(f"UPDATE {table_name} SET user_id = :owner_id WHERE user_id IS NULL"),
                            {"owner_id": owner_id},
                        )

            if connection.dialect.name == "postgresql" and owner_id:
                quote = connection.dialect.identifier_preparer.quote
                unique_constraints = inspect(connection).get_unique_constraints("collections")
                for constraint in unique_constraints:
                    columns = constraint.get("column_names") or []
                    name = constraint.get("name")
                    if columns == ["name"] and name:
                        connection.execute(text(f"ALTER TABLE collections DROP CONSTRAINT {quote(name)}"))
                connection.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_user_name ON collections (user_id, name)"
                ))
                for table_name in ("scans", "collections", "feedback"):
                    connection.execute(text(f"ALTER TABLE {table_name} ALTER COLUMN user_id SET NOT NULL"))
    # create_all does not add columns to an existing SQLite database. Keep old
    # local data intact and add nullable ownership columns in-place.
    if settings.database_url.startswith("sqlite"):
        with engine.begin() as connection:
            inspector = inspect(connection)
            for table_name in ("scans", "collections", "feedback"):
                columns = {column["name"] for column in inspector.get_columns(table_name)}
                if "user_id" not in columns:
                    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN user_id VARCHAR(36)"))
            for table_name in ("scans", "collections", "feedback"):
                connection.execute(text(
                    f"CREATE INDEX IF NOT EXISTS ix_{table_name}_user_id ON {table_name} (user_id)"
                ))
