"""The bar from the plates. Filmed side-on, the end of a loaded bar is the centre of a round plate,
and full-size plates are 45 cm across (bumpers and the big iron plates alike), so the plate gives both
the real bar path and a metric scale, independent of the lifter's proportions.

Each frame's round shapes come from a Hough circle search near the lifter's hands and shoulders (where a
bar end can be). One plate is then followed through the clip: its size should hardly change, and it can't
jump far between frames, so the best chain of circles is picked with a Viterbi pass (a frame can also
have none, when a hand or a rack hides the plate). Clips filmed at an angle show the plate as an ellipse
and usually give nothing, which is the right answer: the joint track still works for them.
"""
from __future__ import annotations

import math

import numpy as np

PLATE_DIAMETER = 0.45  # metres
# landmarks a bar end sits near: shoulders (back squat), wrists (deadlift, bench, press)
_NEAR = (11, 12, 15, 16)
_MAX_CANDIDATES = 8
_NONE_COST = 1.6  # a frame without the plate, against keeping a poor circle


def _expected_radius(lm: list[float] | None, w: int, h: int) -> tuple[float, float]:
    """Radius range (pixels) for a 45 cm plate, from the lifter's size in the frame (assuming 1.5–2.0 m tall)."""
    lo, hi = 0.035 * min(w, h), 0.35 * min(w, h)
    if not lm:
        return lo, hi
    ys = [lm[i * 3 + 1] for i in range(33) if lm[i * 3 + 2] >= 0.5]
    if len(ys) < 8:
        return lo, hi
    body = (max(ys) - min(ys)) * h  # eyes to heels: about 0.9 of standing height
    if body < 0.15 * h:
        return lo, hi
    # standing tall, eyes to heels is ~0.9 of stature; crouched or lying it's less, hence the wide range
    per_m_hi = body / (0.9 * 1.5)
    per_m_lo = body / (0.9 * 2.0) * 0.55
    return max(lo * 0.5, PLATE_DIAMETER / 2 * per_m_lo), min(hi, PLATE_DIAMETER / 2 * per_m_hi * 1.25)


def circles(rgb: np.ndarray, lm: list[float] | None) -> list[tuple[float, float, float, float]]:
    """Round shapes that could be a plate on the bar: (x, y, r, closeness), best first. closeness is the
    distance to the nearest hand or shoulder in radii (0 without a pose)."""
    import cv2

    h, w = rgb.shape[:2]
    grey = cv2.medianBlur(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), 5)
    r_lo, r_hi = _expected_radius(lm, w, h)
    if r_hi <= r_lo + 2:
        return []
    found = cv2.HoughCircles(grey, cv2.HOUGH_GRADIENT, dp=1.2, minDist=max(8.0, r_lo), param1=100, param2=28,
                             minRadius=int(r_lo), maxRadius=math.ceil(r_hi))
    if found is None:
        return []
    near = []
    if lm:
        near = [(lm[i * 3] * w, lm[i * 3 + 1] * h) for i in _NEAR if lm[i * 3 + 2] >= 0.5]
    out = []
    for x, y, r in found[0][: _MAX_CANDIDATES * 2]:
        d = min((math.hypot(x - px, y - py) for px, py in near), default=0.0) / max(r, 1.0)
        if near and d > 2.5:
            continue  # nowhere near the hands or shoulders: a wheel, a clock, a light
        out.append((float(x), float(y), float(r), float(d)))
        if len(out) >= _MAX_CANDIDATES:
            break
    return out


