"""What happens to each video (runs in worker processes).

1. Copy it out of its zip if needed, and fingerprint it (SHA-256) so copies are done once.
2. Read what's in the file and work out when it was filmed.
3. Sort: look at about one frame a second. Is someone there, big enough, and how many people?
4. Usable clips: track the joints at 15 frames a second (10 for clips over 45 s), the
   same as the app, and save a small copy and a thumbnail.
"""
from __future__ import annotations

import gzip
import json
import math
import os
import signal
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

from . import VERSION
from .dates import resolve
from .media import Info, MediaError, fit, frames, make_proxy, make_thumb, probe
from .pose import MODEL_ID, Tracker, body_height_share, frontness, image_stats, joint_angle, mean_stats, to_frame, view_from_frontness
from .sources import Source, materialize

# Sorting thresholds
MIN_FOUND = 0.3  # share of sampled frames with a person
MIN_SIZE = 0.2  # person's height as a share of the frame
TRIAGE_SAMPLES = 60
TRIAGE_EDGE = 480
TRACK_EDGE = 640


@dataclass
class Options:
    out: str
    model: str
    tmp: str
    fps: float | None = None
    proxy_short: int = 480
    min_size: float = MIN_SIZE


_opts: Options | None = None
_image: Tracker | None = None


def init_worker(opts: Options) -> None:
    global _opts, _image
    # Ctrl+C is handled by the main process, which lets clips in progress finish
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    # MediaPipe's native code logs to stderr; keep that out of the progress lines
    logs = Path(opts.out) / "logs"
    logs.mkdir(exist_ok=True)
    try:
        fd = os.open(logs / f"worker-{os.getpid()}.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND)
        os.dup2(fd, 2)
        os.close(fd)
    except OSError:
        pass
    _opts = opts
    _image = Tracker(opts.model, video=False, num_poses=4)


def _write_json(path: Path, data, gz: bool = False) -> None:
    tmp = path.with_name(path.name + ".tmp")
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with (gzip.open(tmp, "wb", compresslevel=6) if gz else open(tmp, "wb")) as f:
        f.write(raw)
    os.replace(tmp, path)


def _median(v: list[float]) -> float | None:
    return statistics.median(v) if v else None


def _triage_fps(duration: float) -> float:
    if duration <= 0:
        return 1.0
    if duration < 4:
        return min(4.0, 4 / duration)
    return min(1.0, TRIAGE_SAMPLES / duration)


def triage(path: str, info: Info, min_size: float) -> dict:
    """About one frame a second: is there a person, how big, how many, from which side, and do they move?"""
    assert _image is not None
    size = fit(info.width, info.height, TRIAGE_EDGE)
    fps = _triage_fps(info.duration)
    samples, sig, psig = [], [], []
    for rgb in frames(path, fps, size, timeout=max(120.0, info.duration * 2)):
        f = to_frame(0, _image.detect(rgb))
        samples.append(f)
        sig.append(frame_hash(rgb))
        psig.append(pose_print(f["lm"]))
    n = len(samples)
    seen = [f for f in samples if f["lm"]]
    found = len(seen) / n if n else 0.0
    people = [f["people"] for f in samples if f["people"]]
    sizes = []
    for f in seen:
        s = body_height_share(f["lm"])
        if s is None:  # head or feet out of frame: use the visible points
            ys = [f["lm"][k * 3 + 1] for k in range(33) if f["lm"][k * 3 + 2] > 0.5]
            s = (max(ys) - min(ys)) if len(ys) > 4 else None
        if s is not None:
            sizes.append(min(1.2, s))
    fr = [r for f in seen if (r := frontness(f["lm"], info.width, info.height)) is not None]
    # movement: the biggest change in a knee, hip or elbow angle on the better-seen side
    rom = 0.0
    for joint in ("knee", "hip", "elbow"):
        for side in ("left", "right"):
            a = [v for f in seen if (v := joint_angle(f["lm"], joint, side, info.width, info.height)) is not None]
            if len(a) >= 3:
                rom = max(rom, max(a) - min(a))
    out = {
        "samples": n,
        "found": round(found, 3),
        "people": max(people) if people else 0,
        "peopleTypical": round(_median(people) or 0, 1),
        "bodySize": round(_median(sizes), 3) if sizes else None,
        "frontness": round(_median(fr), 3) if fr else None,
        "view": view_from_frontness(_median(fr)) if fr else None,
        "movement": round(rom, 1),
        "fps": round(fps, 4),
        "sig": sig,
        "psig": psig,
    }
    if not n:
        out["decision"], out["reason"] = "skipped", "no frames could be read"
    elif found < MIN_FOUND:
        out["decision"], out["reason"] = "skipped", "no person" if not seen else "person rarely in view"
    elif out["bodySize"] is not None and out["bodySize"] < min_size:
        out["decision"], out["reason"] = "skipped", "person too small in the frame"
    else:
        out["decision"], out["reason"] = "usable", None
    return out


def track(path: str, info: Info, cid: str, fps_opt: float | None) -> dict:
    """The full pass, in the app's PoseTrack format."""
    assert _opts is not None
    fps = fps_opt or (10 if info.duration > 45 else 15)
    size = fit(info.width, info.height, TRACK_EDGE)
    expected = max(1, math.floor(info.duration * fps))
    stat_every = max(1, expected // 8)
    out_frames, stats = [], []
    with Tracker(_opts.model, video=True, num_poses=2) as tracker:
        for i, rgb in enumerate(frames(path, fps, size, timeout=max(300.0, info.duration * 8))):
            t = i / fps
            if info.duration and t > info.duration:
                break
            f = to_frame(t, tracker.detect(rgb, int(round(t * 1000))))
            out_frames.append(f)
            if i % stat_every == 0:
                stats.append(image_stats(rgb, f))
    track = {"id": cid, "model": MODEL_ID, "createdAt": int(time.time() * 1000), "width": info.width, "height": info.height,
             "fps": fps, "frames": out_frames}
    if info.fps:
        track["sourceFps"] = round(info.fps, 2)
    image = mean_stats(stats)
    if image:
        track["image"] = image
    return track


# shoulders, elbows, wrists, hips, knees, ankles
_PRINT_POINTS = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)


def pose_print(lm: list[float] | None) -> list[int] | None:
    """Where the main joints are, in thousandths of the frame: copies of a clip match to within a few
    thousandths frame by frame, while two different sets drift apart as soon as their timing or depth differs."""
    if not lm:
        return None
    return [int(round(lm[i * 3 + k] * 1000)) for i in _PRINT_POINTS for k in (0, 1)]


def frame_hash(rgb) -> str:
    """A 256-bit fingerprint of a frame (difference hash on a 17×16 grey copy). Copies of a clip have
    near-identical fingerprints frame after frame; different sets filmed from the same spot don't."""
    import cv2

    g = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (17, 16), interpolation=cv2.INTER_AREA)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return f"{int(''.join('1' if b else '0' for b in bits), 2):064x}"


