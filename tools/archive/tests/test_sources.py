import json
import zipfile

from phoenix_archive.sources import Sidecars, dir_key, in_shard, materialize, scan

VIDEO = b"\x00" * 30_000  # big enough to count as a video


def _sidecar(title, ts=1542738600):
    return json.dumps({"title": title, "photoTakenTime": {"timestamp": str(ts)}, "geoData": {"latitude": 1.0, "longitude": 2.0}})


def test_dir_key_ignores_where_the_takeout_was_unpacked():
    assert dir_key("Takeout/Google Photos/Photos from 2019") == "google photos/photos from 2019"
    assert dir_key("D:/exports/old/Takeout/Google Photos/Trip") == "google photos/trip"
    assert dir_key("Videos/2019") == "videos/2019"


def test_sidecar_name_variants():
    s = Sidecars()
    d = "Takeout/Google Photos/Photos from 2019"
    s.add(d, "a.mp4.json", {"title": "a.mp4", "photoTakenTime": {"timestamp": "1"}})
    s.add(d, "b.mp4.supplemental-metadata.json", {"title": "b.mp4", "photoTakenTime": {"timestamp": "2"}})
    s.add(d, "c.mp4(1).json", {"title": "c.mp4", "photoTakenTime": {"timestamp": "3"}})
    s.add(d, "c.mp4.json", {"title": "c.mp4", "photoTakenTime": {"timestamp": "4"}})
    s.add(d, "PXL_20230102_030405678.LONG_EXPOSURE.mp4.supplemen.json", {"title": "x", "photoTakenTime": {"timestamp": "5"}})
    s.add(d, "renamed.json", {"title": "original name.mp4", "photoTakenTime": {"timestamp": "6"}})
    ts = lambda name: (s.find(d, name) or {}).get("photoTakenTime", {}).get("timestamp")  # noqa: E731
    assert ts("a.mp4") == "1"
    assert ts("b.mp4") == "2"
    assert ts("c(1).mp4") == "3"
    assert ts("c.mp4") == "4"
    assert ts("PXL_20230102_030405678.LONG_EXPOSURE.mp4") == "5"  # cut-short sidecar name
    assert ts("original name.mp4") == "6"  # matched by its title
    assert ts("original name-edited.mp4") == "6"  # edited copies share the original's sidecar
    assert ts("unknown.mp4") is None


def test_scan_folders_and_takeout_zips(tmp_path):
    (tmp_path / "phone").mkdir()
    (tmp_path / "phone" / "VID_20190312_123456.mp4").write_bytes(VIDEO)
    (tmp_path / "phone" / "tiny.mp4").write_bytes(b"x" * 100)
    (tmp_path / "phone" / "notes.txt").write_text("hi")
    (tmp_path / "phone" / "._VID_20190312_123456.mp4").write_bytes(VIDEO)  # macOS clutter
    z = tmp_path / "takeout-001.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("Takeout/Google Photos/Photos from 2018/PXL_20181120_183000123.mp4", VIDEO)
        zf.writestr("Takeout/Google Photos/Photos from 2018/IMG_0001.JPG", b"jpeg")
    # the sidecar is in another part of the split export
    with zipfile.ZipFile(tmp_path / "takeout-002.zip", "w") as zf:
        zf.writestr("Takeout/Google Photos/Photos from 2018/PXL_20181120_183000123.mp4.supplemental-metadata.json", _sidecar("PXL_20181120_183000123.mp4"))
    found = {s.name: s for s in scan([str(tmp_path)], on_warning=lambda m: None)}
    assert set(found) == {"VID_20190312_123456.mp4", "PXL_20181120_183000123.mp4"}
    pxl = found["PXL_20181120_183000123.mp4"]
    assert pxl.in_zip and pxl.member.endswith("PXL_20181120_183000123.mp4")
    assert pxl.rel == "takeout-001.zip::Takeout/Google Photos/Photos from 2018/PXL_20181120_183000123.mp4"
    assert pxl.sidecar["photoTakenTime"]["timestamp"] == "1542738600"
    assert found["VID_20190312_123456.mp4"].sidecar is None


def test_materialize_gives_the_same_id_inside_and_outside_a_zip(tmp_path):
    data = bytes(range(256)) * 200
    (tmp_path / "a.mp4").write_bytes(data)
    with zipfile.ZipFile(tmp_path / "t.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("x/b.mp4", data)
    srcs = {s.name: s for s in scan([str(tmp_path)], on_warning=lambda m: None)}
    with materialize(srcs["a.mp4"], str(tmp_path / "tmp")) as (pa, ida):
        assert pa == srcs["a.mp4"].path
    with materialize(srcs["b.mp4"], str(tmp_path / "tmp")) as (pb, idb):
        assert open(pb, "rb").read() == data
    assert ida == idb and len(ida) == 16
    assert not list((tmp_path / "tmp").iterdir())  # the unpacked copy is removed


def test_shards_split_the_work_without_overlap(tmp_path):
    for i in range(40):
        (tmp_path / f"v{i}.mp4").write_bytes(VIDEO)
    srcs = scan([str(tmp_path)], on_warning=lambda m: None)
    a = {s.key for s in srcs if in_shard(s, (1, 2))}
    b = {s.key for s in srcs if in_shard(s, (2, 2))}
    assert a and b and not (a & b) and len(a | b) == 40
