"""The archive's index, a browsable report, packs for the app, and merging archives from several machines."""
from __future__ import annotations

import csv
import html
import json
import os
import shutil
import time
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from . import VERSION
from .pose import MODEL_ID, MODEL_SHA256
from .state import State

CSV_COLUMNS = ["id", "kind", "status", "reason", "date", "dateSource", "name", "rel", "copies", "duration", "width", "height", "fps", "slowmo",
               "codec", "bytes", "people", "bodySize", "view", "movement", "tracked", "proxyBytes", "nearDuplicateOf",
               "keep", "purpose", "pattern", "variant", "pose", "note", "device", "lat", "lon"]
LABEL_FIELDS = ("keep", "purpose", "pattern", "variant", "pose", "note")


def load_clips(out: Path) -> list[dict]:
    rows = []
    for p in sorted((out / "clips").glob("*/clip.json")):
        try:
            rows.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return rows


DATE_RANK = {"takeout": 4, "metadata": 3, "filename": 2, "file": 1, "unknown": 0}


def best_date(r: dict, copies: list[dict]) -> None:
    """Byte-identical copies share everything but their name, folder and sidecar: use the most trustworthy date any of them has."""
    for c in copies:
        if c.get("date") and DATE_RANK.get(c.get("dateSource"), 0) > DATE_RANK.get(r.get("dateSource"), 0):
            r["date"], r["dateSource"] = c["date"], c["dateSource"]


def _hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def same_footage(a: dict, b: dict) -> bool:
    """True when two clips are the same footage (re-saved, re-encoded or rotated): the same length within
    0.4 s, near-identical frames, and joints in the same places sample after sample. Measured on test clips,
    copies stayed within 0.004 of the frame in joint position, while two different sets of the same squat,
    filmed identically, were 0.014 or more apart. Missing a copy only costs a little space; calling two sets
    the same would hide one, so the limits sit well on the safe side."""
    sa, sb = a.get("sig") or [], b.get("sig") or []
    if not sa or not sb or abs((a.get("duration") or 0) - (b.get("duration") or 0)) > 0.4 or abs(len(sa) - len(sb)) > 1:
        return False
    n = min(len(sa), len(sb))
    d = [_hamming(sa[i], sb[i]) / 256 for i in range(n)]
    pa, pb = a.get("psig") or [], b.get("psig") or []
    pd = [sum(abs(x - y) for x, y in zip(pa[i], pb[i], strict=False)) / len(pa[i]) / 1000 for i in range(min(len(pa), len(pb))) if pa[i] and pb[i]]
    if len(pd) >= 3:
        return sum(d) / n <= 0.05 and max(d) <= 0.12 and sum(pd) / len(pd) <= 0.004 and max(pd) <= 0.008
    return sum(d) / n <= 0.02 and max(d) <= 0.05


def same_photo(a: dict, b: dict) -> bool:
    """The same picture saved again (resized, recompressed, shared through a messenger): near-identical
    fingerprints and, when someone is in it, joints in the same places. Two shots of a burst differ more."""
    sa, sb = a.get("sig") or [], b.get("sig") or []
    if len(sa) != 1 or len(sb) != 1 or _hamming(sa[0], sb[0]) / 256 > 0.03:
        return False
    if abs((a.get("width") or 1) / (a.get("height") or 1) - (b.get("width") or 1) / (b.get("height") or 1)) > 0.02:
        return False
    pa, pb = (a.get("psig") or [None])[0], (b.get("psig") or [None])[0]
    if pa and pb:
        return sum(abs(x - y) for x, y in zip(pa, pb, strict=False)) / len(pa) / 1000 <= 0.004
    return not pa and not pb


