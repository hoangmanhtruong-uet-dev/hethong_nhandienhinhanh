"""Production baseline, account lifecycle and model telemetry.

Revision ID: 20260810_0001
Revises:
Create Date: 2026-08-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.database import Base
from app import models  # noqa: F401


revision = "20260810_0001"
down_revision = None
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Safe baseline: create missing tables without replacing existing Aiven data.
    Base.metadata.create_all(bind=bind)
    tables = set(sa.inspect(bind).get_table_names())
    if "users" not in tables:
        return

    user_columns = _columns(bind, "users")
    if "role" not in user_columns:
        op.add_column("users", sa.Column("role", sa.String(20), nullable=False, server_default="member"))
    if "two_factor_enabled" not in user_columns:
        op.add_column("users", sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "two_factor_secret" not in user_columns:
        op.add_column("users", sa.Column("two_factor_secret", sa.Text(), nullable=True))
    if "email_verified_at" not in user_columns:
        op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index("ix_users_email_verified_at", "users", ["email_verified_at"])

    owner_id = bind.execute(sa.text(
        "SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1"
    )).scalar_one_or_none()
    if owner_id is None:
        owner_id = bind.execute(sa.text("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")).scalar_one_or_none()
        if owner_id:
            bind.execute(sa.text("UPDATE users SET role = 'owner' WHERE id = :id"), {"id": owner_id})

    for table in ("scans", "collections", "feedback"):
        if table not in tables:
            continue
        if "user_id" not in _columns(bind, table):
            op.add_column(table, sa.Column("user_id", sa.String(36), nullable=True))
            op.create_index(f"ix_{table}_user_id", table, ["user_id"])
        if owner_id:
            bind.execute(sa.text(f"UPDATE {table} SET user_id = :owner WHERE user_id IS NULL"), {"owner": owner_id})

    if bind.dialect.name == "postgresql":
        constraints = sa.inspect(bind).get_unique_constraints("collections")
        for constraint in constraints:
            if (constraint.get("column_names") or []) == ["name"] and constraint.get("name"):
                op.drop_constraint(constraint["name"], "collections", type_="unique")
        indexes = {index["name"] for index in sa.inspect(bind).get_indexes("collections")}
        if "uq_collections_user_name" not in indexes:
            op.create_index("uq_collections_user_name", "collections", ["user_id", "name"], unique=True)
        for table in ("scans", "collections", "feedback"):
            if table in tables:
                foreign_keys = sa.inspect(bind).get_foreign_keys(table)
                has_owner_fk = any((key.get("constrained_columns") or []) == ["user_id"] for key in foreign_keys)
                if not has_owner_fk:
                    op.create_foreign_key(
                        f"fk_{table}_user_id_users", table, "users", ["user_id"], ["id"], ondelete="CASCADE"
                    )
                op.alter_column(table, "user_id", existing_type=sa.String(36), nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table in ("model_evaluations", "account_tokens"):
        if table in tables:
            op.drop_table(table)
    if "users" in tables and "email_verified_at" in _columns(bind, "users"):
        indexes = {index["name"] for index in sa.inspect(bind).get_indexes("users")}
        if "ix_users_email_verified_at" in indexes:
            op.drop_index("ix_users_email_verified_at", table_name="users")
        with op.batch_alter_table("users") as batch:
            batch.drop_column("email_verified_at")
