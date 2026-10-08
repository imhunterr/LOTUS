"""Synthetic patient cohort + dispensing history.

If a Synthea output directory is given (--synthea path/to/output/csv), medications are read from
its medications.csv. Otherwise a built-in deterministic generator is used, so experiments are
reproducible byte-for-byte from the seed.

Usage:  python pipeline/cohort.py --patients 10000 --seed 7
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Placeholder drug catalogue; replace with ndc_directory from openfda.py for real identities.
DRUGS = [f"DEMO-{i:04d}" for i in range(40)]
LOTS_PER_DRUG = 6
REGIONS = [1, 2, 3]
PHARMACIES = 60


def generate(n_patients: int, seed: int, synthea: Path | None) -> list[dict]:
    rng = random.Random(seed)
    drug_codes = DRUGS
    if synthea:
        with open(synthea / "medications.csv") as f:
            drug_codes = sorted({row["CODE"] for row in csv.DictReader(f)})[:200] or DRUGS
    popularity = [rng.paretovariate(1.2) for _ in drug_codes]

    dispenses = []
    for pid in range(n_patients):
        pharmacy = rng.randrange(PHARMACIES)
        for _ in range(rng.randint(1, 6)):
            drug = rng.choices(drug_codes, weights=popularity)[0]
            dispenses.append({
                "patient": pid,
                "ndc": drug,
                "lot": f"{drug}-L{rng.randrange(LOTS_PER_DRUG)}",
                "pharmacy": pharmacy,
                "region": REGIONS[pharmacy % len(REGIONS)],
                # ~15% of real dispenses have no drug-level linkage (cash sales, transfers, fragmented EHRs)
                "ehr_linked": rng.random() > 0.15,
            })
    return dispenses


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--patients", type=int, default=10_000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--synthea", type=Path, default=None)
    args = ap.parse_args()
    rows = generate(args.patients, args.seed, args.synthea)
    out = ROOT / "data" / "out"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"cohort_{args.patients}_s{args.seed}.json"
    path.write_text(json.dumps(rows))
    print(f"{len(rows)} dispenses for {args.patients} patients → {path}")


if __name__ == "__main__":
    main()
