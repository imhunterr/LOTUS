import { useState } from "react";
import { id } from "ethers";
import { asRole } from "../lib/chain";
import { Field, TxButton } from "./ui";
import LotSelect from "./LotSelect";

export default function ShipForm({ lots, accountIndex, recipients, onDone }) {
  const [lotKey, setLotKey] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(100);
  const [manifest, setManifest] = useState("");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Lot"><LotSelect lots={lots} value={lotKey} onChange={setLotKey} /></Field>
      <Field label="Recipient">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Select…</option>
          {recipients.map((r) => <option key={r.address} value={r.address}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Quantity (units)"><input className="input" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field label="Shipping manifest (IPFS CID, optional)"><input className="input" value={manifest} onChange={(e) => setManifest(e.target.value)} placeholder="bafy…" /></Field>
      <div className="md:col-span-2">
        <TxButton disabled={!lotKey || !to} onRun={async () => {
          const c = await asRole("custody", accountIndex);
          await (await c.ship(lotKey, to, qty, manifest ? id(manifest) : id("none"))).wait();
          onDone?.();
          return `Shipped ${qty} units — waiting for the recipient to accept`;
        }}>Ship</TxButton>
      </div>
    </div>
  );
}
