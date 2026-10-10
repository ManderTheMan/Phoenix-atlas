"""Looking through what was found: numbered contact sheets, and your labels.

`sheets` draws every clip as a numbered tile (three frames from its small copy,
or the photo) on pages of a few dozen, with sheets.csv listing what each number
is. Fill in the keep/purpose/pattern/pose/note columns of that CSV (or any CSV
with an id or number column) and `label` folds it into labels.json, which the
index, report, packs, collect and the app all read.
"""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

from .index import LABEL_FIELDS, load_labels, rebuild

# the app's movement patterns (src/movement/patterns.ts), and everyday names for them
PATTERNS = ("squat", "hinge", "lunge", "pushH", "pushV", "pullH", "pullV", "carry", "rotation", "gait")
ALIASES = {
    "squat": "squat", "back squat": "squat", "front squat": "squat", "goblet squat": "squat", "box squat": "squat", "leg press": "squat",
    "hinge": "hinge", "deadlift": "hinge", "sumo deadlift": "hinge", "rdl": "hinge", "romanian deadlift": "hinge", "good morning": "hinge",
    "hip thrust": "hinge", "kettlebell swing": "hinge", "clean": "hinge", "snatch": "hinge",
    "lunge": "lunge", "split squat": "lunge", "bulgarian split squat": "lunge", "step up": "lunge", "step-up": "lunge",
    "pushh": "pushH", "push h": "pushH", "bench": "pushH", "bench press": "pushH", "push-up": "pushH", "push up": "pushH", "pushup": "pushH", "dip": "pushH",
    "pushv": "pushV", "push v": "pushV", "ohp": "pushV", "overhead press": "pushV", "press": "pushV", "push press": "pushV", "jerk": "pushV",
    "handstand push-up": "pushV",
    "pullh": "pullH", "pull h": "pullH", "row": "pullH", "barbell row": "pullH", "cable row": "pullH", "inverted row": "pullH",
    "pullv": "pullV", "pull v": "pullV", "pull-up": "pullV", "pull up": "pullV", "pullup": "pullV", "chin-up": "pullV", "chin up": "pullV",
    "chinup": "pullV", "lat pulldown": "pullV", "pulldown": "pullV", "muscle-up": "pullV",
    "carry": "carry", "farmer carry": "carry", "farmers walk": "carry", "suitcase carry": "carry",
    "rotation": "rotation", "woodchop": "rotation", "landmine rotation": "rotation",
    "gait": "gait", "run": "gait", "running": "gait", "walk": "gait", "walking": "gait", "sprint": "gait",
}
YES = {"yes", "y", "true", "1", "keep", "x"}
NO = {"no", "n", "false", "0", "drop", "skip"}
PURPOSES = ("form", "progress", "other")
POSES = ("front", "side", "back", "other")


def _font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow before 10.1
        return ImageFont.load_default()


def _frames_from_video(path: Path, at: tuple[float, ...]) -> list:
    """Frames at the given fractions of a video, as PIL images."""
    import cv2
    from PIL import Image

    cap = cv2.VideoCapture(str(path))
    out = []
    try:
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        for f in at:
            if n > 0:
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(n - 1, int(n * f))))
            ok, bgr = cap.read()
            if ok:
                out.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    finally:
        cap.release()
    return out


def _fit_into(img, w: int, h: int):
    from PIL import Image

    k = min(w / img.width, h / img.height)
    return img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)


