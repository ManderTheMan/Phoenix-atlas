"""Read a Phoenix Atlas dataset and measure knee angles from the pose landmarks.

    python knee_angles.py path/to/dataset-folder

Uses only the Python standard library. For each squat or lunge video it:
  1. loads the 33 landmarks the pose model found in every analysed frame,
  2. picks the side of the body nearer the camera,
  3. computes the knee angle (hip - knee - ankle) in pixels,
  4. finds the reps (dips of 25 degrees or more) and prints depth and tempo,
  5. compares the tracker with any hand-drawn "Knee" angle at the same moment.
"""
import csv
import json
import math
import sys
from pathlib import Path


def angle(a, b, c):
    """Angle at b, in degrees, between the segments b->a and b->c."""
    ux, uy = a[0] - b[0], a[1] - b[1]
    vx, vy = c[0] - b[0], c[1] - b[1]
    nu, nv = math.hypot(ux, uy), math.hypot(vx, vy)
    if not nu or not nv:
        return None
    cos = max(-1.0, min(1.0, (ux * vx + uy * vy) / (nu * nv)))
    return math.degrees(math.acos(cos))


def knee_series(track, min_visibility=0.5):
    names = track["landmark_names"]
    w, h = track["width"], track["height"]
    # the side whose leg the model sees best is the one facing the camera
    score = {s: 0.0 for s in ("left", "right")}
    for f in track["frames"]:
        if f["landmarks"]:
            for s in score:
                for part in ("hip", "knee", "ankle"):
                    score[s] += f["landmarks"][names.index(f"{s}_{part}")][2]
    side = max(score, key=score.get)
    idx = [names.index(f"{side}_{p}") for p in ("hip", "knee", "ankle")]
    out = []
    for f in track["frames"]:
        lm = f["landmarks"]
        if not lm or min(lm[i][2] for i in idx) < min_visibility:
            out.append((f["t"], None))
            continue
        # landmarks are fractions of the frame: scale to pixels so angles are true to the picture
        pts = [(lm[i][0] * w, lm[i][1] * h) for i in idx]
        out.append((f["t"], angle(*pts)))
    return side, out


def smooth(series, window=5):
    half = window // 2
    vals = [v for _, v in series]
    out = []
    for i, (t, v) in enumerate(series):
        near = [x for x in vals[max(0, i - half): i + half + 1] if x is not None]
        out.append((t, sum(near) / len(near) if v is not None and near else None))
    return out


def reps(series, min_rom=25, min_gap=0.6):
    pts = [(t, v) for t, v in series if v is not None]
    lows = []
    for i in range(1, len(pts) - 1):
        if pts[i][1] <= pts[i - 1][1] and pts[i][1] < pts[i + 1][1]:
            if lows and pts[i][0] - pts[lows[-1]][0] < min_gap:
                if pts[i][1] < pts[lows[-1]][1]:
                    lows[-1] = i
            else:
                lows.append(i)
    found = []
    for k, m in enumerate(lows):
        lo = lows[k - 1] if k else 0
        hi = lows[k + 1] if k + 1 < len(lows) else len(pts) - 1
        s = max(range(lo, m + 1), key=lambda i: pts[i][1])
        e = max(range(m, hi + 1), key=lambda i: pts[i][1])
        if min(pts[s][1], pts[e][1]) - pts[m][1] >= min_rom:
            found.append({"start": pts[s][0], "bottom": pts[m][0], "end": pts[e][0], "depth": pts[m][1]})
    return found


def main(folder):
    root = Path(folder)
    with open(root / "metadata.csv", newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    clips = [r for r in rows if r["kind"] == "video" and r["pattern"] in ("squat", "lunge") and r["pose_tracked"] == "true"]
    if not clips:
        print("No tracked squat or lunge videos in this dataset.")
        return
    for r in clips:
        track = json.loads((root / "annotations" / "pose" / f"{r['id']}.json").read_text())
        side, raw = knee_series(track)
        series = smooth(raw)
        found = reps(series)
        print(f"\n{r['id']}  ({r['date']}, {side} side to camera, {len(found)} reps)")
        for i, rep in enumerate(found, 1):
            print(f"  rep {i}: knee {rep['depth']:5.1f} deg at {rep['bottom']:.2f} s, "
                  f"{rep['bottom'] - rep['start']:.2f} s down, {rep['end'] - rep['bottom']:.2f} s up")
        marks_file = root / "annotations" / "marks" / f"{r['id']}.json"
        if marks_file.exists():
            for m in json.loads(marks_file.read_text())["marks"]:
                if m["label"] == "Knee" and m["source"] == "hand" and m["time_s"] is not None:
                    t = min(series, key=lambda p: abs(p[0] - m["time_s"]))
                    if t[1] is not None:
                        print(f"  hand-drawn knee {m['value']:.1f} deg at {m['time_s']:.2f} s; tracker {t[1]:.1f} deg "
                              f"({t[1] - m['value']:+.1f})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