class PlateFinder:
    """Collects each frame's candidate circles, then follows one plate through the clip."""

    def __init__(self) -> None:
        self.t: list[float] = []
        self.cands: list[list[tuple[float, float, float, float]]] = []
        self.size: tuple[int, int] | None = None

    def add(self, t: float, rgb: np.ndarray, lm: list[float] | None) -> None:
        self.size = (rgb.shape[1], rgb.shape[0])
        self.t.append(t)
        try:
            self.cands.append(circles(rgb, lm))
        except Exception:  # noqa: BLE001 - a frame OpenCV can't search is a frame without a plate
            self.cands.append([])

    def result(self, min_found: float = 0.4) -> dict | None:
        """{diameter, r, t, x, y}: the plate centre per frame (x, y as fractions of the frame; r as a fraction of its
        width), or None when no plate was followed through enough of the clip."""
        if not self.size or not self.t:
            return None
        w, h = self.size
        # the plate's size: the commonest radius among the best few circles of each frame
        top = [c[2] for cs in self.cands for c in cs[:2]]
        if len(top) < max(3, min_found * len(self.t)):
            return None
        hist, edges = np.histogram(top, bins=max(5, int(math.sqrt(len(top)))))
        k = int(np.argmax(hist))
        mode = [r for r in top if edges[k] <= r <= edges[k + 1]]
        R = float(np.median(mode))
        cands = [[c for c in cs if abs(c[2] - R) <= 0.2 * R] for cs in self.cands]

        # Viterbi over each frame's circles plus "not seen"
        def emit(i: int, c: tuple[float, float, float, float]) -> float:
            return 0.15 * i + 0.25 * min(c[3], 2.5) + 2.0 * abs(c[2] - R) / R

        n = len(cands)
        cost: list[list[float]] = []
        back: list[list[int]] = []
        for f in range(n):
            states = cands[f] + [None]  # type: ignore[list-item]
            row, brow = [], []
            for j, c in enumerate(states):
                e = _NONE_COST if c is None else emit(j, c)
                if f == 0:
                    row.append(e)
                    brow.append(-1)
                    continue
                prev = cands[f - 1] + [None]  # type: ignore[list-item]
                best, arg = math.inf, -1
                for i, p in enumerate(prev):
                    if c is None or p is None:
                        tr = 0.0
                    else:
                        jump = math.hypot(c[0] - p[0], c[1] - p[1]) / R
                        tr = 0.4 * jump + (25.0 if jump > 1.5 else 0.0)  # at 15 fps a bar moves well under a radius a frame
                    v = cost[f - 1][i] + tr
                    if v < best:
                        best, arg = v, i
                row.append(best + e)
                brow.append(arg)
            cost.append(row)
            back.append(brow)
        j = int(np.argmin(cost[-1]))
        path: list[tuple[float, float, float, float] | None] = [None] * n
        for f in range(n - 1, -1, -1):
            states = cands[f] + [None]  # type: ignore[list-item]
            path[f] = states[j]
            j = back[f][j]

        seen = [i for i, c in enumerate(path) if c is not None]
        if len(seen) < min_found * n:
            return None
        radii = [path[i][2] for i in seen]  # type: ignore[index]
        if np.std(radii) / np.mean(radii) > 0.12:
            return None  # not one plate seen face-on
        # fill short gaps (a hand passing in front) by straight lines; leave long ones out
        out_t, out_x, out_y = [], [], []
        for a, b in zip(seen, seen[1:] + [None]):
            pa = path[a]
            out_t.append(self.t[a])
            out_x.append(pa[0])  # type: ignore[index]
            out_y.append(pa[1])  # type: ignore[index]
            if b is not None and 1 < b - a <= 4:
                pb = path[b]
                for k2 in range(a + 1, b):
                    f2 = (k2 - a) / (b - a)
                    out_t.append(self.t[k2])
                    out_x.append(pa[0] + (pb[0] - pa[0]) * f2)  # type: ignore[index]
                    out_y.append(pa[1] + (pb[1] - pa[1]) * f2)  # type: ignore[index]
        r_med = float(np.median(radii))
        return {
            "diameter": PLATE_DIAMETER,
            "r": round(r_med / w, 4),
            "t": [round(t, 3) for t in out_t],
            "x": [round(x / w, 4) for x in out_x],
            "y": [round(y / h, 4) for y in out_y],
            "found": round(len(seen) / n, 3),
        }
