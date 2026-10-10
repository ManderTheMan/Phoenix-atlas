"""phoenix-archive: find the training videos in years of footage and track the joints in them.

  phoenix-archive run  D:\\Videos D:\\Takeout --out D:\\phoenix-archive [--photos --keep-metadata]
  phoenix-archive status --out D:\\phoenix-archive
  phoenix-archive sheets --out D:\\phoenix-archive        (numbered contact sheets to look through)
  phoenix-archive label --out D:\\phoenix-archive labels.csv
  phoenix-archive collect --out D:\\phoenix-archive --dest E:\\Lifting   (copies of the originals)
  phoenix-archive pack --out D:\\phoenix-archive --dest D:\\packs
"""
from __future__ import annotations

import argparse
import multiprocessing
import os
import shutil
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from datetime import datetime
from pathlib import Path

from . import VERSION
from .dates import resolve
from .collect import collect
from .index import clean_claims, merge, pack, parse_day, rebuild, summary
from .media import require_ffmpeg
from .photos import PHOTO_EDGE
from .pose import ensure_model
from .process import MIN_SIZE, Options, init_worker, process
from .review import import_labels, sheets
from .sources import in_shard, scan
from .state import RunLock, State


def _shard(s: str | None) -> tuple[int, int] | None:
    if not s:
        return None
    try:
        i, n = (int(x) for x in s.split("/"))
    except ValueError:
        raise SystemExit("--shard looks like 1/2 (this machine does the first of two halves)") from None
    if not 1 <= i <= n:
        raise SystemExit("--shard i/n needs 1 ≤ i ≤ n")
    return i, n


def _fmt_secs(s: float) -> str:
    s = int(s)
    return f"{s // 3600}h{s % 3600 // 60:02d}m" if s >= 3600 else f"{s // 60}m{s % 60:02d}s"


def _gb(n: int) -> str:
    if n >= 1 << 30:
        return f"{n / (1 << 30):.1f} GB"
    return f"{n / (1 << 20):.0f} MB" if n >= 1 << 20 else f"{max(1, n >> 10)} KB"


