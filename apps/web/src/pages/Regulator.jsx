import { useState } from "react";
import { id as keccakId } from "ethers";
import { CLASSIFICATION, eventNdc, parseLotNumbers } from "@lotus/sdk";
import { DEMO_ACCOUNTS, asRole, contract, fetchLots, fetchRecalls } from "../lib/chain";
import { CLASS_LABEL, Card, ErrorNote, PageHeader, Stat, TxButton, useAsync } from "../components/ui";

const replayFiles = import.meta.glob("../generated/fda-replay.json", { eager: true, import: "default" });
const FDA_EVENTS = replayFiles["../generated/fda-replay.json"]?.events ?? [];
const REPLAY_SAMPLE = !!replayFiles["../generated/fda-replay.json"]?.sample;

export const REGIONS = { 1: "Udupi district", 2: "Dakshina Kannada", 3: "Shivamogga" };

async function loadAll() {
  const [lots, recalls] = await Promise.all([fetchLots(), fetchRecalls()]);
  const d = contract("dispenses");
  const r = contract("recalls");
  const s = contract("signals");

  const signalLogs = await s.queryFilter(s.filters.SafetySignal(), 0);
  const raised = new Map(signalLogs.map((l) => [l.args.lotKey, { reports: Number(l.args.reports), avg: Number(l.args.avgSeverityX100) / 100 }]));

  const lotRows = await Promise.all(lots.map(async (l) => ({
    ...l,
    dispensedUnits: Number(await d.unitsByLot(l.lotKey)),
    patients: Number(await d.leafCount(l.lotKey)),
    reports: Number(await s.reportCount(l.lotKey)),
    signal: raised.get(l.lotKey),
    recalled: recalls.some((x) => x.lotKey === l.lotKey),
  })));

  const recallRows = await Promise.all(recalls.map(async (rc) => {
    const regions = await Promise.all(Object.keys(REGIONS).map(async (reg) => {
      const [units, suppressed] = await r.affectedCount(rc.recallId, reg);
      return { region: Number(reg), units: Number(units), suppressed };
    }));
    return {
      ...rc,
      total: Number(await r.totalAffected(rc.recallId)),
      effectiveness: Number(await s.recallEffectivenessBps(rc.recallId)) / 100,
      acks: Number(await s.ackCount(rc.recallId)),
      regions,
    };
  }));
  return { lots: lotRows, recalls: recallRows };
}

