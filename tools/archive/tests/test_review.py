"""Small pieces that need neither MediaPipe nor ffmpeg."""
from fractions import Fraction

from phoenix_archive.photos import _gps
from phoenix_archive.process import video_device, video_location
from phoenix_archive.review import _norm_pattern


def test_lift_names_become_patterns():
    assert _norm_pattern("Back squat") == ("squat", "Back squat")
    assert _norm_pattern("deadlift") == ("hinge", "deadlift")
    assert _norm_pattern("pullV") == ("pullV", None)
    assert _norm_pattern("pullv") == ("pullV", None)
    assert _norm_pattern("Bench press") == ("pushH", "Bench press")
    assert _norm_pattern("skydiving") == (None, None)
    assert _norm_pattern("") == (None, None)


def test_where_a_video_was_filmed():
    assert video_location({"com.apple.quicktime.location.iso6709": "+51.5072-000.1276+011.000/"}) == {"lat": 51.5072, "lon": -0.1276, "alt": 11.0}
    assert video_location({"location": "+40.4168-003.7038/"}) == {"lat": 40.4168, "lon": -3.7038}
    assert video_location({"location": "+00.0000+000.0000/"}) is None
    assert video_location({}) is None
    assert video_device({"com.android.manufacturer": "Google", "com.android.model": "Pixel 7"}) == "Google Pixel 7"
    assert video_device({}) is None


def test_where_a_photo_was_taken():
    gps = {1: "S", 2: (Fraction(33), Fraction(52), Fraction(4)), 3: "E", 4: (Fraction(151), Fraction(12), Fraction(36)), 5: b"\x00", 6: Fraction(58)}
    assert _gps(gps) == {"lat": -33.8677778, "lon": 151.21, "alt": 58.0}
    assert _gps({1: "N", 2: (0, 0, 0), 3: "E", 4: (0, 0, 0)}) is None  # 0,0 means "no fix"
    assert _gps({}) is None
