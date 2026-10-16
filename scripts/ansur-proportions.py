#!/usr/bin/env python3
"""Population figures for the app's proportions (Profile -> Your proportions -> Load figures).

Reads the public ANSUR II tables (the 2012 US Army anthropometric survey: about
4,000 men and 2,000 women, published by Penn State's OPEN Design Lab) and writes the spread
of each body ratio the app uses, at nine percentiles, relative to the men's median.

    python3 scripts/ansur-proportions.py "ANSUR II MALE Public.csv" "ANSUR II FEMALE Public.csv" -o ansur2-proportions.json

Standard library only. Each file's sex comes from its Gender column, or from "female"/"male" in its name.
"""
import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

QS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]

# The app's ratios (src/movement/proportions.ts) from the survey's tape measures (mm).
RATIOS = {
    # hip height over stature: the greater trochanter's height stands in for the hip joint's
    "legs": (("trochanterionheight", "stature"), lambda r: r["trochanterionheight"] / r["stature"]),
    # thigh (trochanter to the knee joint line) over lower leg (knee joint line to the ankle bone)
    "thighShin": (
        ("trochanterionheight", "tibialheight", "lateralmalleolusheight"),
        lambda r: (r["trochanterionheight"] - r["tibialheight"]) / (r["tibialheight"] - r["lateralmalleolusheight"]),
    ),
    # arm span over stature
    "ape": (("span", "stature"), lambda r: r["span"] / r["stature"]),
}


def quantile(sorted_vals, q):
    """Linear interpolation between order statistics."""
    i = (len(sorted_vals) - 1) * q
    lo = int(i)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def read_rows(path):
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    reader = csv.DictReader(text.splitlines())
    rows = []
    for row in reader:
        rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in row.items()})
    return rows


def sex_of(path, rows):
    genders = {r.get("gender", "").lower() for r in rows[:50]}
    if genders <= {"female"} and genders:
        return "female"
    if genders <= {"male"} and genders:
        return "male"
    name = Path(path).name.lower()
    if "female" in name:
        return "female"
    if "male" in name:
        return "male"
    sys.exit(f"{path}: can't tell whether this is the men's or the women's table (no Gender column, and the name doesn't say)")


def ratios_for(rows, path):
    out = {k: [] for k in RATIOS}
    have = set(rows[0].keys()) if rows else set()
    for name, (cols, fn) in RATIOS.items():
        missing = [c for c in cols if c not in have]
        if missing:
            sys.exit(f"{path}: missing column(s) {', '.join(missing)} needed for {name}")
        for r in rows:
            try:
                vals = {c: float(r[c]) for c in cols}
            except ValueError:
                continue
            if any(v <= 0 for v in vals.values()):
                continue
            v = fn(vals)
            if 0.3 < v < 3:
                out[name].append(v)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tables", nargs=2, help="the men's and women's ANSUR II CSV files (either order)")
    ap.add_argument("-o", "--out", default="ansur2-proportions.json")
    a = ap.parse_args()

    by_sex = {}
    counts = {}
    for path in a.tables:
        rows = read_rows(path)
        if not rows:
            sys.exit(f"{path}: no rows")
        s = sex_of(path, rows)
        if s in by_sex:
            sys.exit(f"both files look like the {s} table")
        by_sex[s] = ratios_for(rows, path)
        counts[s] = len(rows)
    if set(by_sex) != {"male", "female"}:
        sys.exit("need one men's and one women's table")

    table = {"source": f"ANSUR II (2012), {counts['male']} men and {counts['female']} women", "approx": False, "ratios": {}}
    for name in RATIOS:
        male_median = statistics.median(by_sex["male"][name])
        table["ratios"][name] = {}
        for s in ("male", "female"):
            vals = sorted(by_sex[s][name])
            table["ratios"][name][s] = [round(quantile(vals, q) / male_median, 4) for q in QS]
            med = statistics.median(vals)
            cv = statistics.stdev(vals) / statistics.mean(vals)
            print(f"{name:10s} {s:6s} n={len(vals):5d}  median={med:.4f}  spread (cv)={cv * 100:.1f}%")

    Path(a.out).write_text(json.dumps(table, indent=1))
    print(f"wrote {a.out}: load it in the app under Profile -> Your proportions -> Load figures")


if __name__ == "__main__":
    main()
