# Data pipeline & evaluation

| Script | What it does |
|---|---|
| `openfda.py` | Pulls real recall (enforcement) events and NDC identities from openFDA; feeds the regulator's replay panel. |
| `cohort.py` | Builds a reproducible synthetic cohort (built-in generator, or Synthea `medications.csv`). |
| `evaluate.py` | Precision and sensitivity of LOTUS vs. NDC-only matching under lost-key and misrecorded-lot injection. |

```bash
pip install -r pipeline/requirements.txt
python pipeline/openfda.py --limit 50
python pipeline/evaluate.py --patients 10000 --recalls 30
```

`apps/web/src/generated/fda-replay.json` ships with a few **illustrative sample events** (marked
`"sample": true`) so the demo works offline. Run `openfda.py` to replace them with real ones.
