import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { newPermit } from "@lotus/sdk";
import { DEMO_ACCOUNTS, asRole } from "../lib/chain";
import { Card, Field, PageHeader, TxButton } from "../components/ui";

export default function Prescriber() {
  const [ndc, setNdc] = useState("0002-1433-80");
  const [qty, setQty] = useState(30);
  const [days, setDays] = useState(30);
  const [issued, setIssued] = useState(null);

  return (
    <>
      <PageHeader eyebrow="Step 3 · Prescriber" title="Issue an e-prescription permit">
        A prescription becomes a single-use permit with a quantity balance. It holds no patient name or key, only the
        hash of a fresh one-time secret that the patient carries, so two prescriptions can't be linked to the same person.
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="New permit">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Drug (NDC)"><input className="input" value={ndc} onChange={(e) => setNdc(e.target.value)} /></Field>
            <Field label="Quantity"><input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Valid for (days)"><input className="input" type="number" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          </div>
          <div className="mt-4">
            <TxButton onRun={async () => {
              const { permitSecret, holderCommit } = newPermit();
              const rx = await asRole("prescriptions", DEMO_ACCOUNTS.prescriber);
              const permitId = Number(await rx.permitCount());
              await (await rx.issue(holderCommit, ndc, qty, Math.floor(Date.now() / 1000) + days * 86400)).wait();
              setIssued({ permitId, qty, ndc, code: JSON.stringify({ permitId, permitSecret, ndc, qty: Number(qty) }) });
              return `Permit #${permitId} issued`;
            }}>Issue permit</TxButton>
          </div>
        </Card>
        <Card title="Hand to patient" subtitle="The patient scans this into their LOTUS app. It's the only copy of the permit secret.">
          {issued ? (
            <div className="flex flex-wrap items-center gap-6">
              <div className="rounded-xl bg-white p-3"><QRCodeSVG value={issued.code} size={168} /></div>
              <div className="space-y-3 text-sm">
                <p>Permit <b className="text-white">#{issued.permitId}</b> · {issued.qty} × {issued.ndc}</p>
                <p className="text-slate-400">Patient app → "Add prescription from doctor" → scan.</p>
                <button className="btn-ghost" data-code={issued.code} onClick={() => navigator.clipboard?.writeText(issued.code).catch(() => {})}>Copy code (desktop demo)</button>
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">Issue a permit to see its QR code.</p>}
        </Card>
      </div>
    </>
  );
}