def cmd_run(a: argparse.Namespace) -> None:
    require_ffmpeg()
    out = Path(a.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    (out / "clips").mkdir(exist_ok=True)
    lock = None if a.dry_run else RunLock(out)
    state = State(out / "state.sqlite")
    try:
        print(f"phoenix-archive {VERSION}: looking for videos{' and photos' if a.photos else ''} …", flush=True)
        sources = scan(a.inputs, photos=a.photos)
        zipped = sum(1 for s in sources if s.in_zip)
        dated = sum(1 for s in sources if s.sidecar)
        total = sum(s.size for s in sources)
        n_photos = sum(1 for s in sources if s.kind == "photo")
        what = f"{len(sources) - n_photos} videos" + (f" and {n_photos} photos" if a.photos else "")
        print(f"Found {what} ({_gb(total)}): {len(sources) - zipped} files, {zipped} inside zips, {dated} with Takeout dates.")
        shard = _shard(a.shard)
        todo = [s for s in sources if in_shard(s, shard)]
        if shard:
            print(f"Shard {shard[0]}/{shard[1]}: {len(todo)} of them.")
        if not a.redo:
            before = len(todo)
            todo = [s for s in todo if not state.is_done(s)]
            if before - len(todo):
                print(f"{before - len(todo)} already done in {out}.")

        def quick_date(s) -> int:
            return resolve(s.sidecar, {}, s.name, s.mtime)[0] or 0

        if a.since or a.until:
            lo, hi = parse_day(a.since), parse_day(a.until, end=True)
            todo = [s for s in todo if (lo is None or quick_date(s) >= lo) and (hi is None or quick_date(s) < hi)]
        todo.sort(key=quick_date, reverse=a.order == "newest")
        if a.order == "path":
            todo.sort(key=lambda s: s.rel)
        if a.limit:
            todo = todo[: a.limit]
        todo_bytes = sum(s.size for s in todo)
        video_bytes = sum(s.size for s in todo if s.kind == "video")
        todo_photos = sum(1 for s in todo if s.kind == "photo")
        print(f"To do: {len(todo) - todo_photos} videos{f' and {todo_photos} photos' if a.photos else ''} ({_gb(todo_bytes)}), "
              f"roughly {video_bytes / (15 << 20) / 60:.1f} h of footage judging by size.")
        if a.dry_run or not todo:
            if not todo and not a.dry_run:
                rows = rebuild(out)
                print(summary(rows))
            return
        model = ensure_model(a.model)
        clean_claims(out)
        tmp = Path(a.tmp).expanduser() if a.tmp else out / "tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        opts = Options(out=str(out), model=model, tmp=str(tmp), fps=a.fps, proxy_short=a.proxy, proxy_format=a.proxy_format, min_size=a.min_size,
                       keep_metadata=a.keep_metadata, photo_edge=a.photo_size)
        if a.keep_metadata:
            print("Keeping each file's full metadata (camera, settings, location) in clips/<id>/meta.json — for you only; packs leave it out.")
        workers = a.workers or max(1, (os.cpu_count() or 2) // 2)
        print(f"Working with {workers} worker{'s' if workers > 1 else ''}. Press Ctrl+C to stop; run the same command again to carry on.\n", flush=True)
        _run_pool(todo, opts, workers, state, todo_bytes)
    finally:
        try:
            if not a.dry_run:
                rows = rebuild(out, settings={"fps": a.fps, "proxy": a.proxy, "minSize": a.min_size, "photos": a.photos, "keepMetadata": a.keep_metadata})
                print("\n" + summary(rows))
                print(f"\nIndex: {out / 'index.csv'}\nReport: {out / 'report.html'}")
                errors = state.errors()
                if errors:
                    print(f"{len(errors)} files couldn't be read (see `phoenix-archive status --errors`).")
        finally:
            state.close()
            if lock:
                lock.release()


def _run_pool(todo, opts: Options, workers: int, state: State, todo_bytes: int) -> None:
    by_key = {s.key: s for s in todo}
    started = time.time()
    done_bytes = 0
    n = 0
    stopping = False
    # "spawn" everywhere: the same behaviour on Windows, macOS and Linux, and safe alongside the lock's heartbeat thread
    ex = ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context("spawn"), initializer=init_worker, initargs=(opts,))
    pending = set()
    queue = list(todo)
    try:
        while queue or pending:
            while queue and len(pending) < workers * 2 and not stopping:
                pending.add(ex.submit(process, queue.pop(0)))
            if not pending:
                break
            finished, pending = wait(pending, timeout=1.0, return_when=FIRST_COMPLETED)
            for fut in finished:
                r = fut.result()
                src = by_key[r["source"]]
                state.record(src, r.get("clip"), r["status"], r.get("error"), r.get("date"), r.get("dateSource"))
                n += 1
                done_bytes += src.size
                elapsed = time.time() - started
                eta = (todo_bytes - done_bytes) / (done_bytes / elapsed) if done_bytes and not stopping else 0
                if r["status"] == "error":
                    what = f"couldn't read: {r.get('error')}"
                elif r["status"] == "duplicate":
                    what = "copy of a clip already done"
                elif r.get("decision") == "usable":
                    bits = [b for b in ((f"{r['view']}-on" if r.get("view") not in (None, "angle") else "at an angle" if r.get("view") else None),
                                        f"{r['people']} people" if (r.get("people") or 0) > 1 else None) if b]
                    what = "usable" + (f" ({', '.join(bits)})" if bits else "")
                else:
                    what = f"skipped: {r.get('reason')}"
                when = datetime.fromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d") if r.get("date") else "    ?     "
                dur = r.get("duration") or 0
                length = "photo " if src.kind == "photo" else f"{int(dur // 60):>3}:{int(dur % 60):02d}"
                print(f"[{n:>{len(str(len(todo)))}}/{len(todo)}] {when} {length}  {src.name[:48]:<48} {what}"
                      f"{f'  ETA {_fmt_secs(eta)}' if eta else ''}", flush=True)
    except KeyboardInterrupt:
        if not stopping:
            print("\nStopping after the clips in progress … (Ctrl+C again to stop now)", flush=True)
            stopping = True
            queue.clear()
            try:
                for fut in list(pending):
                    r = fut.result()
                    state.record(by_key[r["source"]], r.get("clip"), r["status"], r.get("error"), r.get("date"), r.get("dateSource"))
            except KeyboardInterrupt:
                print("Stopping now; unfinished clips will be done next time.", flush=True)
                for p in getattr(ex, "_processes", {}).values():
                    p.terminate()
    finally:
        ex.shutdown(wait=not stopping, cancel_futures=True)


