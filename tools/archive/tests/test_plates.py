import math

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from phoenix_archive.plates import PLATE_DIAMETER, PlateFinder, circles

W, H = 640, 360
R = 48  # plate radius in pixels


def scene(cx: float, cy: float, rng: np.random.Generator, distractor: tuple[int, int, int] | None = None) -> np.ndarray:
    """A grey room with noise, a plate (dark disc, lighter rim, bright hub) and optionally something else round."""
    img = np.full((H, W, 3), 120, np.uint8)
    img = np.clip(img.astype(np.int16) + rng.integers(-12, 13, (H, W, 1)), 0, 255).astype(np.uint8)
    cv2.rectangle(img, (0, 300), (W, H), (90, 90, 90), -1)  # floor
    c = (round(cx), round(cy))
    cv2.circle(img, c, R, (30, 30, 30), -1)
    cv2.circle(img, c, R, (200, 200, 200), 3)
    cv2.circle(img, c, 6, (230, 230, 230), -1)
    if distractor:
        cv2.circle(img, distractor[:2], distractor[2], (240, 240, 240), 3)
    return img


def bar_path(n: int):
    """Two reps: down 1 s, up 1 s, at 15 fps; 120 px of travel."""
    out = []
    for i in range(n):
        t = i / 15
        ph = (t % 2.0) / 2.0
        y = 150 + 120 * math.sin(math.pi * ph)
        out.append((t, 320 + 6 * math.sin(2 * math.pi * ph), y))
    return out


def test_finds_the_plate_in_a_frame():
    rng = np.random.default_rng(0)
    found = circles(scene(300, 160, rng), None)
    assert found
    x, y, r, _ = found[0]
    assert abs(x - 300) < 3 and abs(y - 160) < 3 and abs(r - R) < 4


def test_follows_the_plate_through_a_set_and_ignores_other_round_things():
    rng = np.random.default_rng(1)
    pf = PlateFinder()
    path = bar_path(60)
    for i, (t, x, y) in enumerate(path):
        # a smaller ring on the wall in some frames, and the plate hidden for two frames
        d = (90, 80, 26) if i % 3 == 0 else None
        img = scene(x, y, rng, d)
        if i in (20, 21):
            cv2.rectangle(img, (int(x) - 70, int(y) - 70), (int(x) + 70, int(y) + 70), (120, 120, 120), -1)
        pf.add(t, img, None)
    bar = pf.result()
    assert bar is not None
    assert bar["diameter"] == PLATE_DIAMETER
    assert abs(bar["r"] * W - R) < 4
    assert bar["found"] > 0.9
    # the hidden frames are filled in, and every point is on the true path
    assert len(bar["t"]) == 60
    truth = {round(t, 3): (x, y) for t, x, y in path}
    for t, x, y in zip(bar["t"], bar["x"], bar["y"]):
        tx, ty = truth[t]
        assert abs(x * W - tx) < 4 and abs(y * H - ty) < 4


def test_nothing_without_a_plate():
    rng = np.random.default_rng(2)
    pf = PlateFinder()
    for i in range(30):
        img = np.full((H, W, 3), 120, np.uint8)
        img = np.clip(img.astype(np.int16) + rng.integers(-12, 13, (H, W, 1)), 0, 255).astype(np.uint8)
        pf.add(i / 15, img, None)
    assert pf.result() is None


def test_only_looks_near_the_hands_and_shoulders():
    rng = np.random.default_rng(3)
    img = scene(500, 150, rng)
    lm = [0.0] * 99
    for i in (11, 12, 15, 16):  # shoulders and wrists, far from the plate
        lm[i * 3: i * 3 + 3] = [0.15, 0.4, 0.9]
    # a body big enough for a 48 px plate: eyes near the top, heels near the floor
    lm[2 * 3: 2 * 3 + 3] = [0.15, 0.1, 0.9]
    lm[29 * 3: 29 * 3 + 3] = [0.15, 0.95, 0.9]
    for i in range(23, 29):
        lm[i * 3: i * 3 + 3] = [0.15, 0.6 + 0.05 * (i - 23), 0.9]
    assert circles(img, lm) == []
    for i in (15, 16):  # now the hands are at the plate
        lm[i * 3: i * 3 + 3] = [500 / W, 150 / H, 0.9]
    found = circles(img, lm)
    assert found and abs(found[0][0] - 500) < 3


def test_adds_plates_to_a_clip_tracked_before(tmp_path):
    import gzip
    import json
    import shutil

    if not shutil.which("ffmpeg"):
        pytest.skip("needs ffmpeg")
    from phoenix_archive.process import add_plates

    rng = np.random.default_rng(4)
    clip = tmp_path / "clips" / "abc"
    clip.mkdir(parents=True)
    path = bar_path(45)
    vw = cv2.VideoWriter(str(clip / "proxy.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), 15, (W, H))
    for _, x, y in path:
        vw.write(cv2.cvtColor(scene(x, y, rng), cv2.COLOR_RGB2BGR))
    vw.release()
    track = {"id": "abc", "width": W, "height": H, "fps": 15, "frames": [{"t": round(t, 3), "lm": None, "people": 0} for t, _, _ in path]}
    with gzip.open(clip / "track.json.gz", "wb") as f:
        f.write(json.dumps(track).encode())
    (clip / "clip.json").write_text(json.dumps({"id": "abc", "proxy": "proxy.mp4"}))

    assert add_plates(clip) == "added"
    with gzip.open(clip / "track.json.gz", "rb") as f:
        t = json.loads(f.read())
    assert t["bar"]["found"] > 0.8
    assert abs(t["bar"]["r"] * W - R) < 5
    assert t["frames"] == track["frames"]  # the joint track itself is untouched
    assert add_plates(clip) == "has"
    (clip / "clip.json").write_text(json.dumps({"id": "abc"}))
    assert add_plates(clip, redo=True).startswith("skipped")
