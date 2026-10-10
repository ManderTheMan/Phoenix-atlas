"""Photos, full metadata, contact sheets, labels and collecting originals, end to end (needs ffmpeg, MediaPipe and the pose model)."""
import csv
import gzip
import hashlib
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "squat.mp4"

pytest.importorskip("mediapipe")
PIL = pytest.importorskip("PIL")
if not shutil.which("ffmpeg"):
    pytest.skip("ffmpeg isn't installed", allow_module_level=True)

from PIL import Image  # noqa: E402

from phoenix_archive.cli import main  # noqa: E402
from phoenix_archive.pose import ensure_model  # noqa: E402


@pytest.fixture(scope="module")
def model():
    try:
        return ensure_model(log=lambda m: None)
    except SystemExit as e:
        pytest.skip(f"pose model unavailable: {e}")


def _exif(taken: str | None = None, zone: str | None = None, gps: tuple | None = None, orientation: int | None = None):
    exif = Image.Exif()
    exif[0x010F], exif[0x0110] = "Testcam", "Model 7"
    if orientation:
        exif[0x0112] = orientation
    sub = exif.get_ifd(0x8769)
    if taken:
        sub[36867] = taken
    if zone:
        sub[36881] = zone
    if gps:
        g = exif.get_ifd(0x8825)
        g[1], g[2], g[3], g[4] = gps
    return exif


