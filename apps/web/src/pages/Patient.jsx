import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ZeroHash, id as keccakId } from "ethers";
import {
  ackSignalHash, counterQrPayload, externalNullifierForAck, externalNullifierForReport, matchRecalls,
  recoverSecret, reportSignalHash, splitSecret,
} from "@lotus/sdk";
import { RELAYER_URL, contract, fetchDispensed, fetchLots, fetchRecalls, short, errMsg } from "../lib/chain";
import { buildMembershipProof } from "../lib/prover";
import { clearWallet, createWallet, importDemoWallet, loadWallet, saveWallet } from "../lib/patientStore";
import { LANGS, t } from "../lib/i18n";
import { CLASS_LABEL, Card, Field, PageHeader, TxButton, useAsync } from "../components/ui";

async function relayOrDirect(path, body, direct) {
  try {
    const r = await fetch(`${RELAYER_URL}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return "Submitted gas-free through the relayer";
  } catch (e) {
    if (String(e.message).includes("Signals:")) throw e;
    await direct();
    return "Relayer offline. Submitted directly.";
  }
}

export default function Patient() {
  const [wallet, setWallet] = useState(loadWallet);
  const update = (w) => setWallet(saveWallet(w));

  if (!wallet) {
    return (
      <>
        <PageHeader eyebrow="Patient app" title="Your private recall inbox">
          Your secret is created and kept on this device. Nothing about you goes on the blockchain, only numbers that only
          your phone can recognise.
        </PageHeader>
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={() => setWallet(createWallet())}>Create my LOTUS wallet</button>
          <button className="btn-ghost" onClick={() => { const w = importDemoWallet(); if (w) setWallet(w); else alert("Run npm run demo:seed first."); }}>Load seeded demo patient</button>
        </div>
      </>
    );
  }
  return <PatientHome wallet={wallet} update={update} reset={() => { clearWallet(); setWallet(null); }} />;
}

function PatientHome({ wallet, update, reset }) {
  const lang = wallet.language || "en";
  const scan = useAsync(async () => {
    const [dispensed, recalls, lots] = await Promise.all([fetchDispensed(), fetchRecalls(), fetchLots()]);
    const recalledKeys = new Set(recalls.map((r) => r.lotKey));
    const result = matchRecalls(wallet.secret, dispensed, recalledKeys);
    return { ...result, recalls, lots };
  }, [wallet.secret]);

  const nextIndex = Math.max(wallet.nextIndex || 0, scan.data?.nextIndex || 0);
  const [permitIdx, setPermitIdx] = useState(0);
  const permit = wallet.permits?.[permitIdx];
  const qr = useMemo(
    () => permit && counterQrPayload({ secret: wallet.secret, index: nextIndex, permitId: permit.permitId, permitSecret: permit.permitSecret }),
    [permit, nextIndex, wallet.secret]
  );
  const lotOf = (k) => scan.data?.lots.find((l) => l.lotKey === k);
  const affected = scan.data?.affected || [];

  return (
    <>
      <PageHeader eyebrow="Patient app" title="Your private recall inbox">
        Matching happens here, on your device. No server learns which medicines you take.
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={lang} onChange={(e) => update({ ...wallet, language: e.target.value })}>
          {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-ghost" onClick={scan.reload}>Check for recalls</button>
        <button className="btn-ghost text-rose-300" onClick={reset}>Simulate lost phone</button>
      </div>

      {scan.data && (
        affected.length ? (
          <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6">
            <p className="text-xl font-bold text-rose-200">⚠ {t("affectedTitle", lang)}</p>
            <p className="mt-2 text-rose-100/80">{t("affectedBody", lang)}</p>
            <ul className="mt-4 space-y-1 text-sm text-rose-100">
              {affected.map((a) => {
                const r = scan.data.recalls.find((x) => x.lotKey === a.lotKey);
                return <li key={a.leafIndex + a.lotKey}>{lotOf(a.lotKey)?.ndc} · lot <b>{lotOf(a.lotKey)?.lotNumber}</b> · {CLASS_LABEL[r?.classification]}</li>;
              })}
            </ul>
          </div>
        ) : (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
            <p className="text-lg font-semibold text-emerald-200">✓ {t("safeTitle", lang)}</p>
            <p className="mt-1 text-sm text-emerald-100/70">{scan.data.myDispenses.length} dispense(s) found for you on-chain.</p>
          </div>
        )
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Show at the pharmacy" subtitle="Contains your permit and a one-time commitment. Your secret never leaves the phone.">
          {wallet.permits?.length ? (
            <>
              <select className="input mb-4" value={permitIdx} onChange={(e) => setPermitIdx(Number(e.target.value))}>
                {wallet.permits.map((p, i) => <option key={i} value={i}>Permit #{p.permitId} · {p.qty} × {p.ndc}</option>)}
              </select>
              <div className="inline-block rounded-xl bg-white p-3"><QRCodeSVG value={qr} size={180} /></div>
              <button className="btn-ghost mt-3 w-full" onClick={() => navigator.clipboard?.writeText(qr)}>Copy payload (demo)</button>
            </>
          ) : <p className="text-sm text-slate-500">No permits yet. Ask your prescriber, or issue one from the Prescriber page.</p>}
        </Card>

        <Card title="My dispenses" subtitle="Found by recomputing commitments locally">
          <ul className="space-y-2 text-sm">
            {(scan.data?.myDispenses || []).map((d) => {
              const recalled = scan.data.recalls.some((r) => r.lotKey === d.lotKey);
              return (
                <li key={d.lotKey + d.leafIndex} className="flex items-center justify-between rounded-lg bg-ink-850 px-3 py-2">
                  <span>{lotOf(d.lotKey)?.ndc} · {lotOf(d.lotKey)?.lotNumber} · {d.qty} units</span>
                  {recalled ? <span className="pill bg-rose-500/20 text-rose-300">Recalled</span> : <span className="pill bg-emerald-500/15 text-emerald-300">OK</span>}
                </li>
              );
            })}
            {!scan.data?.myDispenses?.length && <li className="text-slate-500">Nothing yet.</li>}
          </ul>
        </Card>

        <Guardians wallet={wallet} update={update} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <AcknowledgeRecall wallet={wallet} affected={affected} recalls={scan.data?.recalls || []} lotOf={lotOf} />
        <ReportSideEffect wallet={wallet} mine={scan.data?.myDispenses || []} lotOf={lotOf} />
      </div>
    </>
  );
}

function Guardians({ wallet, update }) {
  const [shares, setShares] = useState(["", ""]);
  return (
    <Card title="Guardians (2-of-3 recovery)" subtitle="Your secret is split into 3 shares. Any 2 rebuild it, and one alone reveals nothing.">
      {wallet.guardianShares ? (
        <ul className="space-y-2 text-xs">
          {["This device", "Pharmacy of record", "Prescriber, or a family member you choose"].map((who, i) => (
            <li key={who} className="rounded-lg bg-ink-850 p-2"><p className="text-slate-400">{who}</p><p className="mono text-slate-300">{short(wallet.guardianShares[i])}</p></li>
          ))}
        </ul>
      ) : (
        <TxButton onRun={async () => { update({ ...wallet, guardianShares: await splitSecret(wallet.secret) }); return "Shares created. Hand them to your guardians."; }}>Create guardian shares</TxButton>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-slate-400">Recover from two shares</summary>
        <div className="mt-3 space-y-2">
          {shares.map((s, i) => <input key={i} className="input mono" placeholder={`Share ${i + 1}`} value={s} onChange={(e) => setShares(shares.map((x, j) => (j === i ? e.target.value : x)))} />)}
          <TxButton onRun={async () => {
            const secret = (await recoverSecret(shares.map((s) => s.trim()))).toString();
            update({ ...wallet, secret, nextIndex: 0 });
            return "Recovered. Your full history is back, since every nonce is derived from the secret.";
          }}>Recover</TxButton>
        </div>
      </details>
    </Card>
  );
}

const ACTIONS = [[1, "I've stopped using it"], [2, "I returned it to the pharmacy"], [3, "I spoke to my doctor"]];

function AcknowledgeRecall({ wallet, affected, recalls, lotOf }) {
  const [action, setAction] = useState(1);
  if (!affected.length) return <Card title="Acknowledge a recall" subtitle="Appears when one of your lots is recalled." />;
  const target = affected[0];
  const recall = recalls.find((r) => r.lotKey === target.lotKey);
  return (
    <Card title="Acknowledge the recall, anonymously" subtitle="Helps the regulator measure how many affected patients got the message, without learning who you are.">
      <Field label={`Lot ${lotOf(target.lotKey)?.lotNumber}`}>
        <select className="input" value={action} onChange={(e) => setAction(Number(e.target.value))}>
          {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <div className="mt-4">
        <TxButton onRun={async () => {
          const zk = await buildMembershipProof({
            secret: wallet.secret, index: target.index, lotKey: target.lotKey, leafIndex: target.leafIndex,
            externalNullifier: externalNullifierForAck(recall.recallId), signalHash: ackSignalHash(action),
          });
          const body = { recallId: recall.recallId, root: zk.root, nullifierHash: zk.nullifierHash, action, proof: zk.proof };
          return relayOrDirect("ack", body, async () => {
            const { signerFor } = await import("../lib/chain");
            const s = contract("signals", await signerFor(9));
            await (await s.acknowledgeRecall(body.recallId, body.root, body.nullifierHash, action, body.proof)).wait();
          });
        }}>Send anonymous acknowledgement</TxButton>
      </div>
    </Card>
  );
}

function ReportSideEffect({ wallet, mine, lotOf }) {
  const [sel, setSel] = useState(0);
  const [severity, setSeverity] = useState(3);
  const [text, setText] = useState("");
  const target = mine[sel];
  return (
    <Card title="Report a side effect, anonymously" subtitle="A zero-knowledge proof shows you really received this lot. Reports can't be faked or spammed, and enough of them alert the regulator early.">
      {!mine.length ? <p className="text-sm text-slate-500">You need at least one dispense first.</p> : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Medicine">
              <select className="input" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                {mine.map((d, i) => <option key={i} value={i}>{lotOf(d.lotKey)?.ndc} · lot {lotOf(d.lotKey)?.lotNumber}</option>)}
              </select>
            </Field>
            <Field label={`Severity: ${severity} / 5`}><input type="range" min="1" max="5" value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full accent-pink-500" /></Field>
          </div>
          <Field label="What happened (stored off-chain, only its hash goes on-chain)">
            <textarea className="input h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. rash and dizziness after 2 days" />
          </Field>
          <TxButton onRun={async () => {
            const reportCid = text ? keccakId(text) : ZeroHash;
            const zk = await buildMembershipProof({
              secret: wallet.secret, index: target.index, lotKey: target.lotKey, leafIndex: target.leafIndex,
              externalNullifier: externalNullifierForReport(target.lotKey), signalHash: reportSignalHash(severity, reportCid),
            });
            const body = { lotKey: target.lotKey, root: zk.root, nullifierHash: zk.nullifierHash, severity, reportCid, proof: zk.proof };
            return relayOrDirect("report", body, async () => {
              const { signerFor } = await import("../lib/chain");
              const s = contract("signals", await signerFor(9));
              await (await s.reportAdverseEvent(body.lotKey, body.root, body.nullifierHash, severity, reportCid, body.proof)).wait();
            }).catch((e) => { throw new Error(errMsg(e)); });
          }}>Submit report</TxButton>
        </div>
      )}
    </Card>
  );
}