def mark_near_duplicates(rows: list[dict]) -> None:
    """The best copy keeps its place; other copies of the same footage point to it."""
    for r in rows:
        r.pop("nearDuplicateOf", None)
    buckets: dict[int, list[dict]] = defaultdict(list)
    photos: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r.get("kind") == "photo":
            if r.get("sig"):
                photos[r["sig"][0][:2]].append(r)  # copies share their fingerprint's first bits almost always
        elif r.get("sig") and r.get("duration"):
            buckets[int(r["duration"])].append(r)

    def quality(r: dict) -> tuple:
        rank = DATE_RANK.get(r.get("dateSource", ""), 0)
        return (r.get("status") == "usable", (r.get("width") or 0) * (r.get("height") or 0), rank, r.get("bytes") or 0)

    groups = [(group, buckets.get(b - 1, []) + group + buckets.get(b + 1, []), same_footage) for b, group in buckets.items()]
    groups += [(group, group, same_photo) for group in photos.values()]
    for group, candidates, same in groups:
        for r in group:
            best = None
            for o in candidates:
                if o is r or not same(o, r):
                    continue
                if quality(o) > quality(r) or (quality(o) == quality(r) and o["id"] < r["id"]):
                    if best is None or quality(o) > quality(best):
                        best = o
            if best is not None:
                r["nearDuplicateOf"] = best["id"]
    # point every copy at the final keeper
    by_id = {r["id"]: r for r in rows}
    for r in rows:
        seen = {r["id"]}
        k = r.get("nearDuplicateOf")
        while k and k in by_id and by_id[k].get("nearDuplicateOf") and k not in seen:
            seen.add(k)
            k = by_id[k]["nearDuplicateOf"]
        if k:
            r["nearDuplicateOf"] = k


def _flat(r: dict, meta: dict | None = None) -> dict:
    t = r.get("triage") or {}
    d = {c: r.get(c) for c in CSV_COLUMNS}
    d.update({k: t.get(k) for k in ("people", "bodySize", "view", "movement")})
    d.update({k: (r.get("label") or {}).get(k) for k in LABEL_FIELDS})
    d["kind"] = r.get("kind") or "video"
    d["copies"] = len(r.get("copies") or [])
    if meta:
        d["device"] = meta.get("device")
        loc = meta.get("location") or {}
        d["lat"], d["lon"] = loc.get("lat"), loc.get("lon")
    if r.get("date"):
        d["date"] = datetime.fromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d %H:%M")
    return d


def load_labels(out: Path) -> dict[str, dict]:
    """Your review: keep, purpose, pattern, pose and a note per clip (see `phoenix-archive label`)."""
    p = out / "labels.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def load_meta(out: Path, cid: str) -> dict | None:
    p = out / "clips" / cid / "meta.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except (OSError, ValueError):
        return None


