"""End to end on real video: needs ffmpeg, MediaPipe and the pose model (downloaded once)."""
import gzip
import json
import math
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "squat.mp4"  # a render of the app's 3D body squatting; true bottom knee angle 45.9°

pytest.importorskip("mediapipe")
if not shutil.which("ffmpeg"):
    pytest.skip("ffmpeg isn't installed", allow_module_level=True)

from phoenix_archive.cli import main  # noqa: E402
from phoenix_archive.pose import LM, ensure_model  # noqa: E402


@pytest.fixture(scope="module")
def model():
    try:
        return ensure_model(log=lambda m: None)
    except SystemExit as e:
        pytest.skip(f"pose model unavailable: {e}")


def _ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="module")
def inputs(tmp_path_factory):
    d = tmp_path_factory.mktemp("in")
    (d / "phone").mkdir()
    shutil.copy(FIXTURE, d / "phone" / "VID_20190312_101500.mp4")
    # the same clip turned sideways in the file, displayed upright by a rotation flag
    _ffmpeg("-i", str(FIXTURE), "-vf", "transpose=1", "-c:v", "libx264", "-crf", "23", str(d / "rot.mp4"))
    _ffmpeg("-display_rotation", "90", "-i", str(d / "rot.mp4"), "-c", "copy", str(d / "phone" / "20200105_093000.mp4"))
    (d / "rot.mp4").unlink()
    _ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "3", "-c:v", "libx264", str(d / "phone" / "IMG_4521.MOV"))
    with zipfile.ZipFile(d / "takeout-001.zip", "w") as zf:
        zf.write(FIXTURE, "Takeout/Google Photos/Photos from 2018/PXL_20181120_183000123.mp4")
        zf.writestr("Takeout/Google Photos/Photos from 2018/PXL_20181120_183000123.mp4.json",
                    json.dumps({"title": "PXL_20181120_183000123.mp4", "photoTakenTime": {"timestamp": "1542738600"}}))
    return d


@pytest.fixture(scope="module")
def archive(inputs, model, tmp_path_factory):
    out = tmp_path_factory.mktemp("out")
    main(["run", str(inputs), "--out", str(out), "--model", model, "--workers", "2"])
    return out


def _rows(out):
    return {r["name"]: r for r in (json.loads(line) for line in (out / "index.jsonl").read_text().splitlines())}


def test_sorting_dates_and_copies(archive):
    rows = _rows(archive)
    # the zip copy is byte-identical to the phone copy: done once, with the Takeout date
    assert len(rows) == 3
    kept = rows.get("VID_20190312_101500.mp4") or rows.get("PXL_20181120_183000123.mp4")
    assert kept["status"] == "usable" and kept["dateSource"] == "takeout" and len(kept["copies"]) == 2
    assert rows["IMG_4521.MOV"]["status"] == "skipped" and rows["IMG_4521.MOV"]["reason"] == "no person"
    rotated = rows["20200105_093000.mp4"]
    assert (rotated["width"], rotated["height"]) == (270, 480) and rotated["rotation"]
    assert rotated["status"] == "usable" and rotated["nearDuplicateOf"] == kept["id"]
    assert (archive / "report.html").exists() and (archive / "index.csv").exists()


def test_track_is_in_the_app_format_and_accurate(archive):
    kept = next(r for r in _rows(archive).values() if r["status"] == "usable" and not r.get("nearDuplicateOf"))
    track = json.loads(gzip.open(archive / "clips" / kept["id"] / "track.json.gz").read())
    assert set(track) >= {"id", "model", "createdAt", "width", "height", "fps", "frames"}
    assert track["model"] == "mediapipe-pose-landmarker-full/float16/1" and track["fps"] == 15
    f = next(f for f in track["frames"] if f["lm"])
    assert len(f["lm"]) == 99 and len(f["world"]) == 99 and f["people"] == 1
    assert set(track["image"]) >= {"luma", "contrast", "sharpness"}

    def knee(lm):
        p = [(lm[LM[n] * 3] * track["width"], lm[LM[n] * 3 + 1] * track["height"]) for n in ("left_hip", "left_knee", "left_ankle")]
        u = (p[0][0] - p[1][0], p[0][1] - p[1][1])
        v = (p[2][0] - p[1][0], p[2][1] - p[1][1])
        return math.degrees(math.acos((u[0] * v[0] + u[1] * v[1]) / (math.hypot(*u) * math.hypot(*v))))

    deepest = min(knee(f["lm"]) for f in track["frames"] if f["lm"])
    assert abs(deepest - 45.9) < 6
    proxy = archive / "clips" / kept["id"] / "proxy.mp4"
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(proxy)],
                                      capture_output=True, check=True).stdout)
    assert [s["codec_type"] for s in probe["streams"]] == ["video"]  # no sound
    assert "creation_time" not in (probe["format"].get("tags") or {})  # no metadata


def test_run_again_does_nothing(archive, inputs, model, capsys):
    main(["run", str(inputs), "--out", str(archive), "--model", model])
    assert "To do: 0 videos" in capsys.readouterr().out


def test_pack_for_the_app(archive, tmp_path):
    main(["pack", "--out", str(archive), "--dest", str(tmp_path)])
    (z,) = tmp_path.glob("phoenix-archive-clips-*.zip")
    with zipfile.ZipFile(z) as zf:
        names = set(zf.namelist())
        index = [json.loads(line) for line in zf.read("index.jsonl").decode().splitlines()]
    assert len(index) == 1 and "sig" not in index[0]  # copies left out; fingerprints stay home
    cid = index[0]["id"]
    assert {f"clips/{cid}/track.json.gz", f"clips/{cid}/proxy.mp4", f"clips/{cid}/thumb.jpg", "archive.json"} <= names
