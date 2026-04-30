from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime


CURRENT_SCHEMA_VERSION = 1


BASE_SCHEMA_SQL = """
create table if not exists schema_version (
  version integer primary key,
  applied_at text not null
);
create table if not exists settings (
  key text primary key,
  value text not null
);
create table if not exists gpus (
  idx integer primary key,
  payload text not null
);
create table if not exists models (
  id text primary key,
  payload text not null,
  created_at text not null,
  updated_at text not null
);
create table if not exists model_files (
  id integer primary key autoincrement,
  model_id text not null,
  manager_path text not null,
  container_path text not null,
  kind text not null
);
create table if not exists download_jobs (
  id text primary key,
  payload text not null,
  created_at text not null,
  updated_at text not null
);
create table if not exists staged_configs (
  id text primary key,
  yaml text not null,
  diff text not null,
  created_at text not null,
  expires_at text,
  fingerprint text not null default '',
  model_ids text not null default '[]',
  applied_at text
);
"""


def initialize_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(BASE_SCHEMA_SQL)
    current_version = schema_version(conn)
    if current_version > CURRENT_SCHEMA_VERSION:
        raise RuntimeError(
            f"database schema version {current_version} is newer than supported version {CURRENT_SCHEMA_VERSION}"
        )
    for version in range(current_version + 1, CURRENT_SCHEMA_VERSION + 1):
        migration = MIGRATIONS.get(version)
        if migration is None:
            raise RuntimeError(f"missing database migration for schema version {version}")
        migration(conn)
        record_schema_version(conn, version)


def schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("select max(version) from schema_version").fetchone()
    return int(row[0] or 0) if row else 0


def record_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(
        "insert or ignore into schema_version(version, applied_at) values(?, ?)",
        (version, datetime.now(UTC).isoformat()),
    )


def migrate_staged_config_metadata(conn: sqlite3.Connection) -> None:
    columns = _column_names(conn, "staged_configs")
    migrations = {
        "expires_at": "alter table staged_configs add column expires_at text",
        "fingerprint": "alter table staged_configs add column fingerprint text not null default ''",
        "model_ids": "alter table staged_configs add column model_ids text not null default '[]'",
        "applied_at": "alter table staged_configs add column applied_at text",
    }
    for column, statement in migrations.items():
        if column not in columns:
            conn.execute(statement)


def _column_names(conn: sqlite3.Connection, table_name: str) -> set[str]:
    columns: set[str] = set()
    for row in conn.execute(f"pragma table_info({table_name})").fetchall():
        columns.add(row["name"] if isinstance(row, sqlite3.Row) else row[1])
    return columns


MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {
    1: migrate_staged_config_metadata,
}