def rebuild(out: Path, settings: dict | None = None) -> list[dict]:
    """index.jsonl, index.csv, report.html and archive.json, from the clip folders."""
    rows = load_clips(out)
    labels = load_labels(out)
    for r in rows:
        r.pop("label", None)
        if labels.get(r["id"]):
            r["label"] = labels[r["id"]]
    state_path = out / "state.sqlite"
    copies: dict[str, list[dict]] = {}
    if state_path.exists():
        st = State(state_path)
        copies = st.copies()
        st.close()
    for r in rows:
        found = copies.get(r["id"]) or [{"rel": r.get("rel"), "date": r.get("date"), "dateSource": r.get("dateSource")}]
        r["copies"] = [c["rel"] for c in found]
        best_date(r, found)
    mark_near_duplicates(rows)
    by_id = {r["id"]: r for r in rows}
    for r in rows:  # a weakly dated keeper takes a Takeout or file-name date from one of its copies
        keeper = by_id.get(r.get("nearDuplicateOf") or "")
        if keeper and DATE_RANK.get(keeper.get("dateSource"), 0) <= 1 and DATE_RANK.get(r.get("dateSource"), 0) in (2, 4):
            keeper["date"], keeper["dateSource"] = r["date"], r["dateSource"]
    rows.sort(key=lambda r: (r.get("date") or 0, r["id"]))
    with open(out / "index.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(light(r), ensure_ascii=False, separators=(",", ":")) + "\n")
    with open(out / "index.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow(_flat(r, load_meta(out, r["id"])))
    meta_path = out / "archive.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except ValueError:
            meta = {}
    meta.update({"format": "phoenix-archive", "formatVersion": 1, "tool": VERSION, "model": MODEL_ID, "modelSha256": MODEL_SHA256,
                 "updated": int(time.time() * 1000), "counts": dict(Counter(r.get("status") for r in rows)),
                 "photos": sum(1 for r in rows if r.get("kind") == "photo")})
    meta.setdefault("created", meta["updated"])
    if settings:
        meta["settings"] = settings
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    write_report(out, rows)
    return rows


def light(r: dict) -> dict:
    """A row without the fingerprints used to find copies (they stay in clip.json)."""
    return {k: v for k, v in r.items() if k not in ("sig", "psig")}


def summary(rows: list[dict]) -> str:
    videos = [r for r in rows if r.get("kind") != "photo"]
    photos = [r for r in rows if r.get("kind") == "photo"]
    c = Counter(r.get("status") for r in videos)
    reasons = Counter(r.get("reason") for r in rows if r.get("status") == "skipped")
    usable = [r for r in rows if r.get("status") == "usable" and not r.get("nearDuplicateOf")]
    hours = sum(r.get("duration") or 0 for r in usable) / 3600
    years = Counter(datetime.fromtimestamp(r["date"] / 1000).year for r in usable if r.get("date"))
    lines = [f"{len(videos)} clips: {c.get('usable', 0)} usable, {c.get('skipped', 0)} skipped"]
    if photos:
        p = Counter(r.get("status") for r in photos)
        lines.append(f"{len(photos)} photos: {p.get('usable', 0)} with someone in them, {p.get('skipped', 0)} skipped")
    n_video = sum(1 for r in usable if r.get("kind") != "photo")
    lines.append(f"{n_video} usable clips after removing near-duplicates ({hours:.1f} h of footage)"
                 + (f", {len(usable) - n_video} photos" if photos else ""))
    labelled = [r for r in rows if r.get("label")]
    if labelled:
        k = Counter((r["label"].get("keep") or "?") for r in labelled)
        lines.append(f"Reviewed: {len(labelled)} ({k.get('yes', 0)} keep, {k.get('no', 0)} not training)")
    if reasons:
        lines.append("Skipped: " + ", ".join(f"{n} {r}" for r, n in reasons.most_common()))
    if years:
        lines.append("Usable by year: " + ", ".join(f"{y}: {n}" for y, n in sorted(years.items())))
    return "\n".join(lines)


# ---------------------------------------------------------------- report

def write_report(out: Path, rows: list[dict]) -> None:
    """A page to browse what was found, by year, with why anything was skipped."""
    esc = html.escape
    by_year: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        y = datetime.fromtimestamp(r["date"] / 1000).strftime("%Y") if r.get("date") else "Unknown date"
        by_year[y].append(r)
    cards = []
    for y in sorted(by_year, reverse=True):
        items = []
        for r in reversed(by_year[y]):
            t = r.get("triage") or {}
            status = "duplicate" if r.get("nearDuplicateOf") else r.get("status", "?")
            when = datetime.fromtimestamp(r["date"] / 1000).strftime("%d %b %Y") if r.get("date") else "?"
            dur = r.get("duration") or 0
            facts = ["photo" if r.get("kind") == "photo" else f"{int(dur // 60)}:{int(dur % 60):02d}", f"{r.get('width')}×{r.get('height')}"]
            if t.get("view"):
                facts.append(f"{t['view']}-on" if t["view"] != "angle" else "at an angle")
            if t.get("people", 0) > 1:
                facts.append(f"{t['people']} people")
            if r.get("slowmo"):
                facts.append("slow motion")
            lab = r.get("label") or {}
            if lab.get("keep") == "no":
                status = "skipped"
            facts += [x for x in (lab.get("pattern"), lab.get("purpose") if lab.get("purpose") != "form" else None) if x]
            note = r.get("reason") or ("copy of another clip" if r.get("nearDuplicateOf") else "")
            img = f'<img loading="lazy" src="clips/{esc(r["id"])}/{esc(r["thumb"])}" alt="">' if r.get("thumb") else '<div class="noimg"></div>'
            href = f' href="clips/{esc(r["id"])}/{esc(r["proxy"])}"' if r.get("proxy") else ""
            body = f'{img}<div class="meta"><b>{esc(when)}</b> · {esc(" · ".join(facts))}<br><span class="name">{esc(r.get("name") or "")}</span>' \
                   f'{f"<br><span class=note>{esc(note)}</span>" if note else ""}</div>'
            items.append(f'<a class="card {esc(status)}"{href}>{body}</a>')
        cards.append(f'<h2>{esc(y)} <small>{len(by_year[y])}</small></h2><div class="grid">{"".join(items)}</div>')
    c = Counter("duplicate" if r.get("nearDuplicateOf") else r.get("status") for r in rows)
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video archive</title><style>
:root{{--bg:#f7f8fa;--card:#fff;--text:#1a1d24;--muted:#6b7280;--line:#e2e5eb;--ok:#16a34a;--skip:#9ca3af;--dup:#d97706;--err:#dc2626}}
@media (prefers-color-scheme:dark){{:root{{--bg:#111318;--card:#1b1e25;--text:#e8eaef;--muted:#9aa1ad;--line:#2a2f38}}}}
body{{margin:0;padding:16px;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--text)}}
h1{{font-size:20px;margin:0 0 4px}} h2{{font-size:16px;margin:24px 0 8px}} small{{color:var(--muted);font-weight:400}}
.filters label{{margin-right:14px;color:var(--muted)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}}
.card{{display:block;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--skip);border-radius:8px;overflow:hidden;color:inherit;text-decoration:none}}
.card.usable{{border-left-color:var(--ok)}} .card.duplicate{{border-left-color:var(--dup)}}
.card img,.noimg{{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:var(--line)}}
.meta{{padding:6px 8px;font-size:12px}} .name{{color:var(--muted);word-break:break-all}} .note{{color:var(--dup)}}
.hide-skipped .skipped,.hide-duplicate .duplicate{{display:none}}
</style></head><body>
<h1>Video archive</h1><p><small>{c.get('usable', 0)} usable · {c.get('duplicate', 0)} copies · {c.get('skipped', 0)} skipped. Tap a usable clip to play its small copy (or a photo to open it).</small></p>
<p class="filters"><label><input type="checkbox" id="sk"> Show skipped</label><label><input type="checkbox" id="du"> Show copies</label></p>
{''.join(cards)}
<script>
const b=document.body;b.classList.add('hide-skipped','hide-duplicate');
sk.onchange=()=>b.classList.toggle('hide-skipped',!sk.checked);du.onchange=()=>b.classList.toggle('hide-duplicate',!du.checked);
</script></body></html>"""
    (out / "report.html").write_text(page, encoding="utf-8")


# ---------------------------------------------------------------- packing

def parse_day(s: str | None, end: bool = False) -> int | None:
    if not s:
        return None
    fmt = {4: "%Y", 7: "%Y-%m", 10: "%Y-%m-%d"}.get(len(s))
    if not fmt:
        raise SystemExit(f"Dates look like 2019, 2019-03 or 2019-03-12 (got {s})")
    try:
        d = datetime.strptime(s, fmt)
    except ValueError:
        raise SystemExit(f"Dates look like 2019, 2019-03 or 2019-03-12 (got {s})") from None
    if end:
        if len(s) == 4:
            d = d.replace(year=d.year + 1)
        elif len(s) == 7:
            d = d.replace(year=d.year + (d.month == 12), month=d.month % 12 + 1)
        else:
            d = datetime.fromtimestamp(d.timestamp() + 86400)
    return int(d.timestamp() * 1000)


def pack(out: Path, dest: Path, since: str | None, until: str | None, tracks_only: bool, include_copies: bool, max_gb: float,
         kinds: str = "all", reviewed_only: bool = False) -> list[Path]:
    """Zip files for the app: the index plus each usable clip's track, thumbnail and (unless tracks only) small copy.
    Clips you marked keep=no are left out; metadata (meta.json, sidecars) never goes in."""
    rows = [r for r in rebuild(out) if r.get("status") == "usable" and (include_copies or not r.get("nearDuplicateOf"))
            and (r.get("label") or {}).get("keep") != "no" and (not reviewed_only or (r.get("label") or {}).get("keep") == "yes")
            and (kinds == "all" or (r.get("kind") or "video") == kinds.rstrip("s"))]
    lo, hi = parse_day(since), parse_day(until, end=True)
    rows = [r for r in rows if (lo is None or (r.get("date") or 0) >= lo) and (hi is None or (r.get("date") or 0) < hi)]
    if not rows:
        raise SystemExit("Nothing to pack (no usable clips match).")
    dest.mkdir(parents=True, exist_ok=True)
    limit = int(max_gb * (1 << 30))
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    kind = "tracks" if tracks_only else "clips"
    meta = json.loads((out / "archive.json").read_text(encoding="utf-8"))
    paths: list[Path] = []
    zf: zipfile.ZipFile | None = None
    size = 0
    batch: list[dict] = []

    def close() -> None:
        nonlocal zf
        if zf:
            zf.writestr("index.jsonl", "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in batch), zipfile.ZIP_DEFLATED)
            zf.writestr("archive.json", json.dumps({**meta, "pack": {"kind": kind, "part": len(paths), "clips": len(batch)}}, indent=2), zipfile.ZIP_DEFLATED)
            zf.close()
            zf = None

    for r in rows:
        files = [n for n in ("clip.json", r.get("track"), r.get("thumb"), None if tracks_only else r.get("proxy")) if n]
        need = sum((out / "clips" / r["id"] / n).stat().st_size for n in files if (out / "clips" / r["id"] / n).exists())
        if zf is None or (size + need > limit and batch):
            close()
            batch = []
            p = dest / f"phoenix-archive-{kind}-{stamp}-{len(paths) + 1:02d}.zip"
            paths.append(p)
            zf = zipfile.ZipFile(p, "w", allowZip64=True)
            size = 0
        entry = light(r)
        if tracks_only:
            entry.pop("proxy", None)
        batch.append(entry)
        for n in files:
            f = out / "clips" / r["id"] / n
            if f.exists():
                comp = zipfile.ZIP_DEFLATED if n.endswith(".json") else zipfile.ZIP_STORED
                zf.write(f, f"clips/{r['id']}/{n}", compress_type=comp)
        size += need
    close()
    return paths


def merge(sources: list[Path], out: Path) -> None:
    """Combines archives made on different machines (for example with --shard) into one."""
    (out / "clips").mkdir(parents=True, exist_ok=True)
    st = State(out / "state.sqlite")
    for s in sources:
        if not (s / "clips").is_dir():
            raise SystemExit(f"{s} isn't an archive folder")
        for d in (s / "clips").iterdir():
            if (d / "clip.json").exists() and not (out / "clips" / d.name / "clip.json").exists():
                shutil.copytree(d, out / "clips" / d.name, dirs_exist_ok=True)
        if (s / "state.sqlite").exists():
            st.merge_from(s / "state.sqlite")
    st.close()
    rows = rebuild(out)
    print(summary(rows))


def clean_claims(out: Path) -> None:
    for p in (out / "clips").glob("*/.claim"):
        try:
            os.remove(p)
        except OSError:
            pass
