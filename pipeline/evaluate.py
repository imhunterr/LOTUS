"""Notification precision / sensitivity: LOTUS vs. the NDC-matching baseline, under injected failures.

  NDC baseline : notify every patient whose (linked) record shows the recalled DRUG, any lot.
  LOTUS        : notify a patient iff their device matches a commitment on the recalled LOT.
                 Fails if the key is lost and not recovered by Guardians, or if the lot was misrecorded.
  LOTUS + conv.: LOTUS in parallel with conventional channels (degradation invariant I6). The
                 conventional channel only adds reach here (the sensitivity floor); its alarms are
                 not counted against precision because they are the status quo, not LOTUS output.

Usage:  python pipeline/evaluate.py --patients 10000 --recalls 30
Writes: data/out/eval.csv and, if matplotlib is installed, data/out/sensitivity.png
"""
from __future__ import annotations

import argparse
import csv
import random
from collections import defaultdict
from pathlib import Path

from cohort import generate

ROOT = Path(__file__).resolve().parent


def run(dispenses, rng, lost_key, guardian_recovery, misrecord, n_recalls):
    by_lot, by_ndc_linked, lots_of_ndc = defaultdict(set), defaultdict(set), defaultdict(set)
    recorded_lot = {}
    for i, d in enumerate(dispenses):
        by_lot[d["lot"]].add(d["patient"])
        if d["ehr_linked"]:
            by_ndc_linked[d["ndc"]].add(d["patient"])
        lots_of_ndc[d["ndc"]].add(d["lot"])
    for i, d in enumerate(dispenses):
        lot = d["lot"]
        if rng.random() < misrecord:  # pharmacy scanned the wrong shelf lot of the same drug
            lot = rng.choice(sorted(lots_of_ndc[d["ndc"]]))
        recorded_lot[i] = lot

    patients = {d["patient"] for d in dispenses}
    has_key = {p for p in patients if rng.random() >= lost_key or rng.random() < guardian_recovery}
    lotus_by_lot = defaultdict(set)
    for i, d in enumerate(dispenses):
        if d["patient"] in has_key:
            lotus_by_lot[recorded_lot[i]].add(d["patient"])

    candidates = [l for l, ps in by_lot.items() if len(ps) >= 5]
    totals = defaultdict(lambda: [0, 0, 0])  # method -> [tp, fp, fn]
    for lot in rng.sample(candidates, min(n_recalls, len(candidates))):
        truth = by_lot[lot]
        ndc = lot.rsplit("-L", 1)[0]
        baseline = by_ndc_linked[ndc]
        lotus = lotus_by_lot[lot]
        combined_reach = lotus | (baseline & truth)  # conventional channel still reaches linked true patients
        for name, flagged, reached in (("ndc_baseline", baseline, baseline & truth),
                                        ("lotus", lotus, lotus & truth),
                                        ("lotus_plus_conventional", lotus, combined_reach)):
            t = totals[name]
            t[0] += len(reached)
            t[1] += len(flagged - truth)
            t[2] += len(truth - reached)
    return {m: {"precision": tp / (tp + fp) if tp + fp else 1.0, "sensitivity": tp / (tp + fn) if tp + fn else 1.0}
            for m, (tp, fp, fn) in totals.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--patients", type=int, default=10_000)
    ap.add_argument("--recalls", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--guardian-recovery", type=float, default=0.8)
    args = ap.parse_args()

    dispenses = generate(args.patients, args.seed, None)
    rows = []
    for lost in (0.0, 0.05, 0.10, 0.20):
        for mis in (0.0, 0.005, 0.01, 0.02):
            res = run(dispenses, random.Random(args.seed), lost, args.guardian_recovery, mis, args.recalls)
            for method, m in res.items():
                rows.append({"lost_key": lost, "misrecord": mis, "method": method, **{k: round(v, 4) for k, v in m.items()}})

    out = ROOT / "data" / "out"
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "eval.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)

    print(f"{'lost':>5} {'misrec':>7} {'method':<25} {'precision':>9} {'sensitivity':>11}")
    for r in rows:
        if r["misrecord"] in (0.0, 0.01):
            print(f"{r['lost_key']:>5} {r['misrecord']:>7} {r['method']:<25} {r['precision']:>9} {r['sensitivity']:>11}")

    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return
    fig, ax = plt.subplots(1, 2, figsize=(11, 4))
    for method in ("ndc_baseline", "lotus", "lotus_plus_conventional"):
        pts = [r for r in rows if r["method"] == method and r["misrecord"] == 0.01]
        ax[0].plot([p["lost_key"] for p in pts], [p["sensitivity"] for p in pts], marker="o", label=method)
        ax[1].plot([p["lost_key"] for p in pts], [p["precision"] for p in pts], marker="o", label=method)
    ax[0].set(title="Sensitivity vs lost-key rate (1% misrecorded)", xlabel="lost-key rate", ylabel="sensitivity")
    ax[1].set(title="Precision vs lost-key rate", xlabel="lost-key rate", ylabel="precision")
    ax[0].legend()
    fig.tight_layout()
    fig.savefig(out / "sensitivity.png", dpi=150)


if __name__ == "__main__":
    main()
