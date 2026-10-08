import { asRole, short } from "../lib/chain";
import { TxButton } from "./ui";

/** Incoming shipments for one actor. Units only count once the recipient accepts (two-sided custody). */
export default function ShipmentInbox({ shipments, lots, me, accountIndex, onChange }) {
  const lotName = (k) => lots.find((l) => l.lotKey === k)?.lotNumber ?? short(k);
  const mine = shipments.filter((s) => s.to.toLowerCase() === me?.toLowerCase());
  if (!mine.length) return <p className="text-sm text-slate-500">No shipments addressed to you yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
          <tr><th className="py-2">#</th><th>Lot</th><th>From</th><th>Qty</th><th>Status</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-ink-700">
          {mine.map((s) => (
            <tr key={s.id}>
              <td className="py-2 text-slate-500">{s.id}</td>
              <td>{lotName(s.lotKey)}</td>
              <td className="mono">{short(s.from)}</td>
              <td className="tabular-nums">{s.qty}</td>
              <td>
                <span className={`pill ${s.status === "Accepted" ? "bg-emerald-500/15 text-emerald-300" : s.status === "Pending" ? "bg-amber-500/15 text-amber-300" : "bg-ink-700 text-slate-400"}`}>{s.status}</span>
              </td>
              <td className="py-2 text-right">
                {s.status === "Pending" && (
                  <div className="flex justify-end gap-2">
                    <TxButton className="btn px-3 py-1" onRun={async () => { await (await (await asRole("custody", accountIndex)).accept(s.id)).wait(); onChange(); return "Accepted"; }}>Accept</TxButton>
                    <TxButton className="btn-ghost px-3 py-1" onRun={async () => { await (await (await asRole("custody", accountIndex)).reject(s.id)).wait(); onChange(); return "Rejected"; }}>Reject</TxButton>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
