"""Reading videos with ffmpeg: what is in the file, decoded frames, a small copy and a thumbnail.

ffmpeg handles what browsers often can't: H.265/HEVC, rotated phone video,
variable frame rates, slow motion and old camcorder formats.
"""
from __future__ import annotations

import json
import shutil
import sys
import subprocess
import threading
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Iterator

import numpy as np


class MediaError(Exception):
    pass


# ffmpeg runs in its own process group so Ctrl+C reaches only the main process, which lets clips
# in progress finish instead of saving half-decoded tracks
_DETACH: dict = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if sys.platform == "win32" else {"start_new_session": True}


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} wasn't found. Install ffmpeg (see tools/archive/README.md) and try again.")


def _rate(s: str | None) -> float | None:
    try:
        f = Fraction(s) if s else None
    except (ValueError, ZeroDivisionError):
        return None
    return float(f) if f and f > 0 else None


@dataclass
class Info:
    width: int  # as displayed (after rotation and pixel aspect)
    height: int
    duration: float
    fps: float | None  # average frame rate of the file
    capture_fps: float | None  # frame rate it was filmed at, when the phone records it (slow motion)
    codec: str
    rotation: int
    has_audio: bool
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def slowmo(self) -> bool:
        return bool((self.capture_fps and self.fps and self.capture_fps > self.fps * 1.5) or (self.fps and self.fps >= 100))


def probe(path: str, timeout: float = 120) -> Info:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                             capture_output=True, timeout=timeout, check=False, **_DETACH)
    except subprocess.TimeoutExpired as e:
        raise MediaError("ffprobe took too long") from e
    try:
        data = json.loads(out.stdout or b"{}")
    except ValueError as e:
        raise MediaError("ffprobe couldn't read the file") from e
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    if not video:
        raise MediaError("no video stream")
    fmt = data.get("format") or {}
    tags = {k.lower(): str(v) for k, v in (fmt.get("tags") or {}).items()}
    tags.update({k.lower(): str(v) for k, v in (video.get("tags") or {}).items() if k.lower() not in tags})
    rotation = 0
    for sd in video.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                rotation = int(round(float(sd["rotation"])))
            except (TypeError, ValueError):
                pass
    if not rotation and "rotate" in tags:
        try:
            rotation = int(tags["rotate"])
        except ValueError:
            pass
    w, h = int(video.get("width") or 0), int(video.get("height") or 0)
    sar = _rate(video.get("sample_aspect_ratio")) or 1.0
    if 0.3 < sar < 3 and abs(sar - 1) > 0.01:
        w = int(round(w * sar))
    if abs(rotation) % 180 == 90:
        w, h = h, w
    if not w or not h:
        raise MediaError("the video has no size")
    try:
        duration = float(fmt.get("duration") or video.get("duration") or 0)
    except ValueError:
        duration = 0.0
    if duration <= 0:
        duration = _tag_duration(tags.get("duration")) or measure_duration(path)
    fps = _rate(video.get("avg_frame_rate")) or _rate(video.get("r_frame_rate"))
    if fps and fps > 1000:  # nonsense from some containers
        fps = _rate(video.get("r_frame_rate"))
    capture = None
    for key in ("com.android.capture.fps", "com.apple.quicktime.capture.fps"):
        try:
            capture = float(tags[key]) if key in tags else capture
        except ValueError:
            pass
    return Info(width=w, height=h, duration=duration, fps=round(fps, 3) if fps else None, capture_fps=capture,
                codec=str(video.get("codec_name") or "?"), rotation=rotation,
                has_audio=any(s.get("codec_type") == "audio" for s in streams), tags=tags)


def _tag_duration(v: str | None) -> float:
    """Matroska/WebM DURATION tags look like 00:00:05.640000000."""
    if not v:
        return 0.0
    try:
        h, m, sec = v.split(":")
        return int(h) * 3600 + int(m) * 60 + float(sec)
    except ValueError:
        return 0.0


def measure_duration(path: str, timeout: float = 600) -> float:
    """Length of files that don't record it (browser recordings, some WebM and MKV): read through
    the packets without decoding and take the last timestamp."""
    try:
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "null", "-progress", "pipe:1", "-nostats", "-"],
                           capture_output=True, timeout=timeout, check=False, **_DETACH)
    except subprocess.TimeoutExpired:
        return 0.0
    us = 0
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        if line.startswith("out_time_us="):
            try:
                us = max(us, int(line.split("=", 1)[1]))
            except ValueError:
                pass
    return us / 1e6


def fit(w: int, h: int, long_edge: int) -> tuple[int, int]:
    """Size with the longest side at most long_edge, even numbers (video encoders need them)."""
    k = min(1.0, long_edge / max(w, h))
    return max(2, int(round(w * k / 2)) * 2), max(2, int(round(h * k / 2)) * 2)


def fit_short(w: int, h: int, short_edge: int) -> tuple[int, int]:
    k = min(1.0, short_edge / min(w, h))
    return max(2, int(round(w * k / 2)) * 2), max(2, int(round(h * k / 2)) * 2)


def frames(path: str, fps: float, size: tuple[int, int], timeout: float) -> Iterator[np.ndarray]:
    """Upright RGB frames at a steady rate (frame i is at i / fps seconds)."""
    w, h = size
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-an", "-sn", "-dn",
           "-vf", f"fps={fps:.6g},scale={w}:{h}:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **_DETACH)
    timed_out = threading.Event()

    def kill() -> None:
        timed_out.set()
        p.kill()

    timer = threading.Timer(timeout, kill)
    timer.start()
    n = w * h * 3
    count = 0
    try:
        assert p.stdout is not None
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n:
                break
            count += 1
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        try:
            _, err = p.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            p.kill()
            err = b""
        if timed_out.is_set():
            raise MediaError("decoding took too long")
        # a damaged end is fine when most of the clip decoded
        if p.returncode and err and not count:
            raise MediaError(err.decode("utf-8", "replace").strip().splitlines()[-1][:200])
    finally:
        timer.cancel()
        if p.poll() is None:
            p.kill()
            p.wait()


def run_ffmpeg(args: list[str], timeout: float) -> None:
    try:
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", *args], capture_output=True, timeout=timeout, check=False, **_DETACH)
    except subprocess.TimeoutExpired as e:
        raise MediaError("ffmpeg took too long") from e
    if r.returncode != 0:
        msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
        raise MediaError(msg[-1][:200] if msg else f"ffmpeg failed ({r.returncode})")


def make_proxy(src: str, dst: str, info: Info, short_edge: int, timeout: float) -> tuple[int, int]:
    """A small H.264 copy without sound or metadata (no location, no device details), upright, at most 30 fps."""
    w, h = fit_short(info.width, info.height, short_edge)
    vf = f"scale={w}:{h}"
    if info.fps and info.fps > 31:
        vf += ",fps=30"
    run_ffmpeg(["-i", src, "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-vf", vf,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], timeout)
    return w, h


def make_thumb(src: str, dst: str, info: Info, at: float, long_edge: int = 360) -> None:
    w, h = fit(info.width, info.height, long_edge)
    run_ffmpeg(["-ss", f"{max(0.0, at):.3f}", "-i", src, "-map", "0:v:0", "-frames:v", "1", "-vf", f"scale={w}:{h}",
                "-map_metadata", "-1", "-q:v", "5", dst], 120)
