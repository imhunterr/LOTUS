import { useState } from "react";
import { id } from "ethers";
import { DEMO_ACCOUNTS, asRole, fetchLots, fmtDate } from "../lib/chain";
import { useActors } from "../lib/useActors";
import { Card, ErrorNote, Field, PageHeader, TxButton, useAsync } from "../components/ui";
import ShipForm from "../components/ShipForm";

const ACC = DEMO_ACCOUNTS.manufacturer;

export default function Manufacturer() {
  const lots = useAsync(fetchLots);
  const actors = useActors();
  const [f, setF] = useState({ ndc: "0002-1433-80", lot: "", expiryDays: 365, units: 500, coa: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader eyebrow="Step 1 · Manufacturer" title="Register a lot">
        Every batch gets an on-chain identity (drug code + lot number). Registering it puts all its units into your custody,
        which is where the chain of custody begins.
      </PageHeader>
      <ErrorNote error={lots.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="New lot">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="NDC (drug code)"><input className="input" value={f.ndc} onChange={set("ndc")} /></Field>
            <Field label="Lot number"><input className="input" value={f.lot} onChange={set("lot")} placeholder="D298767" /></Field>
            <Field label="Expires in (days)"><input className="input" type="number" value={f.expiryDays} onChange={set("expiryDays")} /></Field>
            <Field label="Units"><input className="input" type="number" value={f.units} onChange={set("units")} /></Field>
            <div className="md:col-span-2"><Field label="Certificate of analysis (IPFS CID)"><input className="input" value={f.coa} onChange={set("coa")} placeholder="bafy…" /></Field></div>
          </div>
          <div className="mt-4">
            <TxButton disabled={!f.lot} onRun={async () => {
              const c = await asRole("batches", ACC);
              const expiry = Math.floor(Date.now() / 1000) + Number(f.expiryDays) * 86400;
              await (await c.registerLot(f.ndc, f.lot, expiry, id(f.coa || "none"), f.units)).wait();
              lots.reload();
              return `Lot ${f.lot} registered`;
            }}>Register lot</TxButton>
          </div>
        </Card>
        <Card title="Ship to a distributor">
          {actors.data && lots.data && (
            <ShipForm lots={lots.data} accountIndex={ACC} recipients={[{ address: actors.data.distributor, label: "MedSupply Distributor" }]} />
          )}
        </Card>
      </div>
      <Card title="Registered lots" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="py-2">NDC</th><th>Lot</th><th>Units</th><th>Expiry</th></tr></thead>
            <tbody className="divide-y divide-ink-700">
              {(lots.data || []).map((l) => (
                <tr key={l.lotKey}><td className="py-2">{l.ndc}</td><td>{l.lotNumber}</td><td className="tabular-nums">{l.units}</td><td>{fmtDate(l.expiry)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
