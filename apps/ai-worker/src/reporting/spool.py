"""Events that could not be delivered wait here, on disk, and are retried with a growing delay."""

import json
import sqlite3
import threading
import time
from typing import Callable, Tuple

import config


class DiskSpool:
    def __init__(self, path: str = config.SPOOL_PATH, max_rows: int = config.SPOOL_MAX_ROWS, max_attempts: int = config.SPOOL_MAX_ATTEMPTS):
        self.path = path
        self.max_rows = max_rows
        self.max_attempts = max_attempts
        self.lock = threading.Lock()
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS spool (event_key TEXT PRIMARY KEY, endpoint TEXT NOT NULL, payload TEXT NOT NULL,"
                " attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL, created_at REAL NOT NULL)"
            )

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def count(self) -> int:
        with self.lock, self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM spool").fetchone()[0]

    def add(self, event_key: str, endpoint: str, payload: dict) -> None:
        now = time.time()
        with self.lock, self._conn() as c:
            c.execute(
                "INSERT OR IGNORE INTO spool (event_key, endpoint, payload, next_at, created_at) VALUES (?,?,?,?,?)",
                (event_key, endpoint, json.dumps(payload), now, now),
            )
            overflow = c.execute("SELECT COUNT(*) FROM spool").fetchone()[0] - self.max_rows
            if overflow > 0:  # the disk must not fill up: the oldest events go first
                c.execute("DELETE FROM spool WHERE event_key IN (SELECT event_key FROM spool ORDER BY created_at LIMIT ?)", (overflow,))

    @staticmethod
    def delay_for(attempts: int) -> float:
        return float(min(2 ** attempts, 300))  # 2 s, 4 s, ... capped at 5 minutes

    def flush(self, send: Callable[[str, dict, str], int], batch: int = 50) -> Tuple[int, int]:
        """send(endpoint, payload, event_key) -> HTTP status (0 = could not reach). Returns (delivered, dropped)."""
        delivered = dropped = 0
        with self.lock, self._conn() as c:
            rows = c.execute(
                "SELECT event_key, endpoint, payload, attempts FROM spool WHERE next_at <= ? ORDER BY created_at LIMIT ?",
                (time.time(), batch),
            ).fetchall()
        for key, endpoint, payload, attempts in rows:
            status = send(endpoint, json.loads(payload), key)
            with self.lock, self._conn() as c:
                if status in (200, 202):
                    c.execute("DELETE FROM spool WHERE event_key=?", (key,))
                    delivered += 1
                elif status == 0 or status >= 500 or status == 429:  # temporary: try again later
                    if attempts + 1 >= self.max_attempts:
                        c.execute("DELETE FROM spool WHERE event_key=?", (key,))
                        dropped += 1
                    else:
                        c.execute(
                            "UPDATE spool SET attempts=?, next_at=? WHERE event_key=?",
                            (attempts + 1, time.time() + self.delay_for(attempts + 1), key),
                        )
                else:  # the API refused the event for good (4xx): retrying would never help
                    c.execute("DELETE FROM spool WHERE event_key=?", (key,))
                    dropped += 1
                    print(f"[spool] dropped {key}: API answered {status}")
            if status == 0:
                break  # the API is unreachable: stop this round instead of waiting on every row
        return delivered, dropped
