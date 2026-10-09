"""Pose tracking with the same MediaPipe model, settings and output format as the app
(src/vision/runner.ts), so tracks made here and in the browser can be compared directly."""
from __future__ import annotations

import hashlib
import math
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np

MODEL_ID = "mediapipe-pose-landmarker-full/float16/1"
MODEL_FILE = "pose_landmarker_full.task"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
MODEL_SHA256 = "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"

LANDMARKS = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]
LM = {n: i for i, n in enumerate(LANDMARKS)}


def cache_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "phoenix-archive"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def ensure_model(path: str | None = None, log=print) -> str:
    """The model file, downloaded once and checked against its pinned SHA-256."""
    if path:
        p = Path(path)
        if not p.is_file():
            raise SystemExit(f"Model not found: {p}")
        if _sha256(p) != MODEL_SHA256:
            raise SystemExit(f"{p} isn't the expected model (SHA-256 differs). Download it from {MODEL_URL}")
        return str(p)
    p = cache_dir() / MODEL_FILE
    if p.is_file() and _sha256(p) == MODEL_SHA256:
        return str(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    log(f"Downloading the pose model (9 MB) to {p} …")
    tmp = p.with_suffix(".part")
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=120) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    except Exception as e:  # noqa: BLE001 - any network problem gets the same advice
        raise SystemExit(f"Couldn't download the model ({e}).\nDownload it in a browser from\n  {MODEL_URL}\nand pass --model PATH.") from e
    if _sha256(tmp) != MODEL_SHA256:
        tmp.unlink(missing_ok=True)
        raise SystemExit("The downloaded model didn't match its checksum; try again.")
    tmp.replace(p)
    return str(p)


