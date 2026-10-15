"""Automatic additive schema check, run at startup.

`Base.metadata.create_all` only builds *missing tables*; it never adds columns
to tables that already exist. This module closes that gap for the one kind of
change this project makes: adding a nullable (or server-defaulted) column.
Everything else — renames, retypes, drops, new constraints on existing tables —
stays a manual, documented step, exactly as before.
"""
import logging

from sqlalchemy import text
from sqlalchemy.schema import CreateColumn

from .config import settings
from .models import Base

log = logging.getLogger("schema")


def _addable(col) -> bool:
    # A column can only be ALTERed into a table that already has rows if every
    # existing row can do without a value for it.
    return col.nullable or col.server_default is not None


def ensure_columns(engine) -> list[tuple[str, str]]:
    """Adds model columns missing from existing tables. Returns what was added.

    Safe to run any number of times; the information_schema check makes it a
    no-op when everything is already in place.
    """
    added = []
    with engine.begin() as conn:
        dialect = engine.dialect
        quote = dialect.identifier_preparer.quote
        for table in Base.metadata.sorted_tables:
            existing = {
                row[0] for row in conn.execute(
                    text("SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                         "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"),
                    {"t": table.name},
                )
            }
            if not existing:
                continue  # table isn't there yet; create_all will build all of it
            for col in table.columns:
                if col.name in existing or not _addable(col):
                    continue
                ddl = str(CreateColumn(col).compile(dialect=dialect))
                try:
                    conn.execute(text(f"ALTER TABLE {quote(table.name)} ADD COLUMN {ddl}"))
                except Exception as exc:
                    # Fatal by design: starting with a stale schema turns every query
                    # into a confusing "unknown column" error, so fail here instead.
                    raise RuntimeError(
                        f"Could not add the column {table.name}.{col.name} ({exc}). "
                        f"The database user needs ALTER rights on '{settings.mysql_database}'. "
                        f"Fix the grants, or run `python -m app.cli migrate` to see the same error by hand."
                    ) from exc
                log.warning("Added column %s.%s", table.name, col.name)  # warning: visible at uvicorn's default log level
                added.append((table.name, col.name))
    return added
