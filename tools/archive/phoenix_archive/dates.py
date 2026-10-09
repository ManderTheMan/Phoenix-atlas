"""When a clip was filmed.

Sources, most trusted first:
  takeout   Google Takeout's JSON sidecar (photoTakenTime): survives re-saving
  metadata  the recording time inside the file (Apple's creationdate, or creation_time)
  filename  a date in the file name (VID_20190312_123456, PXL_…, WhatsApp Video 2019-03-12 at …)
  file      the file's modified time (often the day it was copied, so a last resort)
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

# Earliest plausible recording date; containers use 1904/1970 for "unknown".
MIN_YEAR = 2000


def _plausible(dt: datetime) -> bool:
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return MIN_YEAR <= dt.year and dt <= now.replace(year=now.year + 1)


def to_ms(dt: datetime) -> int:
    """Milliseconds since 1970. Times without a zone are taken as this computer's local time."""
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return int(dt.timestamp() * 1000)


def parse_metadata_time(value: str | None) -> datetime | None:
    """ISO-like times from ffprobe tags: 2019-03-12T12:34:56.000000Z, 2019-03-12T12:34:56+0100, '2019-03-12 12:34:56'."""
    if not value:
        return None
    v = value.strip().replace(" ", "T", 1)
    v = re.sub(r"Z$", "+00:00", v)
    v = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", v)  # +0100 -> +01:00
    v = re.sub(r"\.(\d{6})\d+", r".\1", v)  # Python wants at most 6 fraction digits
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    return dt if _plausible(dt) else None


_YMD = r"(?P<y>(?:19|20)\d{2})(?P<s1>[-_.]?)(?P<m>0[1-9]|1[0-2])(?P=s1)(?P<d>0[1-9]|[12]\d|3[01])"
_HMS = r"(?:[-_ T]|\s+at\s+)(?P<H>[01]\d|2[0-3])[-_.:]?(?P<M>[0-5]\d)[-_.:]?(?P<S>[0-5]\d)"
# a date not glued to other digits, optionally followed by a time (and milliseconds, as Pixel phones add)
_NAME_RE = re.compile(rf"(?<!\d){_YMD}(?:{_HMS}\d{{0,3}})?(?!\d)")


def parse_filename_time(name: str) -> datetime | None:
    """A date (and time, when present) in a file name, as local time.

    Handles camera and app names such as VID_20190312_123456.mp4,
    PXL_20230102_030405678.mp4, 20190312_123456.mp4 (Samsung),
    WhatsApp Video 2019-03-12 at 12.34.56.mp4, Screen_Recording_20261008_165821_Instagram.mp4
    and signal-2019-03-12-123456.mp4.
    """
    stem = name.rsplit("/", 1)[-1]
    for m in _NAME_RE.finditer(stem):
        try:
            y, mo, d = int(m["y"]), int(m["m"]), int(m["d"])
            if m["H"] is not None:
                dt = datetime(y, mo, d, int(m["H"]), int(m["M"]), int(m["S"]))
            else:
                dt = datetime(y, mo, d, 12, 0, 0)  # midday: the date is right whatever the time zone
        except ValueError:
            continue
        if _plausible(dt):
            return dt
    return None


def takeout_time(sidecar: dict) -> datetime | None:
    """photoTakenTime from a Google Photos Takeout sidecar (seconds since 1970, UTC)."""
    for key in ("photoTakenTime", "creationTime"):
        ts = (sidecar.get(key) or {}).get("timestamp")
        try:
            dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
        if _plausible(dt):
            return dt
    return None


def resolve(sidecar: dict | None, tags: dict[str, str], name: str, mtime: float | None) -> tuple[int | None, str]:
    """The best date for a clip, in ms, and where it came from."""
    if sidecar:
        dt = takeout_time(sidecar)
        if dt:
            return to_ms(dt), "takeout"
    for key in ("com.apple.quicktime.creationdate", "creation_time", "date"):
        dt = parse_metadata_time(tags.get(key))
        if dt:
            return to_ms(dt), "metadata"
    dt = parse_filename_time(name)
    if dt:
        return to_ms(dt), "filename"
    if mtime:
        dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        if _plausible(dt):
            return to_ms(dt), "file"
    return None, "unknown"
