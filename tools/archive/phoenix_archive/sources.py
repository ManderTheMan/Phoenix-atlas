"""Finding videos in folders and in zip files (Google Takeout exports included).

Every video gets a Source: where it is (a file, or a member of a zip), a stable
key for resuming, a path relative to the input it was found under (the same on
every machine that sees the same inputs, which is what sharding uses), and its
Google Takeout sidecar when there is one.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import zipfile
from contextlib import contextmanager
from datetime import datetime
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Iterator

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".3gp", ".3g2", ".mkv", ".webm", ".avi", ".mts", ".m2ts", ".mpg", ".mpeg", ".wmv"}
# Clips smaller than this are usually a second or two of nothing.
MIN_BYTES = 20_000
MAX_SIDECAR_BYTES = 256_000
SKIP_DIRS = {"__MACOSX", ".Trash", ".Trashes", "$RECYCLE.BIN", "System Volume Information", ".thumbnails", "@eaDir"}


@dataclass
class Source:
    key: str
    rel: str
    path: str
    member: str | None
    name: str
    size: int
    mtime: float | None
    sidecar: dict | None = field(default=None, repr=False)

    @property
    def in_zip(self) -> bool:
        return self.member is not None


def is_video(name: str) -> bool:
    return PurePosixPath(name).suffix.lower() in VIDEO_EXT


def dir_key(rel_dir: str) -> str:
    """Folder used to pair a video with its sidecar: the part after 'Takeout/' when there is one,
    so a video and its sidecar match even when they are in different parts of a split export."""
    p = rel_dir.replace("\\", "/").strip("/")
    i = p.find("Takeout/")
    if i >= 0:
        p = p[i + len("Takeout/"):]
    elif p == "Takeout":
        p = ""
    return p.lower()


# ---------------------------------------------------------------- Takeout sidecars

class Sidecars:
    """Google Photos Takeout writes a JSON file next to each photo or video with the time it was taken."""

    def __init__(self) -> None:
        self.by_file: dict[tuple[str, str], dict] = {}  # (dir key, sidecar file name lower) -> json
        self.by_title: dict[tuple[str, str], dict] = {}  # (dir key, title lower) -> json
        self.global_title: dict[str, list[dict]] = {}

    def add(self, rel_dir: str, file_name: str, data: dict) -> None:
        if not isinstance(data, dict) or not ("photoTakenTime" in data or "creationTime" in data):
            return
        dk = dir_key(rel_dir)
        self.by_file[(dk, file_name.lower())] = data
        title = str(data.get("title") or "").lower()
        if title:
            self.by_title.setdefault((dk, title), data)
            self.global_title.setdefault(title, []).append(data)

    def find(self, rel_dir: str, name: str) -> dict | None:
        dk = dir_key(rel_dir)
        low = name.lower()
        # "VID_1(1).mp4" has its sidecar at "VID_1.mp4(1).json"
        m = re.match(r"^(.*)\((\d+)\)(\.[^.]+)$", low)
        variants = [low]
        if m:
            variants.append(f"{m[1]}{m[3]}({m[2]})")
        for v in variants:
            for suffix in (".json", ".supplemental-metadata.json"):
                hit = self.by_file.get((dk, v + suffix))
                if hit:
                    return hit
            if m and v != low:
                hit = self.by_file.get((dk, f"{m[1]}{m[3]}.supplemental-metadata({m[2]}).json"))
                if hit:
                    return hit
        # edited copies share the original's sidecar
        base = re.sub(r"-(edited|bearbeitet|modifié|editado)(\.[^.]+)$", r"\2", low)
        hit = self.by_title.get((dk, low)) or self.by_title.get((dk, base))
        if hit:
            return hit
        # long names are cut short in sidecar file names: the longest sidecar name that is a prefix
        full = low + ".supplemental-metadata"
        best, best_len = None, 0
        for (d, f), data in self.by_file.items():
            if d != dk:
                continue
            stem = f[:-5] if f.endswith(".json") else f
            if len(stem) >= 20 and full.startswith(stem) and len(stem) > best_len:
                best, best_len = data, len(stem)
        if best:
            return best
        g = self.global_title.get(low)
        if g and len(g) == 1:
            return g[0]
        return None


def _load_json(raw: bytes) -> dict | None:
    try:
        data = json.loads(raw.decode("utf-8", errors="replace"))
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


# ---------------------------------------------------------------- scanning

def _walk(root: Path) -> Iterator[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            if not f.startswith("._"):
                yield Path(dirpath) / f


def scan(inputs: list[str], on_warning=print) -> list[Source]:
    """All videos under the given folders, files and zips, with their Takeout sidecars attached."""
    sidecars = Sidecars()
    found: list[tuple[Source, str]] = []  # (source, rel dir for sidecar lookup)

    def add_zip(zpath: Path, label: str) -> None:
        try:
            zf = zipfile.ZipFile(zpath)
        except (zipfile.BadZipFile, OSError) as e:
            on_warning(f"  skipped {zpath}: not a readable zip ({e})")
            return
        with zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = PurePosixPath(info.filename)
                if any(part in SKIP_DIRS for part in name.parts) or name.name.startswith("._"):
                    continue
                rel_dir = str(name.parent)
                if name.suffix.lower() == ".json" and info.file_size <= MAX_SIDECAR_BYTES:
                    data = _load_json(zf.read(info))
                    if data:
                        sidecars.add(rel_dir, name.name, data)
                elif is_video(name.name) and info.file_size >= MIN_BYTES:
                    rel = f"{label}::{info.filename}"
                    try:
                        mtime = datetime(*info.date_time).timestamp()
                    except (ValueError, OverflowError):
                        mtime = None
                    found.append((Source(key=f"zip:{zpath.resolve()}::{info.filename}", rel=rel, path=str(zpath), member=info.filename,
                                         name=name.name, size=info.file_size, mtime=mtime), rel_dir))

    for inp in inputs:
        p = Path(inp).expanduser()
        if not p.exists():
            on_warning(f"  not found: {inp}")
            continue
        if p.is_file():
            if p.suffix.lower() == ".zip":
                add_zip(p, p.name)
            elif is_video(p.name):
                st = p.stat()
                found.append((Source(key=f"file:{p.resolve()}", rel=p.name, path=str(p), member=None, name=p.name, size=st.st_size, mtime=st.st_mtime), ""))
            continue
        for f in _walk(p):
            rel = f.relative_to(p).as_posix()
            suffix = f.suffix.lower()
            try:
                st = f.stat()
            except OSError:
                continue
            if suffix == ".zip":
                add_zip(f, rel)
            elif suffix == ".json" and st.st_size <= MAX_SIDECAR_BYTES:
                try:
                    data = _load_json(f.read_bytes())
                except OSError:
                    data = None
                if data:
                    sidecars.add(str(PurePosixPath(rel).parent), f.name, data)
            elif is_video(f.name) and st.st_size >= MIN_BYTES:
                found.append((Source(key=f"file:{f.resolve()}", rel=rel, path=str(f), member=None, name=f.name, size=st.st_size, mtime=st.st_mtime),
                              str(PurePosixPath(rel).parent)))

    seen: set[str] = set()
    out: list[Source] = []
    for src, rel_dir in found:
        if src.key in seen:
            continue
        seen.add(src.key)
        src.sidecar = sidecars.find(rel_dir, src.name)
        out.append(src)
    return out


def in_shard(src: Source, shard: tuple[int, int] | None) -> bool:
    """Shard i of n (1-based): splits the work between machines that see the same inputs."""
    if not shard:
        return True
    i, n = shard
    h = int(hashlib.sha1(src.rel.encode("utf-8")).hexdigest()[:8], 16)
    return h % n == i - 1


# ---------------------------------------------------------------- reading

_zips: dict[str, zipfile.ZipFile] = {}


def _zip(path: str) -> zipfile.ZipFile:
    zf = _zips.get(path)
    if zf is None:
        zf = _zips[path] = zipfile.ZipFile(path)
    return zf


CHUNK = 4 << 20


@contextmanager
def materialize(src: Source, tmp_dir: str) -> Iterator[tuple[str, str]]:
    """A local file to read the video from, and the content id (first 16 hex digits of its SHA-256).
    Zip members are copied to a temporary file and removed afterwards."""
    h = hashlib.sha256()
    if not src.in_zip:
        with open(src.path, "rb") as f:
            while chunk := f.read(CHUNK):
                h.update(chunk)
        yield src.path, h.hexdigest()[:16]
        return
    os.makedirs(tmp_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=PurePosixPath(src.name).suffix.lower(), dir=tmp_dir)
    try:
        with os.fdopen(fd, "wb") as out, _zip(src.path).open(src.member) as f:
            while chunk := f.read(CHUNK):
                h.update(chunk)
                out.write(chunk)
        yield tmp, h.hexdigest()[:16]
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