class Tracker:
    """A MediaPipe Pose Landmarker. VIDEO mode follows people from frame to frame; IMAGE mode treats each frame alone."""

    def __init__(self, model_path: str, video: bool, num_poses: int = 2) -> None:
        import mediapipe as mp
        from mediapipe.tasks import python as mpp
        from mediapipe.tasks.python import vision

        self._mp = mp
        opts = vision.PoseLandmarkerOptions(
            base_options=mpp.BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.VIDEO if video else vision.RunningMode.IMAGE,
            num_poses=num_poses,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._lmk = vision.PoseLandmarker.create_from_options(opts)
        self._video = video

    def detect(self, rgb: np.ndarray, t_ms: int = 0):
        img = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        return self._lmk.detect_for_video(img, t_ms) if self._video else self._lmk.detect(img)

    def close(self) -> None:
        if self._lmk is not None:
            self._lmk.close()
            self._lmk = None

    def __enter__(self) -> "Tracker":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def _round(x: float, k: float) -> float:
    # JavaScript's Math.round (halves go up), so values match the app's
    return math.floor(x * k + 0.5) / k


def to_frame(t: float, result) -> dict:
    """One frame in the app's PoseFrame format: the largest person, 33 × [x, y, visibility], world points, people count."""
    people = len(result.pose_landmarks)
    if not people:
        return {"t": _round(t, 1e3), "lm": None, "people": 0}
    best, best_area = 0, -1.0
    for i, lms in enumerate(result.pose_landmarks):
        xs = [p.x for p in lms]
        ys = [p.y for p in lms]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > best_area:
            best, best_area = i, area
    lm: list[float] = []
    for p in result.pose_landmarks[best]:
        lm += [_round(p.x, 1e4), _round(p.y, 1e4), _round(p.visibility or 0.0, 1e3)]
    world = None
    if len(result.pose_world_landmarks) > best:
        world = []
        for p in result.pose_world_landmarks[best]:
            world += [_round(p.x, 1e3), _round(p.y, 1e3), _round(p.z, 1e3)]
    return {"t": _round(t, 1e3), "lm": lm, "world": world, "people": people}


# ---------------------------------------------------------------- measurements (ports of src/vision)

def _pt(lm: list[float], name: str, min_v: float) -> tuple[float, float] | None:
    i = LM[name] * 3
    return (lm[i], lm[i + 1]) if lm[i + 2] >= min_v else None


def body_height_share(lm: list[float] | None) -> float | None:
    """Top of head to feet as a share of the frame height (quality.ts bodyHeightShare)."""
    if not lm:
        return None
    top = [p[1] for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear") if (p := _pt(lm, n, 0.3))]
    bottom = [p[1] for n in ("left_heel", "right_heel", "left_foot_index", "right_foot_index", "left_ankle", "right_ankle") if (p := _pt(lm, n, 0.3))]
    if not top or not bottom:
        return None
    return max(bottom) - min(top) + 0.06


def frontness(lm: list[float] | None, w: int, h: int) -> float | None:
    """Shoulder width over trunk length: small side-on, large front-on (quality.ts frontness)."""
    if not lm:
        return None
    pts = [_pt(lm, n, 0.3) for n in ("left_shoulder", "right_shoulder", "left_hip", "right_hip")]
    if any(p is None for p in pts):
        return None
    ls, rs, lh, rh = pts  # type: ignore[misc]
    shoulders = math.hypot((ls[0] - rs[0]) * w, (ls[1] - rs[1]) * h)
    trunk = math.hypot(((ls[0] + rs[0] - lh[0] - rh[0]) / 2) * w, ((ls[1] + rs[1] - lh[1] - rh[1]) / 2) * h)
    return shoulders / trunk if trunk > 0 else None


def view_from_frontness(r: float) -> str:
    return "side" if r < 0.35 else "angle" if r < 0.65 else "front"


ANGLES = {"knee": ("hip", "knee", "ankle"), "hip": ("shoulder", "hip", "knee"), "elbow": ("shoulder", "elbow", "wrist")}


def joint_angle(lm: list[float] | None, joint: str, side: str, w: int, h: int, min_v: float = 0.5) -> float | None:
    if not lm:
        return None
    pts = []
    for part in ANGLES[joint]:
        p = _pt(lm, f"{side}_{part}", min_v)
        if p is None:
            return None
        pts.append((p[0] * w, p[1] * h))
    a, b, c = pts
    u, v = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    nu, nv = math.hypot(*u), math.hypot(*v)
    if not nu or not nv:
        return None
    return math.degrees(math.acos(max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)))))


def image_stats(rgb: np.ndarray, frame: dict | None) -> dict:
    """Brightness, contrast, sharpness and the brightness inside the person's box, on a 256-pixel-wide copy (runner.ts imageStats)."""
    import cv2

    H0, W0 = rgb.shape[:2]
    W = 256
    H = max(1, round(W * H0 / W0))
    small = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_AREA).astype(np.float64)
    g = 0.2126 * small[..., 0] + 0.7152 * small[..., 1] + 0.0722 * small[..., 2]
    lap = g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4 * g[1:-1, 1:-1]
    out = {"luma": float(g.mean() / 255), "contrast": float(g.std() / 255), "sharpness": float(lap.var())}
    lm = frame.get("lm") if frame else None
    if lm:
        xs = [lm[k * 3] for k in range(33) if lm[k * 3 + 2] > 0.5]
        ys = [lm[k * 3 + 1] for k in range(33) if lm[k * 3 + 2] > 0.5]
        if len(xs) > 4:
            x0, x1 = max(0, math.floor(min(xs) * W)), min(W, math.ceil(max(xs) * W))
            y0, y1 = max(0, math.floor(min(ys) * H)), min(H, math.ceil(max(ys) * H))
            if x1 > x0 and y1 > y0:
                out["subjectLuma"] = float(g[y0:y1, x0:x1].mean() / 255)
    return out


def mean_stats(stats: list[dict]) -> dict | None:
    if not stats:
        return None
    out = {}
    for key in ("luma", "contrast", "sharpness", "subjectLuma"):
        v = [s[key] for s in stats if key in s]
        if v:
            out[key] = sum(v) / len(v)
    return out