def process(src: Source) -> dict:
    """Returns {source, clip, status, error?}; the clip's details are written to clips/<id>/clip.json."""
    assert _opts is not None
    started = time.time()
    try:
        with materialize(src, _opts.tmp) as (path, cid):
            clip_dir = Path(_opts.out) / "clips" / cid
            # a copy of a clip already done: keep the date this copy suggests (a Takeout sidecar may know better)
            quick, quick_source = resolve(src.sidecar, {}, src.name, src.mtime)
            dup = {"source": src.key, "clip": cid, "status": "duplicate", "date": quick, "dateSource": quick_source}
            if (clip_dir / "clip.json").exists():
                return dup
            clip_dir.mkdir(parents=True, exist_ok=True)
            try:
                fd = os.open(clip_dir / ".claim", os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
            except FileExistsError:
                return dup
            try:
                row = _process(src, path, cid, clip_dir)
                row["seconds"] = round(time.time() - started, 1)
                _write_json(clip_dir / "clip.json", row)
            finally:
                try:
                    os.remove(clip_dir / ".claim")
                except OSError:
                    pass
            return {"source": src.key, "clip": cid, "status": "done", "decision": row["status"], "reason": row.get("reason"),
                    "date": row.get("date"), "dateSource": row.get("dateSource"), "duration": row.get("duration"), "view": (row.get("triage") or {}).get("view"),
                    "people": (row.get("triage") or {}).get("people")}
    except MediaError as e:
        return {"source": src.key, "clip": None, "status": "error", "error": str(e)}
    except Exception as e:  # noqa: BLE001 - one bad file must not stop a night's run
        return {"source": src.key, "clip": None, "status": "error", "error": f"{type(e).__name__}: {e}"[:300]}


def _process(src: Source, path: str, cid: str, clip_dir: Path) -> dict:
    assert _opts is not None
    info = probe(path)
    date, date_source = resolve(src.sidecar, info.tags, src.name, src.mtime)
    row: dict = {
        "id": cid, "name": src.name, "rel": src.rel, "date": date, "dateSource": date_source,
        "duration": round(info.duration, 3), "width": info.width, "height": info.height,
        "fps": info.fps, "captureFps": info.capture_fps, "slowmo": info.slowmo, "codec": info.codec,
        "rotation": info.rotation, "bytes": src.size, "tool": VERSION, "model": MODEL_ID,
        "processedAt": int(time.time() * 1000),
    }
    if src.sidecar and src.sidecar.get("description"):
        row["description"] = str(src.sidecar["description"])[:500]
    thumb = clip_dir / "thumb.jpg"
    try:
        make_thumb(path, str(thumb), info, min(info.duration * 0.3, 1.5))
        row["thumb"] = "thumb.jpg"
    except MediaError:
        pass
    if info.duration < 1:
        row["status"], row["reason"] = "skipped", "shorter than a second"
        return row
    tri = triage(path, info, _opts.min_size)
    row["sig"] = tri.pop("sig")
    row["psig"] = tri.pop("psig")
    row["triage"] = tri
    row["status"], row["reason"] = tri.pop("decision"), tri.pop("reason")
    if row["status"] != "usable":
        return row
    t = track(path, info, cid, _opts.fps)
    _write_json(clip_dir / "track.json.gz", t, gz=True)
    seen = [f for f in t["frames"] if f["lm"]]
    row["track"] = "track.json.gz"
    row["frames"] = len(t["frames"])
    row["tracked"] = round(len(seen) / len(t["frames"]), 3) if t["frames"] else 0
    if _opts.proxy_short:
        w, h = make_proxy(path, str(clip_dir / "proxy.mp4"), info, _opts.proxy_short, timeout=max(600.0, info.duration * 10))
        row["proxy"] = "proxy.mp4"
        row["proxyWidth"], row["proxyHeight"] = w, h
        row["proxyBytes"] = (clip_dir / "proxy.mp4").stat().st_size
    return row
