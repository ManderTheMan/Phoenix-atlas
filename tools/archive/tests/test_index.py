import random

import pytest

from phoenix_archive.index import best_date, mark_near_duplicates, parse_day, same_footage


def _clip(id_, duration=5.0, sig=None, psig=None, **kw):
    return {"id": id_, "duration": duration, "sig": sig, "psig": psig, "status": "usable", "width": 1080, "height": 1920, **kw}


def _sig(seed, n=6):
    rnd = random.Random(seed)
    return [f"{rnd.getrandbits(256):064x}" for _ in range(n)]


def _flip(h, bits):
    v = int(h, 16)
    for b in range(bits):
        v ^= 1 << (b * 7 % 256)
    return f"{v:064x}"


def _psig(offset=0):
    return [[500 + offset + k for k in range(24)] for _ in range(6)]


def test_copies_match_and_different_sets_dont():
    base = _clip("a", sig=_sig(1), psig=_psig())
    copy = _clip("b", duration=5.2, sig=[_flip(h, 5) for h in _sig(1)], psig=_psig(2))  # re-encoded: a few bits, 0.002 of the frame
    other_set = _clip("c", sig=[_flip(h, 5) for h in _sig(1)], psig=_psig(15))  # same spot, joints 0.015 apart
    other_length = _clip("d", duration=6.0, sig=_sig(1), psig=_psig())
    assert same_footage(base, copy)
    assert not same_footage(base, other_set)
    assert not same_footage(base, other_length)
    assert not same_footage(base, _clip("e", sig=_sig(2), psig=_psig()))


def test_the_best_copy_is_kept():
    small = _clip("a", sig=_sig(1), psig=_psig(), width=360, height=640)
    full = _clip("b", sig=_sig(1), psig=_psig(1))
    third = _clip("c", sig=_sig(1), psig=_psig(2), width=720, height=1280)
    rows = [small, full, third]
    mark_near_duplicates(rows)
    assert "nearDuplicateOf" not in full
    assert small["nearDuplicateOf"] == "b" and third["nearDuplicateOf"] == "b"


def test_copies_lend_their_best_date():
    r = {"date": 1, "dateSource": "file"}
    best_date(r, [{"date": 2, "dateSource": "filename"}, {"date": 3, "dateSource": "takeout"}, {"date": 4, "dateSource": "file"}])
    assert r == {"date": 3, "dateSource": "takeout"}


def test_day_ranges():
    assert parse_day("2019") < parse_day("2019-03") < parse_day("2019-03-12") < parse_day("2019", end=True)
    assert parse_day("2019-12", end=True) == parse_day("2020-01")
    with pytest.raises(SystemExit):
        parse_day("12/03/2019")