@pytest.fixture(scope="module")
def inputs(tmp_path_factory):
    d = tmp_path_factory.mktemp("in")
    work = tmp_path_factory.mktemp("work")
    def frame_at(t: float):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", str(FIXTURE), "-frames:v", "1", str(work / f"f{t}.png")], check=True)
        small = Image.open(work / f"f{t}.png").convert("RGB")
        return small.resize((small.width * 4, small.height * 4), Image.Resampling.LANCZOS)  # phone-photo sized (the render is tiny)

    # different moments of the squat, so each is its own photo
    frame, frame2, frame3, frame4 = frame_at(0.4), frame_at(1.4), frame_at(2.4), frame_at(3.4)
    (d / "camera").mkdir()
    # a lifting photo with a date, a time zone and a location
    frame.save(d / "camera" / "DSC_0042.jpg", quality=92, exif=_exif("2017:06:05 07:08:09", "+02:00", ("N", (51.0, 30.0, 0.0), "W", (0.0, 7.0, 30.0))))
    # the same picture saved again smaller (as a messenger does): a near-duplicate
    frame.resize((frame.width * 3 // 4, frame.height * 3 // 4)).save(d / "camera" / "IMG-20170605-WA0001.jpg", quality=70)
    # stored sideways with an orientation flag: it should come out upright
    frame2.transpose(Image.Transpose.ROTATE_90).save(d / "camera" / "rotated.jpg", quality=90, exif=_exif("2018:01:02 03:04:05", orientation=6))
    # nobody in it
    import numpy as np

    noise = np.random.default_rng(1).integers(0, 255, (600, 800, 3), dtype=np.uint8)
    Image.fromarray(noise // 4 + np.array([60, 110, 170], dtype=np.uint8)).save(d / "camera" / "sky.jpg", quality=90, exif=_exif("2019:02:03 04:05:06"))
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
        frame3.save(d / "camera" / "IMG_1234.HEIC", quality=80, exif=_exif("2020:07:08 09:10:11"))
    except ImportError:
        pass
    # a Takeout zip: a photo whose sidecar knows when it was taken, plus the squat video
    buf = work / "p.jpg"
    frame4.save(buf, quality=88)
    with zipfile.ZipFile(d / "takeout-002.zip", "w") as zf:
        zf.write(buf, "Takeout/Google Photos/Gym/PXL_20210304_050607.jpg")
        zf.writestr("Takeout/Google Photos/Gym/PXL_20210304_050607.jpg.supplemental-metadata.json",
                    json.dumps({"title": "PXL_20210304_050607.jpg", "description": "Deadlift PR", "photoTakenTime": {"timestamp": "1614834367"},
                                "geoData": {"latitude": 40.1, "longitude": -3.2}}))
        zf.write(FIXTURE, "Takeout/Google Photos/Gym/VID_20210304_050700.mp4")
    return d


@pytest.fixture(scope="module")
def archive(inputs, model, tmp_path_factory):
    out = tmp_path_factory.mktemp("out")
    main(["run", str(inputs), "--out", str(out), "--model", model, "--workers", "2", "--photos", "--keep-metadata"])
    return out


def _rows(out):
    return {r["name"]: r for r in (json.loads(line) for line in (out / "index.jsonl").read_text().splitlines())}


def test_photos_are_sorted_and_dated(archive):
    rows = _rows(archive)
    lift = rows["DSC_0042.jpg"]
    assert lift["kind"] == "photo" and lift["status"] == "usable" and lift["dateSource"] == "metadata"
    assert lift["triage"]["people"] == 1 and lift["triage"]["bodySize"] > 0.3
    from datetime import datetime, timezone

    assert datetime.fromtimestamp(lift["date"] / 1000, tz=timezone.utc).isoformat() == "2017-06-05T05:08:09+00:00"  # 07:08:09 at +02:00
    assert rows["sky.jpg"]["status"] == "skipped" and rows["sky.jpg"]["reason"] == "no person"
    assert rows["IMG-20170605-WA0001.jpg"]["nearDuplicateOf"] == lift["id"]
    rot = rows["rotated.jpg"]
    assert rot["height"] > rot["width"] and rot["status"] == "usable"  # turned upright
    takeout = rows["PXL_20210304_050607.jpg"]
    assert takeout["dateSource"] == "takeout" and takeout["description"] == "Deadlift PR"
    if "IMG_1234.HEIC" in rows:
        assert rows["IMG_1234.HEIC"]["status"] == "usable" and rows["IMG_1234.HEIC"]["format"] == "heic"
    assert rows["VID_20210304_050700.mp4"].get("kind", "video") == "video" and rows["VID_20210304_050700.mp4"]["status"] == "usable"


def test_photo_outputs_and_metadata(archive):
    lift = _rows(archive)["DSC_0042.jpg"]
    d = archive / "clips" / lift["id"]
    track = json.loads(gzip.open(d / "track.json.gz").read())
    assert track["fps"] == 1 and len(track["frames"]) == 1 and len(track["frames"][0]["lm"]) == 99
    small = Image.open(d / "photo.jpg")
    assert not small.getexif() and max(small.size) <= 1600  # the small copy carries no metadata
    meta = json.loads((d / "meta.json").read_text())
    assert meta["device"] == "Testcam Model 7"
    assert meta["location"] == {"lat": 51.5, "lon": -0.125}
    assert meta["exif"]["DateTimeOriginal"] == "2017:06:05 07:08:09"
    takeout = _rows(archive)["PXL_20210304_050607.jpg"]
    (side,) = (archive / "clips" / takeout["id"]).glob("sidecar-*.json")
    assert json.loads(side.read_text())["sidecar"]["geoData"]["latitude"] == 40.1
    video = _rows(archive)["VID_20210304_050700.mp4"]
    assert "ffprobe" in json.loads((archive / "clips" / video["id"] / "meta.json").read_text())
    with open(archive / "index.csv", newline="") as f:
        by_name = {r["name"]: r for r in csv.DictReader(f)}
    assert by_name["DSC_0042.jpg"]["kind"] == "photo" and by_name["DSC_0042.jpg"]["lat"] == "51.5"


def test_sheets_labels_collect_and_pack(archive, tmp_path):
    main(["sheets", "--out", str(archive)])
    sheets = sorted((archive / "sheets").glob("sheet-*.jpg"))
    assert sheets and Image.open(sheets[0]).width > 500
    with open(archive / "sheets" / "sheets.csv", newline="") as f:
        listing = list(csv.DictReader(f))
    by_name = {r["name"]: r for r in listing}
    assert "sky.jpg" not in by_name and "IMG-20170605-WA0001.jpg" not in by_name  # skipped and copies left out
    # label by number, the way a reviewer fills in the sheet
    labels = tmp_path / "labels.csv"
    with open(labels, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["number", "keep", "pattern", "pose", "note"])
        w.writerow([by_name["DSC_0042.jpg"]["number"], "yes", "Back squat", "side", "belt on"])
        w.writerow([by_name["rotated.jpg"]["number"], "no", "", "", ""])
        w.writerow([by_name["PXL_20210304_050607.jpg"]["number"], "y", "deadlift", "", ""])
        w.writerow(["999", "yes", "", "", ""])
        w.writerow([by_name["VID_20210304_050700.mp4"]["number"], "yes", "skydiving", "", ""])
    main(["label", "--out", str(archive), str(labels)])
    # a skipped one you want after all
    main(["sheets", "--out", str(archive), "--which", "skipped"])
    with open(archive / "sheets" / "sheets.csv", newline="") as f:
        (sky,) = [r for r in csv.DictReader(f) if r["name"] == "sky.jpg"]
    with open(tmp_path / "skipped.csv", "w", newline="") as f:
        csv.writer(f).writerows([["number", "keep", "purpose", "note"], [sky["number"], "yes", "other", "gym ceiling"]])
    main(["label", "--out", str(archive), str(tmp_path / "skipped.csv")])
    saved = json.loads((archive / "labels.json").read_text())
    lift = _rows(archive)["DSC_0042.jpg"]
    assert saved[lift["id"]] == {"keep": "yes", "pattern": "squat", "variant": "Back squat", "pose": "side", "note": "belt on"}
    assert _rows(archive)["PXL_20210304_050607.jpg"]["label"]["pattern"] == "hinge"
    assert "pattern" not in _rows(archive)["VID_20210304_050700.mp4"]["label"]  # unknown names are reported, not guessed

    dest = tmp_path / "Lifting"
    main(["collect", "--out", str(archive), "--dest", str(dest)])
    files = {p.name: p for p in dest.rglob("*") if p.is_file()}
    original = next(p for n, p in files.items() if n.endswith("DSC_0042.jpg"))
    assert original.parent.name == "2017" and original.name.startswith("2017-06-05_")
    assert hashlib.sha256(original.read_bytes()).hexdigest()[:16] == lift["id"]  # byte for byte, metadata included
    assert Image.open(original).getexif()[0x010F] == "Testcam"
    about = json.loads((original.parent / (original.name + ".phoenix.json")).read_text())
    assert about["label"]["pattern"] == "squat" and about["metadata"]["location"]["lat"] == 51.5
    assert not any("rotated" in n for n in files)  # keep=no stays behind
    assert any(n.endswith("sky.jpg") for n in files)  # skipped by the tool, but you said keep
    zipped = next(n for n in files if n.endswith("PXL_20210304_050607.jpg"))
    assert json.loads((files[zipped].parent / (zipped + ".phoenix.json")).read_text())["takeout"][0]["sidecar"]["description"] == "Deadlift PR"
    assert (dest / "collected.csv").exists()
    # running it again copies nothing
    before = {p: p.stat().st_mtime_ns for p in files.values()}
    main(["collect", "--out", str(archive), "--dest", str(dest)])
    assert all(p.stat().st_mtime_ns == t for p, t in before.items() if not p.name.endswith((".json", ".csv")))

    packs = tmp_path / "packs"
    main(["pack", "--out", str(archive), "--dest", str(packs)])
    (z,) = packs.glob("*.zip")
    with zipfile.ZipFile(z) as zf:
        names = zf.namelist()
        index = {r["name"]: r for r in (json.loads(x) for x in zf.read("index.jsonl").decode().splitlines())}
    assert "rotated.jpg" not in index and index["DSC_0042.jpg"]["label"]["pattern"] == "squat"
    assert f"clips/{lift['id']}/photo.jpg" in names
    assert not any(n.endswith("meta.json") or "/sidecar-" in n for n in names)  # metadata stays home
