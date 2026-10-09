from datetime import datetime, timezone

from phoenix_archive.dates import parse_filename_time, parse_metadata_time, resolve, takeout_time


def test_camera_and_app_file_names():
    cases = {
        "VID_20190312_123456.mp4": datetime(2019, 3, 12, 12, 34, 56),
        "PXL_20230102_030405678.mp4": datetime(2023, 1, 2, 3, 4, 5),
        "20190312_123456.mp4": datetime(2019, 3, 12, 12, 34, 56),
        "WhatsApp Video 2019-03-12 at 12.34.56.mp4": datetime(2019, 3, 12, 12, 34, 56),
        "Screen_Recording_20261008_165821_Instagram.mp4": datetime(2026, 10, 8, 16, 58, 21),
        "signal-2019-03-12-123456.mp4": datetime(2019, 3, 12, 12, 34, 56),
        "VID-20190312-WA0001.mp4": datetime(2019, 3, 12, 12, 0, 0),
    }
    for name, expected in cases.items():
        assert parse_filename_time(name) == expected, name


def test_names_without_a_date():
    for name in ("IMG_4521.MOV", "clip.mp4", "19990101_000000.mp4", "VID_20191345_000000.mp4", "1234567890123.mp4"):
        assert parse_filename_time(name) is None, name


def test_metadata_times():
    assert parse_metadata_time("2019-03-12T12:34:56.000000Z") == datetime(2019, 3, 12, 12, 34, 56, tzinfo=timezone.utc)
    assert parse_metadata_time("2019-03-12T12:34:56+0100").utcoffset().total_seconds() == 3600
    assert parse_metadata_time("2019-03-12 12:34:56") == datetime(2019, 3, 12, 12, 34, 56)
    # containers write 1904 or 1970 when they don't know
    assert parse_metadata_time("1904-01-01T00:00:00.000000Z") is None
    assert parse_metadata_time("1970-01-01T00:00:00Z") is None
    assert parse_metadata_time("") is None


def test_takeout_sidecar():
    assert takeout_time({"photoTakenTime": {"timestamp": "1542738600"}}) == datetime(2018, 11, 20, 18, 30, tzinfo=timezone.utc)
    assert takeout_time({"photoTakenTime": {"timestamp": "0"}, "creationTime": {"timestamp": "1542738600"}}).year == 2018
    assert takeout_time({}) is None


def test_trust_order():
    sidecar = {"photoTakenTime": {"timestamp": "1542738600"}}
    tags = {"creation_time": "2020-01-01T00:00:00Z"}
    assert resolve(sidecar, tags, "VID_20190312_123456.mp4", 1.7e9)[1] == "takeout"
    assert resolve(None, tags, "VID_20190312_123456.mp4", 1.7e9)[1] == "metadata"
    assert resolve(None, {}, "VID_20190312_123456.mp4", 1.7e9)[1] == "filename"
    assert resolve(None, {}, "clip.mp4", 1.7e9)[1] == "file"
    assert resolve(None, {}, "clip.mp4", None) == (None, "unknown")
