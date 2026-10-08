"""Report figures (P5) from the evaluation, gas and red-team outputs → docs/figures/*.png

  python pipeline/evaluate.py && node sdk/bench/client.mjs && (cd contracts && npx hardhat run scripts/bench-gas.js)
  npm start -w redteam
  python pipeline/figures.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "out"
FIG = ROOT.parent / "docs" / "figures"
FIG.mkdir(parents=True, exist_ok=True)

# Validated categorical slots 1–3 (all-pairs safe) + text/surface tokens. One colour per method, everywhere.
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
METHOD = {
    "lotus": ("LOTUS", "#2a78d6"),
    "ndc_baseline": ("Today: drug-code matching", "#eb6834"),
    "lotus_plus_conventional": ("LOTUS + existing channels", "#1baf7a"),
}
SEQ = ["#9ec5f4", "#5a9be6", "#1f5fae"]  # one hue, light → dark, for ordered magnitudes

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.axisbelow": True, "lines.linewidth": 2, "lines.markersize": 6,
})


def read_csv(name):
    with open(OUT / name) as f:
        return list(csv.DictReader(f))


def end_label(ax, xs, ys, text, color, dy=0):
    ax.annotate(text, (xs[-1], ys[-1]), xytext=(8, dy), textcoords="offset points", va="center", color=INK, fontsize=9)
    ax.plot(xs[-1], ys[-1], "o", color=color, markeredgecolor=SURFACE, markeredgewidth=1.5)


def fig_accuracy():
    rows = [r for r in read_csv("eval.csv") if float(r["misrecord"]) == 0.01]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    for ax, metric, title in ((axes[0], "sensitivity", "Sensitivity: share of affected patients reached"),
                              (axes[1], "precision", "Precision: share of alerts that were real")):
        # Draw "LOTUS + existing" first and wider, so LOTUS stays visible where the two coincide.
        order = ["ndc_baseline", "lotus_plus_conventional", "lotus"]
        for key in order:
            label, color = METHOD[key]
            pts = [r for r in rows if r["method"] == key]
            xs = [float(p["lost_key"]) * 100 for p in pts]
            ys = [float(p[metric]) for p in pts]
            wide = key == "lotus_plus_conventional"
            ax.plot(xs, ys, color=color, linewidth=5 if wide else 2, marker="o", markersize=8 if wide else 6,
                    markeredgecolor=SURFACE, markeredgewidth=1.5, zorder=2 if wide else 3)
            if metric == "precision" and key == "lotus":
                label = "LOTUS (same as above)"
            end_label(ax, xs, ys, label, color, {"lotus": -9, "lotus_plus_conventional": 9, "ndc_baseline": 0}[key])
        ax.set_title(title, loc="left")
        ax.set_xlabel("Patients who lost their phone (%)")
        ax.set_xlim(-1, 34)
        ax.set_xticks([0, 5, 10, 20])
        ax.set_ylim(0, 1.05)
    fig.text(0.01, 0.01, "10,000 synthetic patients · 30 lot recalls · 1% of lots misrecorded · 80% Guardian recovery", color=INK2, fontsize=8)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(FIG / "accuracy.png", dpi=180)


def fig_gas():
    rows = read_csv("gas_dispense.csv")
    xs = [int(r["leaf_index"]) for r in rows]
    ys = [int(r["gas"]) / 1000 for r in rows]
    window = 32
    avg = [sum(ys[max(0, i - window + 1): i + 1]) / len(ys[max(0, i - window + 1): i + 1]) for i in range(len(ys))]
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.scatter(xs, ys, s=6, color="#9ec5f4", linewidths=0, label="each dispense")
    ax.plot(xs, avg, color=METHOD["lotus"][1], label="32-dispense average")
    ax.axhline(933, color=INK2, linewidth=1, linestyle=(0, (4, 3)))
    ax.text(20, 945, "fixed-depth tree (before): 933k every time", va="bottom", ha="left", color=INK2, fontsize=9)
    mean = sum(ys) / len(ys)
    end_label(ax, xs, avg, f"lean tree: {mean:.0f}k mean", METHOD["lotus"][1])
    ax.set_title("Gas per dispense as a lot fills up", loc="left")
    ax.set_xlabel("Dispenses already recorded for this lot")
    ax.set_ylabel("Gas (thousands)")
    ax.set_ylim(0, 1000)
    ax.set_xlim(0, xs[-1] * 1.18)
    ax.legend(loc="lower left", frameon=False, ncols=2)
    fig.tight_layout()
    fig.savefig(FIG / "gas_dispense.png", dpi=180)


def fig_timing():
    data = json.loads((ROOT.parent / "redteam" / "results.json").read_text())
    rows = next(r for r in data if r["id"] == "A2")["rows"]
    batches = sorted({r["batchSeconds"] for r in rows})
    rates = sorted({r["dispensesPerHour"] for r in rows})
    fig, ax = plt.subplots(figsize=(11, 4))
    width = 0.26
    for i, rate in enumerate(rates):
        vals = [next(r["shareUniquelyIdentified"] for r in rows if r["batchSeconds"] == b and r["dispensesPerHour"] == rate) * 100 for b in batches]
        xs = [j + (i - 1) * (width + 0.02) for j in range(len(batches))]
        bars = ax.bar(xs, vals, width=width, color=SEQ[i], label=f"{rate} dispenses / hour")
        for x, v in zip(xs, vals):
            ax.text(x, v + 1.5, f"{v:.0f}%", ha="center", fontsize=8, color=INK2)
    ax.set_xticks(range(len(batches)), ["submitted instantly", "batched every 15 min", "batched hourly"])
    ax.set_ylabel("Dispenses an observer can pin down (%)")
    ax.set_ylim(0, 105)
    ax.set_title("Timing attack at the counter, and how batching closes it", loc="left")
    ax.grid(axis="x", visible=False)
    ax.legend(frameon=False, loc="upper right")
    fig.tight_layout()
    fig.savefig(FIG / "timing_attack.png", dpi=180)


if __name__ == "__main__":
    fig_accuracy()
    fig_gas()
    fig_timing()
    print("Figures written to", FIG)
