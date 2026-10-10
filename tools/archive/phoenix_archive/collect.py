"""Gathering the originals: a copy of each chosen video or photo, untouched, in one tidy folder.

The files are copied byte for byte (so everything inside them, such as the camera,
the time and the location, comes along) into <dest>/<year>/, named by when they
were taken. Beside each goes <file>.phoenix.json: what the archive found (date and
where it came from, the people and view, your labels, every place a copy was
found) plus, when the run kept it, the file's full metadata and Takeout sidecars.
Your source folders and zips are only ever read.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

from .index import load_meta, parse_day, rebuild
from .sources import CHUNK, open_source, source_from_key
from .state import State


def _safe(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "file"


def target_name(r: dict) -> str:
    """2019-03-12_101500_VID_20190312_101500.mp4: sorts by when it was taken and keeps the original name."""
    name = _safe(r.get("name") or r["id"])
    if not r.get("date"):
        return name
    stamp = datetime.fromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d_%H%M%S")
    return name if name.startswith(stamp) else f"{stamp}_{name}"


def _sidecars(out: Path, cid: str) -> list[dict]:
    found = []
    for p in sorted((out / "clips" / cid).glob("sidecar-*.json")):
        try:
            found.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    return found


def describe(out: Path, r: dict) -> dict:
    """The JSON written beside a collected file."""
    info = {k: r.get(k) for k in ("id", "kind", "name", "status", "reason", "dateSource", "duration", "width", "height", "fps", "captureFps",
                                  "slowmo", "codec", "rotation", "format", "bytes", "description", "nearDuplicateOf") if r.get(k) is not None}
    if r.get("date"):
        info["date"] = datetime.fromtimestamp(r["date"] / 1000).astimezone().isoformat(timespec="seconds")
    if r.get("triage"):
        info["seen"] = {k: v for k, v in r["triage"].items() if k in ("people", "bodySize", "view", "movement", "found")}
    if r.get("label"):
        info["label"] = r["label"]
    info["foundAt"] = r.get("copies") or []
    meta = load_meta(out, r["id"])
    if meta:
        info["metadata"] = meta
    sidecars = _sidecars(out, r["id"])
    if sidecars:
        info["takeout"] = sidecars
    info["collectedBy"] = "phoenix-archive"
    return info


def choose(rows: list[dict], which: str, since: str | None, until: str | None, include_copies: bool, reviewed_only: bool, kinds: str) -> list[dict]:
    lo, hi = parse_day(since), parse_day(until, end=True)
    # a clip you labelled keep=yes comes along even if the tool skipped it (filmed from far away, say)
    return [r for r in rows
            if (which == "all" or r.get("status") == which or (r.get("label") or {}).get("keep") == "yes")
            and (include_copies or not r.get("nearDuplicateOf"))
            and (r.get("label") or {}).get("keep") != "no"
            and (not reviewed_only or (r.get("label") or {}).get("keep") == "yes")
            and (kinds == "all" or (r.get("kind") or "video") == kinds.rstrip("s"))
            and (lo is None or (r.get("date") or 0) >= lo) and (hi is None or (r.get("date") or 0) < hi)]


def collect(out: Path, dest: Path, which: str = "usable", since: str | None = None, until: str | None = None, include_copies: bool = False,
            reviewed_only: bool = False, kinds: str = "all", dry_run: bool = False, log=print) -> dict:
    """Copies the chosen originals to dest. Safe to run again: files already there are left alone."""
    out, dest = out.resolve(), dest.resolve()
    if dest == out or out in dest.parents:
        raise SystemExit("Collect into a folder outside the archive folder.")
    rows = choose(rebuild(out), which, since, until, include_copies, reviewed_only, kinds)
    st = State(out / "state.sqlite")
    where = st.locations()
    st.close()
    total = sum(r.get("bytes") or 0 for r in rows)
    result = {"chosen": len(rows), "bytes": total, "copied": 0, "already": 0, "missing": [], "dest": str(dest)}
    if dry_run or not rows:
        return result
    dest.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(dest).free
    if total > free * 0.95:
        raise SystemExit(f"Not enough space in {dest}: need about {total / (1 << 30):.1f} GB, {free / (1 << 30):.1f} GB free.")
    manifest_path = dest / "collected.csv"
    manifest: dict[str, dict] = {}
    if manifest_path.exists():
        with open(manifest_path, newline="", encoding="utf-8") as f:
            manifest = {row["id"]: row for row in csv.DictReader(f)}
    for n, r in enumerate(rows, start=1):
        cid = r["id"]
        folder = dest / (datetime.fromtimestamp(r["date"] / 1000).strftime("%Y") if r.get("date") else "undated")
        target = folder / target_name(r)
        prev = manifest.get(cid)
        if prev and (dest / prev["file"]).exists() and (dest / prev["file"]).stat().st_size == r.get("bytes"):
            result["already"] += 1
            continue
        if target.exists() and target.stat().st_size != r.get("bytes"):
            target = target.with_name(f"{target.stem}_{cid[:6]}{target.suffix}")
        if not (target.exists() and target.stat().st_size == r.get("bytes")):
            if not _copy_original(where.get(cid) or [], cid, target):
                result["missing"].append(r.get("rel") or r.get("name") or cid)
                continue
            result["copied"] += 1
        else:
            result["already"] += 1
        side = target.with_name(target.name + ".phoenix.json")
        side.write_text(json.dumps(describe(out, r), indent=1, ensure_ascii=False), encoding="utf-8")
        if r.get("date"):
            t = r["date"] / 1000
            os.utime(target, (t, t))  # galleries and file browsers sort by it
        lab = r.get("label") or {}
        manifest[cid] = {"id": cid, "file": target.relative_to(dest).as_posix(), "kind": r.get("kind") or "video",
                         "date": datetime.fromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d %H:%M") if r.get("date") else "",
                         "status": r.get("status"), "keep": lab.get("keep", ""), "pattern": lab.get("pattern", ""), "variant": lab.get("variant", ""),
                         "foundAt": (r.get("copies") or [""])[0]}
        if n % 25 == 0:
            log(f"  {n}/{len(rows)} …")
    with open(manifest_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "file", "kind", "date", "status", "keep", "pattern", "variant", "foundAt"])
        w.writeheader()
        w.writerows(sorted(manifest.values(), key=lambda m: m["file"]))
    return result


def _copy_original(places: list[dict], cid: str, target: Path) -> bool:
    """Copies the first readable copy, checking it is the same content the archive saw (its id is the start of its SHA-256)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    for place in places:
        src = source_from_key(place["key"], place["rel"], place.get("size"), place.get("mtime"))
        if not Path(src.path).exists():
            continue
        h = hashlib.sha256()
        try:
            with open_source(src) as f, open(tmp, "wb") as o:
                while chunk := f.read(CHUNK):
                    h.update(chunk)
                    o.write(chunk)
        except (OSError, KeyError):
            tmp.unlink(missing_ok=True)
            continue
        if h.hexdigest()[:16] != cid:  # changed since the run: not the file the archive describes
            tmp.unlink(missing_ok=True)
            continue
        tmp.replace(target)
        return True
    return False
