import { Link } from "react-router-dom";
import { contract, fetchRecalls, deployment } from "../lib/chain";
import { Card, PageHeader, Stat, useAsync } from "../components/ui";

const FLOW = [
  ["Manufacturer", "registers lot", "/manufacturer"],
  ["Distributor", "accepts & forwards", "/distributor"],
  ["Prescriber", "issues permit", "/prescriber"],
  ["Pharmacy", "dispenses (split record)", "/pharmacy"],
  ["Regulator", "recalls one lot", "/regulator"],
  ["Patient", "self-identifies privately", "/patient"],
];

export default function Overview() {
  const stats = useAsync(async () => {
    if (!deployment) return null;
    return {
      lots: Number(await contract("batches").lotCount()),
      dispenses: Number(await contract("dispenses").totalDispenses()),
      permits: Number(await contract("prescriptions").permitCount()),
      recalls: (await fetchRecalls()).length,
    };
  });
  const s = stats.data;
  return (
    <>
      <PageHeader eyebrow="Lot-Oriented Traceability for Unlinkable Subjects" title="Recall the right patients, and only them">
        Today a recall of one bad batch alarms everyone who ever took that drug, while some affected patients are never
        reached. LOTUS records which lot each patient received without putting the patient on-chain, so only the
        affected people find out, and only on their own device.
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Lots registered" value={s?.lots ?? "—"} />
        <Stat label="Permits issued" value={s?.permits ?? "—"} />
        <Stat label="Private dispenses" value={s?.dispenses ?? "—"} tone="good" />
        <Stat label="Recalls" value={s?.recalls ?? "—"} tone={s?.recalls ? "bad" : "default"} />
      </div>
      <Card title="Walk the demo in order" className="mt-6">
        <ol className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {FLOW.map(([who, what, to], i) => (
            <li key={who}>
              <Link to={to} className="block h-full rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-lotus-400">
                <span className="text-xs text-lotus-400">0{i + 1}</span>
                <p className="mt-1 font-semibold text-white">{who}</p>
                <p className="text-sm text-slate-400">{what}</p>
              </Link>
            </li>
          ))}
        </ol>
      </Card>
      {!deployment && (
        <Card title="Getting started" className="mt-6">
          <pre className="mono whitespace-pre-wrap text-slate-300">{`npm install
npm run chain          # terminal 1: local blockchain
npm run deploy:local   # terminal 2
npm run demo:seed
npm run web`}</pre>
        </Card>
      )}
    </>
  );
}
