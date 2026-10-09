"""What has been done already, so a run can stop at any point and carry on later.

Each source (a file, or a video inside a zip) is remembered by where it is,
its size and modified time, and which clip it turned out to be. The clips
themselves live in clips/<id>/ with their own clip.json, which is what the
index and merging are built from.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

from .sources import Source

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
  key TEXT PRIMARY KEY,
  rel TEXT NOT NULL,
  size INTEGER,
  mtime REAL,
  clip TEXT,
  status TEXT NOT NULL,
  error TEXT,
  updated REAL,
  date INTEGER,
  date_source TEXT
);
CREATE INDEX IF NOT EXISTS sources_clip ON sources(clip);
"""

DONE = ("done", "duplicate")


class State:
    def __init__(self, path: Path) -> None:
        self.db = sqlite3.connect(str(path))
        self.db.executescript(SCHEMA)

    def is_done(self, src: Source) -> bool:
        row = self.db.execute("SELECT size, mtime, status FROM sources WHERE key = ?", (src.key,)).fetchone()
        if not row:
            return False
        size, mtime, status = row
        same = size == src.size and (mtime is None or src.mtime is None or abs(mtime - src.mtime) < 2)
        return same and status in DONE

    def record(self, src: Source, clip: str | None, status: str, error: str | None = None,
               date: int | None = None, date_source: str | None = None) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO sources (key, rel, size, mtime, clip, status, error, updated, date, date_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (src.key, src.rel, src.size, src.mtime, clip, status, error, time.time(), date, date_source))
        self.db.commit()

    def copies(self) -> dict[str, list[dict]]:
        """Every place each clip was found, with the date that copy suggests."""
        out: dict[str, list[dict]] = {}
        for clip, rel, date, ds in self.db.execute("SELECT clip, rel, date, date_source FROM sources WHERE clip IS NOT NULL ORDER BY rel"):
            out.setdefault(clip, []).append({"rel": rel, "date": date, "dateSource": ds})
        return out

    def errors(self) -> list[tuple[str, str]]:
        return list(self.db.execute("SELECT rel, error FROM sources WHERE status = 'error' ORDER BY rel"))

    def merge_from(self, other: Path) -> None:
        src = sqlite3.connect(str(other))
        rows = src.execute("SELECT key, rel, size, mtime, clip, status, error, updated, date, date_source FROM sources").fetchall()
        src.close()
        self.db.executemany("INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        self.db.commit()

    def close(self) -> None:
        self.db.close()


class RunLock:
    """Stops two runs writing to the same output folder at once. The lock is refreshed while a run
    is going, so one left behind by a crash or a power cut is ignored after two minutes."""

    STALE = 120

    def __init__(self, out: Path) -> None:
        self.path = out / ".running"
        if self.path.exists() and time.time() - self.path.stat().st_mtime < self.STALE:
            raise SystemExit(f"Another run is using {out} (or one stopped less than two minutes ago). "
                             "Use a different --out folder for each machine, then merge them.")
        self._stop = threading.Event()
        self._touch()
        self._thread = threading.Thread(target=self._beat, daemon=True)
        self._thread.start()

    def _touch(self) -> None:
        self.path.write_text(json.dumps({"pid": os.getpid(), "at": time.time()}))

    def _beat(self) -> None:
        while not self._stop.wait(30):
            try:
                self._touch()
            except OSError:
                pass

    def release(self) -> None:
        self._stop.set()
        try:
            self.path.unlink()
        except OSError:
            pass