export default function Regulator() {
  const data = useAsync(loadAll);
  const [replayIdx, setReplayIdx] = useState(0);
  const recall = async (lotKey, cls, reason, crowd = false) => {
    const r = await asRole("recalls", DEMO_ACCOUNTS.regulator);
    await (await r.issueRecall(lotKey, cls, keccakId(reason), crowd)).wait();
    data.reload();
    return "Recall issued. Affected patients' phones will flag it on their next check.";
  };
  const lots = data.data?.lots || [];
  const recalls = data.data?.recalls || [];
  const signals = lots.filter((l) => l.signal && !l.recalled);

  return (
    <>
      <PageHeader eyebrow="Step 5 · Regulator" title="Recall one lot, not a whole drug">
        You see counts, never people. Regional numbers below 5 are hidden so a rare drug in a small town can't point to
        one person. Verified side-effect reports from real recipients can raise an alarm before anyone files a complaint.
      </PageHeader>
      <ErrorNote error={data.error} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Lots on ledger" value={lots.length} />
        <Stat label="Active recalls" value={recalls.length} tone={recalls.length ? "bad" : "default"} />
        <Stat label="Crowd safety signals" value={signals.length} tone={signals.length ? "warn" : "default"} hint="≥ threshold verified reports" />
        <Stat label="Avg. recall effectiveness" value={recalls.length ? `${(recalls.reduce((a, r) => a + r.effectiveness, 0) / recalls.length).toFixed(0)}%` : "—"} tone="good" hint="anonymous patient confirmations" />
      </div>

      {signals.map((l) => (
        <div key={l.lotKey} className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
          <div>
            <p className="font-semibold text-amber-200">Safety signal: {l.ndc} · lot {l.lotNumber}</p>
            <p className="text-sm text-amber-100/70">{l.signal.reports} verified anonymous reports · average severity {l.signal.avg.toFixed(1)} / 5</p>
          </div>
          <TxButton onRun={() => recall(l.lotKey, 2, `crowd-signal:${l.lotNumber}`, true)}>Issue Class II recall from signal</TxButton>
        </div>
      ))}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Lots" subtitle="Recall exactly the bad batch">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="py-2">Drug · Lot</th><th>Dispensed</th><th>Reports</th><th /></tr></thead>
              <tbody className="divide-y divide-ink-700">
                {lots.map((l) => (
                  <tr key={l.lotKey}>
                    <td className="py-2">{l.ndc} · <b className="text-white">{l.lotNumber}</b></td>
                    <td className="tabular-nums">{l.dispensedUnits}</td>
                    <td className="tabular-nums">{l.reports}</td>
                    <td className="py-2 text-right">
                      {l.recalled ? <span className="pill bg-rose-500/20 text-rose-300">Recalled</span> : (
                        <TxButton className="btn px-3 py-1" onRun={() => recall(l.lotKey, 1, `manual:${l.lotNumber}`)}>Recall (Class I)</TxButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <ReplayPanel lots={lots} recall={recall} idx={replayIdx} setIdx={setReplayIdx} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {recalls.map((rc) => {
          const max = Math.max(1, ...rc.regions.map((r) => r.units));
          return (
            <Card key={rc.recallId} title={`Recall #${rc.recallId} · ${rc.ndc} lot ${rc.lotNumber}`} subtitle={`${CLASS_LABEL[rc.classification]}${rc.fromCrowdSignal ? " · triggered by crowd signal" : ""}`}>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-ink-850 p-3"><p className="text-2xl font-bold text-white">{rc.total}</p><p className="text-xs text-slate-500">units affected</p></div>
                <div className="rounded-lg bg-ink-850 p-3"><p className="text-2xl font-bold text-emerald-400">{rc.acks}</p><p className="text-xs text-slate-500">patients confirmed</p></div>
                <div className="rounded-lg bg-ink-850 p-3"><p className="text-2xl font-bold text-lotus-400">{rc.effectiveness.toFixed(0)}%</p><p className="text-xs text-slate-500">effectiveness</p></div>
              </div>
              <p className="label mt-5">Affected units by region (k ≥ 5)</p>
              <div className="space-y-2">
                {rc.regions.map((r) => (
                  <div key={r.region} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 text-slate-400">{REGIONS[r.region]}</span>
                    {r.suppressed ? <span className="text-xs italic text-slate-500">fewer than 5, hidden for privacy</span> : (
                      <>
                        <div className="h-3 flex-1 rounded-full bg-ink-700"><div className="h-3 rounded-full bg-rose-500" style={{ width: `${(r.units / max) * 100}%` }} /></div>
                        <span className="w-10 text-right tabular-nums">{r.units}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

/**
 * Feature G: replays openFDA enforcement events. If the event's lots were staged on the chain
 * (npm run demo:stage-fda) it recalls exactly those lots; otherwise it maps the event onto the next
 * unrecalled demo lot. Either way it shows how many patients drug-code matching would have alerted.
 */
function ReplayPanel({ lots, recall, idx, setIdx }) {
  if (!FDA_EVENTS.length) {
    return <Card title="Replay real FDA recalls"><p className="text-sm text-slate-500">Run <code>python pipeline/openfda.py</code> to fetch real recall events.</p></Card>;
  }
  const ev = FDA_EVENTS[idx % FDA_EVENTS.length];
  const ndc = eventNdc(ev);
  const named = parseLotNumbers(ev.code_info);
  const staged = lots.filter((l) => l.ndc === ndc && named.includes(l.lotNumber.toUpperCase()));
  const sameDrug = lots.filter((l) => l.ndc === ndc);
  const lotusPatients = staged.reduce((a, l) => a + l.patients, 0);
  const ndcPatients = sameDrug.reduce((a, l) => a + l.patients, 0);
  const cls = CLASSIFICATION[ev.classification] || 2;

  return (
    <Card title="Replay real FDA recalls" subtitle={REPLAY_SAMPLE ? "Illustrative sample events. Run pipeline/openfda.py for real ones." : "Real enforcement events from openFDA"}>
      <div className="rounded-xl bg-ink-850 p-4 text-sm">
        <p className="text-xs text-slate-500">{ev.recall_number} · {ev.classification} · NDC {ndc}</p>
        <p className="mt-1 text-slate-200">{ev.product_description}</p>
        <p className="mt-2 text-slate-400">{ev.reason_for_recall}</p>
        <p className="mt-2 text-xs text-slate-500">Lots named in the notice: {named.length ? named.join(", ") : "none parseable"}</p>
      </div>
      {staged.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-lg bg-ink-850 p-3"><p className="text-2xl font-bold text-amber-300">{ndcPatients}</p><p className="text-xs text-slate-500">patients drug-code matching would alert</p></div>
          <div className="rounded-lg bg-ink-850 p-3"><p className="text-2xl font-bold text-lotus-400">{lotusPatients}</p><p className="text-xs text-slate-500">patients LOTUS alerts (exact lots)</p></div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        {staged.length ? (
          <TxButton disabled={staged.every((l) => l.recalled)} onRun={async () => {
            for (const l of staged.filter((x) => !x.recalled)) await recall(l.lotKey, cls, ev.recall_number);
            return `Recalled ${staged.map((l) => l.lotNumber).join(", ")} exactly. Lot ${sameDrug.find((l) => !staged.includes(l))?.lotNumber ?? "—"} of the same drug is untouched.`;
          }}>{staged.every((l) => l.recalled) ? "Already replayed" : "Replay this recall"}</TxButton>
        ) : (
          <TxButton disabled={!lots.some((l) => !l.recalled)} onRun={async () => {
            const target = lots.find((l) => !l.recalled);
            const msg = await recall(target.lotKey, cls, ev.recall_number);
            return `${msg} (lots not staged, so mapped onto demo lot ${target.lotNumber})`;
          }}>Replay onto next demo lot</TxButton>
        )}
        <button className="btn-ghost" onClick={() => setIdx((i) => i + 1)}>Next event</button>
      </div>
    </Card>
  );
}
