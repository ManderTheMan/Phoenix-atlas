"""Photos: when they were taken, what's in their metadata, and whether someone is in them.

A usable photo (someone in it, big enough) keeps a small copy without metadata,
a thumbnail and its joints (a one-frame track in the app's format). With
--keep-metadata, everything the file says about itself (camera, settings,
location) is written to meta.json beside it, for your own use: packs for the app
leave it out.
"""
from __future__ import annotations

import io
import math
from fractions import Fraction
from pathlib import Path

import numpy as np

from .media import MediaError

PHOTO_EDGE = 1600  # long side of the small copy
TRACK_EDGE = 1280  # long side the joints are found at
THUMB_EDGE = 360

_heif_checked = False


def _register_heif() -> bool:
    """HEIC/HEIF (iPhone photos) needs the optional pillow-heif package."""
    global _heif_checked
    try:
        import pillow_heif

        if not _heif_checked:
            pillow_heif.register_heif_opener()
            _heif_checked = True
        return True
    except ImportError:
        return False


def open_image(path: str):
    """The image, upright (EXIF orientation applied), and its EXIF."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    if Path(path).suffix.lower() in (".heic", ".heif") and not _register_heif():
        raise MediaError("HEIC photos need pillow-heif (pip install pillow-heif)")
    try:
        img = Image.open(path)
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise MediaError(f"not a readable image ({e})"[:200]) from e
    exif = img.getexif()
    try:
        upright = ImageOps.exif_transpose(img)
    except (OSError, ValueError, TypeError):
        upright = img
    if upright.mode != "RGB":
        upright = upright.convert("RGB")
    return upright, exif


# EXIF tag numbers
_EXIF_IFD, _GPS_IFD = 0x8769, 0x8825
_DATETIME, _DATETIME_ORIGINAL, _DATETIME_DIGITIZED = 306, 36867, 36868
_OFFSET_ORIGINAL, _OFFSET = 36881, 36880
_MAKE, _MODEL = 271, 272


def _clean(v):
    """EXIF values as plain JSON: rationals to numbers, bytes to short text, tuples to lists."""
    if isinstance(v, bytes):
        text = v.rstrip(b"\x00")
        try:
            s = text.decode("utf-8")
            return s if s.isprintable() and len(s) <= 500 else f"<{len(v)} bytes>"
        except UnicodeDecodeError:
            return f"<{len(v)} bytes>"
    if isinstance(v, (tuple, list)):
        return [_clean(x) for x in v][:64]
    if isinstance(v, Fraction) or type(v).__name__ == "IFDRational":
        try:
            f = float(v)
        except (ZeroDivisionError, ValueError):
            return None
        return None if math.isnan(f) or math.isinf(f) else round(f, 6)
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(v, (int, str)) or v is None:
        return v.strip("\x00").strip() if isinstance(v, str) else v
    return str(v)[:200]


def _named(ifd: dict, names: dict) -> dict:
    return {names.get(k, str(k)): _clean(v) for k, v in ifd.items() if k not in (_EXIF_IFD, _GPS_IFD) and k != 0x927C}  # 0x927C: maker notes, opaque


def _gps(gps: dict) -> dict | None:
    """Latitude, longitude (degrees) and altitude (m) from the GPS IFD."""

    def deg(v, ref) -> float | None:
        try:
            d, m, s = (float(x) for x in v)
        except (TypeError, ValueError, ZeroDivisionError):
            return None
        x = d + m / 60 + s / 3600
        return round(-x if str(ref).upper() in ("S", "W") else x, 7)

    lat, lon = deg(gps.get(2), gps.get(1)), deg(gps.get(4), gps.get(3))
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None
    out = {"lat": lat, "lon": lon}
    try:
        alt = float(gps[6])
        out["alt"] = round(-alt if gps.get(5) in (1, b"\x01") else alt, 1)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        pass
    return out


def exif_date(exif) -> str | None:
    """When the photo was taken, from EXIF, as an ISO time (with its zone when the camera recorded one)."""
    try:
        sub = exif.get_ifd(_EXIF_IFD)
    except (KeyError, ValueError, TypeError):
        sub = {}
    for tag, off in ((_DATETIME_ORIGINAL, _OFFSET_ORIGINAL), (_DATETIME_DIGITIZED, _OFFSET), (_DATETIME, _OFFSET)):
        v = sub.get(tag) or (exif.get(tag) if tag == _DATETIME else None)
        if not isinstance(v, str) or len(v) < 19 or v.startswith("0000"):
            continue
        iso = v[:10].replace(":", "-") + "T" + v[11:19]
        zone = sub.get(off)
        if isinstance(zone, str) and len(zone) == 6 and zone[0] in "+-":
            iso += zone
        return iso
    return None


def exif_meta(exif) -> dict:
    """Everything the file says about itself, for meta.json: camera, settings, times and location."""
    from PIL.ExifTags import GPSTAGS, TAGS

    meta: dict = {"exif": _named(dict(exif), TAGS)}
    try:
        sub = exif.get_ifd(_EXIF_IFD)
        if sub:
            meta["exif"].update(_named(dict(sub), TAGS))
    except (KeyError, ValueError, TypeError):
        pass
    try:
        gps = exif.get_ifd(_GPS_IFD)
    except (KeyError, ValueError, TypeError):
        gps = {}
    if gps:
        meta["gpsRaw"] = _named(dict(gps), GPSTAGS)
        loc = _gps(gps)
        if loc:
            meta["location"] = loc
    device = " ".join(str(_clean(exif.get(t)) or "").strip() for t in (_MAKE, _MODEL)).strip()
    if device:
        meta["device"] = device
    return meta


def as_array(img, long_edge: int) -> np.ndarray:
    from PIL import Image

    k = min(1.0, long_edge / max(img.size))
    if k < 1:
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    return np.asarray(img, dtype=np.uint8)


def save_jpeg(img, path: Path, long_edge: int, quality: int) -> tuple[int, int]:
    """A JPEG copy with no metadata at all (Pillow writes none unless given it)."""
    from PIL import Image

    k = min(1.0, long_edge / max(img.size))
    out = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS) if k < 1 else img
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=quality, optimize=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(buf.getvalue())
    tmp.replace(path)
    return out.width, out.height