def cmd_status(a: argparse.Namespace) -> None:
    out = Path(a.out).expanduser()
    rows = rebuild(out)
    print(summary(rows))
    st = State(out / "state.sqlite")
    errors = st.errors()
    st.close()
    if errors:
        print(f"{len(errors)} files couldn't be read.")
        if a.errors:
            for rel, err in errors:
                print(f"  {rel}: {err}")


def cmd_pack(a: argparse.Namespace) -> None:
    out = Path(a.out).expanduser()
    dest = Path(a.dest).expanduser() if a.dest else out / "packs"
    paths = pack(out, dest, a.since, a.until, a.tracks_only, a.include_copies, a.max_gb, a.kind, a.reviewed_only)
    for p in paths:
        print(f"{p}  ({_gb(p.stat().st_size)})")
    print("Import these in Phoenix Atlas: Media → Archive → Choose pack files.")


def cmd_sheets(a: argparse.Namespace) -> None:
    out = Path(a.out).expanduser()
    paths, listing = sheets(out, Path(a.dest).expanduser() if a.dest else None, a.which, a.cols, a.rows, a.size, a.include_copies, a.unreviewed, a.kind)
    if not paths:
        print("Nothing to show.")
        return
    print(f"{len(paths)} sheets in {paths[0].parent} ({sum(1 for _ in open(listing, encoding='utf-8')) - 1} clips).")
    print(f"What each number is: {listing}\nFill in its keep/purpose/pattern/pose/note columns, then: phoenix-archive label --out {out} {listing}")


def cmd_label(a: argparse.Namespace) -> None:
    out = Path(a.out).expanduser()
    changed, problems = import_labels(out, Path(a.csv).expanduser())
    for p in problems[:50]:
        print(f"  {p}")
    if len(problems) > 50:
        print(f"  … and {len(problems) - 50} more")
    print(f"Labels updated for {changed} clips ({out / 'labels.json'}).")
    print(summary(rebuild(out)))


def cmd_collect(a: argparse.Namespace) -> None:
    out = Path(a.out).expanduser()
    r = collect(out, Path(a.dest).expanduser(), a.which, a.since, a.until, a.include_copies, a.reviewed_only, a.kind, a.dry_run)
    if a.dry_run:
        print(f"Would copy {r['chosen']} originals ({_gb(r['bytes'])}) to {r['dest']}.")
        return
    print(f"Copied {r['copied']} originals to {r['dest']} ({r['already']} were already there).")
    if r["missing"]:
        print(f"{len(r['missing'])} couldn't be found where the run saw them (moved or changed since):")
        for m in r["missing"][:20]:
            print(f"  {m}")
    print(f"List: {Path(r['dest']) / 'collected.csv'}")


def cmd_merge(a: argparse.Namespace) -> None:
    merge([Path(p).expanduser() for p in a.archives], Path(a.out).expanduser())


