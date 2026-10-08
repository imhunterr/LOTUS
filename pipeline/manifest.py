"""Dataset versioning (P6): every generated file is recorded with its SHA-256 and the parameters
that produced it, so anyone can regenerate the evidence byte for byte and check it.

  python pipeline/manifest.py write     # after running the pipeline
  python pipeline/manifest.py verify    # re-run the deterministic steps and compare hashes
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "out"
MANIFEST = ROOT / "MANIFEST.json"

# Deterministic steps: (command, outputs). Seeds are fixed inside the commands.
STEPS = [
    ([sys.executable, str(ROOT / "cohort.py"), "--patients", "10000", "--seed", "7"], ["cohort_10000_s7.json"]),
    ([sys.executable, str(ROOT / "evaluate.py"), "--patients", "10000", "--recalls", "30", "--seed", "7"], ["eval.csv", "scaling.csv"]),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_steps() -> dict:
    files = {}
    for cmd, outputs in STEPS:
        subprocess.run(cmd, check=True, capture_output=True)
        for name in outputs:
            files[name] = {"sha256": sha256(OUT / name), "command": " ".join(Path(c).name if i < 2 else c for i, c in enumerate(cmd))}
    return files


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "write"
    files = run_steps()
    if mode == "write":
        MANIFEST.write_text(json.dumps({"version": 1, "files": files}, indent=2) + "\n")
        print(f"Wrote {MANIFEST.name} with {len(files)} files")
        return
    recorded = json.loads(MANIFEST.read_text())["files"]
    bad = [n for n, f in recorded.items() if files.get(n, {}).get("sha256") != f["sha256"]]
    if bad:
        print("NOT reproducible:", ", ".join(bad))
        sys.exit(1)
    print(f"Reproducible: {len(recorded)} files match byte for byte")


if __name__ == "__main__":
    main()
