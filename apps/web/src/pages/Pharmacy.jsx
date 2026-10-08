import { useState } from "react";
import { ZeroHash } from "ethers";
import { DEMO_ACCOUNTS, addressOf, asRole, contract, fetchLots, fetchShipments } from "../lib/chain";
import { PHARMACIES } from "../lib/useActors";
import { Card, ErrorNote, Field, PageHeader, TxButton, useAsync } from "../components/ui";
import LotSelect from "../components/LotSelect";
import ShipmentInbox from "../components/ShipmentInbox";
import QrScanner from "../components/QrScanner";

export default function Pharmacy() {
  const [who, setWho] = useState("pharmacyA");
  const acc = DEMO_ACCOUNTS[who];
  const data = useAsync(async () => {
    const me = await addressOf(acc);
    const lots = await fetchLots();
    const custody = contract("custody");
    const books = await Promise.all(lots.map(async (l) => ({ ...l, book: await custody.bookOf(me, l.lotKey) })));
    return { me, lots, shipments: await fetchShipments(), books: books.filter((b) => b.book.inbound > 0n) };
  }, [acc]);
  const [lotKey, setLotKey] = useState("");
  const [qr, setQr] = useState("");
  const [qty, setQty] = useState(30);

  return (
    <>
      <PageHeader eyebrow="Step 4 · Pharmacy" title="Dispense with a split record">
        Scan the patient's QR. It carries the permit and a one-time commitment, but never the patient's secret. The chain
        records the lot publicly and the patient only as an opaque number. It refuses any lot you never received
        and any quantity beyond what you hold (Dispense Closure).
      </PageHeader>
      <div className="mb-6 flex flex-wrap gap-2">
        {PHARMACIES.map((p) => (
          <button key={p.key} onClick={() => setWho(p.key)} className={who === p.key ? "btn" : "btn-ghost"}>{p.label}</button>
        ))}
      </div>
      <ErrorNote error={data.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Dispense at the counter">
          <div className="space-y-4">
            <div>
              <span className="label">Patient code</span>
              {qr ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                  <span className="text-emerald-200">Prescription #{JSON.parse(qr).permitId} scanned</span>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setQr("")}>Clear</button>
                </div>
              ) : <QrScanner label="Scan patient's code" onResult={(t) => { try { const p = JSON.parse(t); if (p.commitment && p.permitSecret) return setQr(t); } catch {} alert("That isn't a LOTUS patient code."); }} />}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Lot taken from the shelf"><LotSelect lots={(data.data?.books || [])} value={lotKey} onChange={setLotKey} /></Field>
              <Field label="Quantity"><input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            </div>
            <TxButton disabled={!qr || !lotKey} onRun={async () => {
              const p = JSON.parse(qr);
              const d = await asRole("dispenses", acc);
              await (await d.dispense({ lotKey, permitId: p.permitId, permitSecret: p.permitSecret, qty, commitment: p.commitment, shipmentRef: ZeroHash })).wait();
              data.reload();
              setQr("");
              return "Dispensed. Patient is now provably linked to this lot, privately.";
            }}>Dispense</TxButton>
          </div>
        </Card>
        <Card title="Closure book" subtitle="dispensed + returned + shrinkage can never exceed inbound">
          <div className="space-y-4">
            {(data.data?.books || []).map(({ lotNumber, ndc, book }) => {
              const used = Number(book.dispensed + book.returned + book.shrinkage);
              const pct = Number(book.inbound) ? (used / Number(book.inbound)) * 100 : 0;
              return (
                <div key={lotNumber}>
                  <div className="flex justify-between text-sm"><span>{ndc} · {lotNumber}</span><span className="tabular-nums text-slate-400">{used} / {Number(book.inbound)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-ink-700"><div className="h-2 rounded-full bg-lotus-500" style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1 text-xs text-slate-500">dispensed {Number(book.dispensed)} · returned {Number(book.returned)} · shrinkage {Number(book.shrinkage)}</p>
                </div>
              );
            })}
            {!data.data?.books?.length && <p className="text-sm text-slate-500">No stock received yet.</p>}
          </div>
        </Card>
      </div>
      <Card title="Incoming shipments" className="mt-6">
        {data.data && <ShipmentInbox {...data.data} accountIndex={acc} onChange={data.reload} />}
      </Card>
    </>
  );
}