def cmd_model(a: argparse.Namespace) -> None:
    print(ensure_model(a.model))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="phoenix-archive", description="Find the training videos in years of footage and track the joints in them, on this computer.")
    p.add_argument("--version", action="version", version=VERSION)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="find, sort and track videos in folders and zips")
    r.add_argument("inputs", nargs="+", help="folders, zip files (Google Takeout too) or video files")
    r.add_argument("--out", required=True, help="folder for the results (keep one per machine)")
    r.add_argument("--workers", type=int, help="clips at once (default: half the CPU cores)")
    r.add_argument("--shard", help="split the work between machines: 1/2 on one, 2/2 on the other, then merge")
    r.add_argument("--since", help="only clips from this date on (2019, 2019-03 or 2019-03-12)")
    r.add_argument("--until", help="only clips up to this date")
    r.add_argument("--order", choices=["newest", "oldest", "path"], default="newest", help="which clips first (default newest)")
    r.add_argument("--limit", type=int, help="stop after this many videos (to try it out)")
    r.add_argument("--fps", type=float, help="frames tracked per second (default 15, or 10 for clips over 45 s, like the app)")
    r.add_argument("--proxy", type=int, default=480, help="height of the small copy's shorter side; 0 for none (default 480)")
    r.add_argument("--proxy-format", choices=["mp4", "webm"], default="mp4",
                   help="mp4 (H.264, plays everywhere; default) or webm (VP9, for open-source browsers such as Chromium on Linux)")
    r.add_argument("--min-size", type=float, default=MIN_SIZE, help=f"skip people smaller than this share of the frame height (default {MIN_SIZE})")
    r.add_argument("--model", help="path to pose_landmarker_full.task (downloaded automatically otherwise)")
    r.add_argument("--tmp", help="where to unpack videos from zips (default: inside --out)")
    r.add_argument("--photos", action="store_true", help="also look at photos (JPEG, PNG, WebP; HEIC with pillow-heif)")
    r.add_argument("--keep-metadata", action="store_true",
                   help="save each file's full metadata (camera, settings, location, Takeout sidecar) beside its results, for your own use")
    r.add_argument("--photo-size", type=int, default=PHOTO_EDGE, help=f"long side of a photo's small copy (default {PHOTO_EDGE})")
    r.add_argument("--redo", action="store_true", help="process everything again")
    r.add_argument("--dry-run", action="store_true", help="only count what would be done")
    r.set_defaults(func=cmd_run)

    s = sub.add_parser("status", help="what's been found so far")
    s.add_argument("--out", required=True)
    s.add_argument("--errors", action="store_true", help="list files that couldn't be read")
    s.set_defaults(func=cmd_status)

    k = sub.add_parser("pack", help="zip usable clips for the app (or tracks only, to share)")
    k.add_argument("--out", required=True, help="the archive folder")
    k.add_argument("--dest", help="where to write the zips (default: <out>/packs)")
    k.add_argument("--since")
    k.add_argument("--until")
    k.add_argument("--tracks-only", action="store_true", help="leave out the small copies: joint tracks and thumbnails only")
    k.add_argument("--include-copies", action="store_true", help="include near-duplicate copies")
    k.add_argument("--max-gb", type=float, default=2.0, help="largest zip before starting another (default 2)")
    k.add_argument("--kind", choices=["all", "videos", "photos"], default="all")
    k.add_argument("--reviewed-only", action="store_true", help="only clips you labelled keep=yes")
    k.set_defaults(func=cmd_pack)

    h = sub.add_parser("sheets", help="numbered contact sheets to look through, with a CSV to label them in")
    h.add_argument("--out", required=True, help="the archive folder")
    h.add_argument("--dest", help="where to write them (default: <out>/sheets)")
    h.add_argument("--which", choices=["usable", "skipped", "all"], default="usable")
    h.add_argument("--kind", choices=["all", "videos", "photos"], default="all")
    h.add_argument("--unreviewed", action="store_true", help="only clips without labels yet")
    h.add_argument("--include-copies", action="store_true")
    h.add_argument("--cols", type=int, default=3, help="tiles across (default 3)")
    h.add_argument("--rows", type=int, default=6, help="tiles down (default 6)")
    h.add_argument("--size", type=int, default=180, help="frame size in pixels (default 180)")
    h.set_defaults(func=cmd_sheets)

    lb = sub.add_parser("label", help="read your labels (keep, purpose, pattern, pose, note) from a CSV")
    lb.add_argument("csv", help="a CSV with an id or number column (sheets.csv works)")
    lb.add_argument("--out", required=True, help="the archive folder")
    lb.set_defaults(func=cmd_label)

    c = sub.add_parser("collect", help="copy the originals (untouched, with their metadata) into one folder by year")
    c.add_argument("--out", required=True, help="the archive folder")
    c.add_argument("--dest", required=True, help="where the copies go (outside the archive folder)")
    c.add_argument("--which", choices=["usable", "skipped", "all"], default="usable")
    c.add_argument("--kind", choices=["all", "videos", "photos"], default="all")
    c.add_argument("--since")
    c.add_argument("--until")
    c.add_argument("--include-copies", action="store_true", help="also near-duplicate copies")
    c.add_argument("--reviewed-only", action="store_true", help="only clips you labelled keep=yes")
    c.add_argument("--dry-run", action="store_true", help="only say how many and how big")
    c.set_defaults(func=cmd_collect)

    m = sub.add_parser("merge", help="combine archives from several machines")
    m.add_argument("archives", nargs="+")
    m.add_argument("--out", required=True)
    m.set_defaults(func=cmd_merge)

    d = sub.add_parser("model", help="download and check the pose model")
    d.add_argument("--model")
    d.set_defaults(func=cmd_model)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main(sys.argv[1:])