def _tile(out: Path, r: dict, number: int, frame: int):
    """Three frames (or the photo) side by side, the number big in the corner, the date and facts underneath."""
    from PIL import Image, ImageDraw

    caption = 30
    tile = Image.new("RGB", (frame * 3 + 8, frame + caption), (24, 26, 31))
    d = out / "clips" / r["id"]
    pics = []
    if r.get("kind") != "photo" and r.get("proxy") and (d / r["proxy"]).exists():
        pics = _frames_from_video(d / r["proxy"], (0.15, 0.5, 0.85))
    if not pics:
        for name in ((r.get("proxy"),) if r.get("kind") == "photo" else ()) + (r.get("thumb"),):
            if name and (d / name).exists():
                try:
                    pics = [Image.open(d / name).convert("RGB")]
                    break
                except OSError:
                    pass
    if len(pics) == 1:
        p = _fit_into(pics[0], frame * 3, frame)
        tile.paste(p, (4 + (frame * 3 - p.width) // 2, (frame - p.height) // 2))
    for i, pic in enumerate(pics if len(pics) > 1 else []):
        p = _fit_into(pic, frame - 4, frame)
        tile.paste(p, (4 + i * frame + (frame - p.width) // 2, (frame - p.height) // 2))
    draw = ImageDraw.Draw(tile)
    big = _font(28)
    label = f"{number}"
    box = draw.textbbox((0, 0), label, font=big)
    draw.rectangle((0, 0, box[2] + 14, box[3] + 10), fill=(240, 120, 40))
    draw.text((7, 3), label, font=big, fill=(0, 0, 0))
    when = datetime.fromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d") if r.get("date") else "undated"
    t = r.get("triage") or {}
    facts = [when, "photo" if r.get("kind") == "photo" else f"{int((r.get('duration') or 0) // 60)}:{int((r.get('duration') or 0) % 60):02d}"]
    if t.get("view"):
        facts.append(f"{t['view']}-on" if t["view"] != "angle" else "angled")
    if (t.get("people") or 0) > 1:
        facts.append(f"{t['people']} people")
    if r.get("status") != "usable":
        facts.append(f"skipped: {r.get('reason')}")
    lab = r.get("label") or {}
    if lab:
        facts.append("/".join(str(lab[k]) for k in ("keep", "pattern", "pose") if lab.get(k)))
    draw.text((6, frame + 6), "  ·  ".join(facts)[:90], font=_font(16), fill=(225, 228, 235))
    return tile


def sheets(out: Path, dest: Path | None = None, which: str = "usable", cols: int = 3, rows_per: int = 6, frame: int = 180,
           include_copies: bool = False, unreviewed: bool = False, kinds: str = "all") -> tuple[list[Path], Path]:
    """Numbered contact sheets (JPEG) and sheets.csv mapping each number to its clip."""
    from PIL import Image

    dest = dest or out / "sheets"
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("sheet-*.jpg"):
        old.unlink()
    rows = rebuild(out)
    pick = [r for r in rows
            if (which == "all" or r.get("status") == which)
            and (include_copies or not r.get("nearDuplicateOf"))
            and (not unreviewed or not r.get("label"))
            and (kinds == "all" or (r.get("kind") or "video") == kinds.rstrip("s"))]
    pick.sort(key=lambda r: (r.get("date") or 0, r["id"]))
    per = cols * rows_per
    paths: list[Path] = []
    listing: list[dict] = []
    tw, th = frame * 3 + 8, frame + 30
    for start in range(0, len(pick), per):
        chunk = pick[start:start + per]
        page = Image.new("RGB", (cols * tw + (cols + 1) * 6, ((len(chunk) + cols - 1) // cols) * th + ((len(chunk) + cols - 1) // cols + 1) * 6), (10, 11, 14))
        for i, r in enumerate(chunk):
            n = start + i + 1
            page.paste(_tile(out, r, n, frame), (6 + (i % cols) * (tw + 6), 6 + (i // cols) * (th + 6)))
            lab = r.get("label") or {}
            listing.append({"sheet": len(paths) + 1, "number": n, "id": r["id"], "kind": r.get("kind") or "video",
                            "date": datetime.fromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d %H:%M") if r.get("date") else "",
                            "duration": r.get("duration") or "", "name": r.get("name") or "", "status": r.get("status"), "reason": r.get("reason") or "",
                            "view": (r.get("triage") or {}).get("view") or "", "people": (r.get("triage") or {}).get("people") or "",
                            **{k: lab.get(k, "") for k in ("keep", "purpose", "pattern", "variant", "pose", "note")}})
        p = dest / f"sheet-{len(paths) + 1:03d}.jpg"
        page.save(p, "JPEG", quality=82)
        paths.append(p)
    csv_path = dest / "sheets.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["sheet", "number", "id", "kind", "date", "duration", "name", "status", "reason", "view", "people",
                                          "keep", "purpose", "pattern", "variant", "pose", "note"])
        w.writeheader()
        w.writerows(listing)
    return paths, csv_path


def _norm_pattern(v: str) -> tuple[str | None, str | None]:
    """A pattern id and, when an everyday name was used, that name as the variant."""
    low = " ".join(v.strip().lower().replace("_", " ").split())
    if not low:
        return None, None
    if low in ALIASES:
        pid = ALIASES[low]
        return pid, (None if low.replace(" ", "") == pid.lower() else v.strip())
    for p in PATTERNS:
        if low == p.lower():
            return p, None
    return None, None


def import_labels(out: Path, csv_path: Path) -> tuple[int, list[str]]:
    """Folds a CSV of labels into labels.json. Rows name a clip by id (or by number, from sheets.csv). Empty cells change nothing."""
    numbers: dict[str, str] = {}
    sheet_csv = out / "sheets" / "sheets.csv"
    if sheet_csv.exists():
        with open(sheet_csv, newline="", encoding="utf-8-sig") as f:
            numbers = {row["number"]: row["id"] for row in csv.DictReader(f) if row.get("number") and row.get("id")}
    known = {p.parent.name for p in (out / "clips").glob("*/clip.json")}
    labels = load_labels(out)
    problems: list[str] = []
    changed = 0
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        for line, row in enumerate(csv.DictReader(f), start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            cid = row.get("id") or numbers.get(row.get("number", ""))
            if not cid or cid not in known:
                if any(row.get(k) for k in LABEL_FIELDS):
                    problems.append(f"line {line}: no clip with id/number {row.get('id') or row.get('number') or '?'}")
                continue
            lab = dict(labels.get(cid) or {})
            keep = row.get("keep", "").lower()
            if keep:
                if keep in YES:
                    lab["keep"] = "yes"
                elif keep in NO:
                    lab["keep"] = "no"
                else:
                    problems.append(f"line {line}: keep should be yes or no (got {keep})")
            purpose = row.get("purpose", "").lower()
            if purpose:
                if purpose in PURPOSES:
                    lab["purpose"] = purpose
                else:
                    problems.append(f"line {line}: purpose should be one of {', '.join(PURPOSES)} (got {purpose})")
            if row.get("pattern"):
                pid, variant = _norm_pattern(row["pattern"])
                if pid:
                    lab["pattern"] = pid
                    if variant and not row.get("variant"):
                        lab["variant"] = variant
                else:
                    problems.append(f"line {line}: unknown pattern {row['pattern']!r} (use {', '.join(PATTERNS)} or a lift name such as deadlift)")
            if row.get("variant"):
                lab["variant"] = row["variant"][:80]
            pose = row.get("pose", "").lower()
            if pose:
                if pose in POSES:
                    lab["pose"] = pose
                else:
                    problems.append(f"line {line}: pose should be one of {', '.join(POSES)} (got {pose})")
            if row.get("note"):
                lab["note"] = row["note"][:500]
            if lab != (labels.get(cid) or {}):
                labels[cid] = lab
                changed += 1
    tmp = out / "labels.json.tmp"
    tmp.write_text(json.dumps(labels, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(out / "labels.json")
    rebuild(out)
    return changed, problems
