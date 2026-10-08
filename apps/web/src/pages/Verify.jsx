import { useState } from "react";
import { contract, fetchShipments, fmtDate, short } from "../lib/chain";
import { CLASS_LABEL, Card, ErrorNote, Field, PageHeader } from "../components/ui";

/**
 * Public QR verification page (feature E). Anyone can scan a pack and check that the lot is genuine,
 * see its custody path, and see whether it is expired or recalled. No login.
 */
export default function Verify() {
  const params = new URLSearchParams(location.search);
  const [ndc, setNdc] = useState(params.get("ndc") || "0002-1433-80");
  const [lot, setLot] = useState(params.get("lot") || "D298765");
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);

  const check = async () => {
    setError(null);
    try {
      const b = contract("batches");
      const key = await b.lotKeyOf(ndc, lot);
      if (!(await b.exists(key))) return setRes({ genuine: false });
      const info = await b.getLot(key);
      const r = contract("recalls");
      const recalled = await r.isRecalled(key);
      const recallInfo = recalled ? await r.getRecall(await r.recallIdOf(key)) : null;
      const path = (await fetchShipments()).filter((s) => s.lotKey === key);
      const seen = JSON.parse(localStorage.getItem("lotus.scans") || "{}");
      seen[key] = (seen[key] || 0) + 1;
      try { localStorage.setItem("lotus.scans", JSON.stringify(seen)); } catch {}
      setRes({
        genuine: true, key, info, recalled, recallInfo, path,
        expired: Number(info.expiry) * 1000 < Date.now(),
        dispensed: Number(await contract("dispenses").unitsByLot(key)),
      });
    } catch (e) { setError(e); }
  };

  return (
    <>
      <PageHeader eyebrow="Public · no login" title="Is this medicine genuine and safe?">
        Scan the code on the pack or type the drug code and lot number. Anyone can check, at any time.
      </PageHeader>
      <Card>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="Drug code (NDC)"><input className="input" value={ndc} onChange={(e) => setNdc(e.target.value)} /></Field>
          <Field label="Lot number"><input className="input" value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
          <button className="btn h-10" onClick={check}>Verify</button>
        </div>
      </Card>
      <div className="mt-6"><ErrorNote error={error} /></div>
      {res && !res.genuine && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">
          <p className="text-xl font-bold">✕ Not found on the ledger</p>
          <p className="mt-1 text-sm">No manufacturer ever registered this lot. It may be counterfeit. Do not use it and report it to your pharmacist.</p>
        </div>
      )}
      {res?.genuine && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className={`rounded-2xl border p-6 xl:col-span-3 ${res.recalled ? "border-rose-500/40 bg-rose-500/10" : res.expired ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
            <p className="text-xl font-bold text-white">
              {res.recalled ? `⚠ Recalled · ${CLASS_LABEL[Number(res.recallInfo.classification)]}` : res.expired ? "⚠ Expired" : "✓ Genuine. Not recalled, not expired"}
            </p>
            <p className="mt-1 text-sm text-slate-300">{res.info.ndc} · lot {res.info.lotNumber} · expires {fmtDate(res.info.expiry)} · {Number(res.info.units)} units made · {res.dispensed} dispensed</p>
          </div>
          <Card title="Chain of custody" className="xl:col-span-2">
            <ol className="relative space-y-4 border-l border-ink-600 pl-6">
              <li><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-lotus-500" /><p className="text-sm text-white">Registered by manufacturer</p><p className="mono text-slate-500">{short(res.info.manufacturer)}</p></li>
              {res.path.map((s) => (
                <li key={s.id}>
                  <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${s.status === "Accepted" ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <p className="text-sm text-white">{s.qty} units → {short(s.to)} <span className="text-slate-500">({s.status})</span></p>
                  <p className="text-xs text-slate-500">{fmtDate(s.createdAt)}</p>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Certificate of analysis">
            <p className="mono text-slate-400">{res.info.coaHash}</p>
            <p className="mt-2 text-xs text-slate-500">Hash of the lab report stored on IPFS. If the document's hash matches, it hasn't been altered.</p>
          </Card>
        </div>
      )}
    </>
  );
}
