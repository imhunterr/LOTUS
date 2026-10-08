"""Fetch real drug recall (enforcement) events and NDC identities from openFDA.

Writes:
  data/out/fda-replay.json                    replay events for the regulator dashboard
  apps/web/src/generated/fda-replay.json      same file, picked up by the web app

Usage:  python pipeline/openfda.py --limit 50 [--classification "Class I"]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
API = "https://api.fda.gov/drug"
FIELDS = ["recall_number", "classification", "product_description", "reason_for_recall",
          "recalling_firm", "report_date", "code_info", "status"]


def fetch_enforcement(limit: int, classification: str | None) -> list[dict]:
    search = 'status:"Ongoing"' + (f' AND classification:"{classification}"' if classification else "")
    r = requests.get(f"{API}/enforcement.json", params={"search": search, "limit": limit, "sort": "report_date:desc"}, timeout=30)
    r.raise_for_status()
    return [{k: e.get(k) for k in FIELDS} | {"product_ndc": (e.get("openfda") or {}).get("product_ndc", [])}
            for e in r.json()["results"]]


def fetch_ndc(product_ndc: str) -> dict | None:
    r = requests.get(f"{API}/ndc.json", params={"search": f'product_ndc:"{product_ndc}"', "limit": 1}, timeout=30)
    if r.status_code != 200:
        return None
    res = r.json()["results"][0]
    return {"product_ndc": product_ndc, "generic_name": res.get("generic_name"), "brand_name": res.get("brand_name"),
            "labeler_name": res.get("labeler_name"), "dosage_form": res.get("dosage_form")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--classification", default=None)
    args = ap.parse_args()

    events = fetch_enforcement(args.limit, args.classification)
    ndcs = sorted({n for e in events for n in e["product_ndc"]})[:100]
    directory = [d for n in ndcs if (d := fetch_ndc(n))]

    payload = {"source": "openFDA drug enforcement + NDC directory", "sample": False, "events": events, "ndc_directory": directory}
    out = ROOT / "data" / "out"
    out.mkdir(parents=True, exist_ok=True)
    for path in (out / "fda-replay.json", ROOT.parent / "apps" / "web" / "src" / "generated" / "fda-replay.json"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {len(events)} recall events and {len(directory)} NDC records")


if __name__ == "__main__":
    main()
