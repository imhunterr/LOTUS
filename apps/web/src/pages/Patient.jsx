import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ZeroHash, id as keccakId } from "ethers";
import {
  ackSignalHash, commitmentAt, counterQrPayload, externalNullifierForAck, externalNullifierForReport, matchRecalls,
  recoverSecret, reportSignalHash, splitSecret,
} from "@lotus/sdk";
import { RELAYER_URL, contract, errMsg, fetchDispensed, fetchLots, fetchRecalls, short, signerFor } from "../lib/chain";
import { buildMembershipProof } from "../lib/prover";
import {
  createWallet, demoGuardianShares, hasWallet, importDemoWallet, isUnlocked, lockWallet, loseDevice, restoreWallet,
  saveWallet, unlockWallet,
} from "../lib/patientStore";
import { LANGS, t } from "../lib/i18n";
import { CLASS_LABEL, Card, Field, PageHeader, TxButton, useAsync } from "../components/ui";
import QrScanner from "../components/QrScanner";

const RELAYER_ACCOUNT = 9; // local fallback when the relayer is offline

async function relayOrDirect(path, body, direct) {
  let res;
  try {
    res = await fetch(`${RELAYER_URL}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    await direct();
    return "Relayer offline. Submitted directly.";
  }
  const j = await res.json();
  if (!j.ok) throw new Error(j.error);
  return "Submitted gas-free through the relayer";
}

export default function Patient() {
  const [wallet, setWallet] = useState(null);
  const [stage, setStage] = useState(() => (hasWallet() ? "locked" : "new"));

  // Functional updates: several effects may update the wallet in the same render.
  const update = useCallback((change) => {
    setWallet((prev) => {
      const next = typeof change === "function" ? change(prev) : change;
      saveWallet(next).catch(() => {});
      return next;
    });
  }, []);

  if (wallet && isUnlocked()) {
    return (
      <PatientHome
        wallet={wallet}
        update={update}
        lock={() => { lockWallet(); setWallet(null); setStage("locked"); }}
        lose={() => { loseDevice(wallet); setWallet(null); setStage("new"); }}
      />
    );
  }
  return <Gate stage={stage} onOpen={(w) => setWallet(w)} />;
}

/** Create, unlock, or recover a wallet. */
function Gate({ stage, onOpen }) {
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState(stage === "locked" ? "unlock" : "create");
  const [shares, setShares] = useState(["", ""]);
  const [error, setError] = useState(null);
  const vault = demoGuardianShares();

  const run = (fn) => async () => {
    setError(null);
    try { onOpen(await fn()); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <>
      <PageHeader eyebrow="Patient app" title="Your private recall inbox">
        Your secret is created on this phone and stored encrypted under your PIN. Nothing about you goes on the
        blockchain, only numbers that only this phone can recognise.
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={mode === "unlock" ? "Unlock" : mode === "recover" ? "Recover with Guardians" : "Set up LOTUS"}>
          <div className="space-y-4">
            <Field label="PIN (4–8 digits)">
              <input className="input max-w-xs tracking-[0.4em]" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
            {mode === "unlock" && (
              <button className="btn" onClick={run(() => unlockWallet(pin))}>Unlock</button>
            )}
            {mode === "create" && (
              <div className="flex flex-wrap gap-3">
                <button className="btn" onClick={run(() => createWallet(pin))}>Create my wallet</button>
                <button className="btn-ghost" onClick={run(() => importDemoWallet(pin))}>Load seeded demo patient</button>
              </div>
            )}
            {mode === "recover" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">Scan any two Guardian codes (for example from your pharmacy and your doctor).</p>
                {shares.map((s, i) => (
                  <div key={i} className="rounded-xl border border-ink-700 p-3">
                    <p className="label">Guardian share {i + 1} {s && <span className="text-emerald-400">✓</span>}</p>
                    <QrScanner label="Scan share" onResult={(text) => setShares(shares.map((x, j) => (j === i ? parseShare(text) : x)))} />
                  </div>
                ))}
                {vault && (
                  <button className="btn-ghost" onClick={() => setShares(vault)}>Demo: ask pharmacy and doctor for their shares</button>
                )}
                <button className="btn" disabled={shares.some((s) => !s)} onClick={run(async () => restoreWallet(pin, await recoverSecret(shares)))}>
                  Recover my wallet
                </button>
              </div>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        </Card>
        <Card title="Other options">
          <div className="flex flex-wrap gap-3">
            {mode !== "unlock" && hasWallet() && <button className="btn-ghost" onClick={() => setMode("unlock")}>Unlock existing wallet</button>}
            {mode !== "create" && <button className="btn-ghost" onClick={() => setMode("create")}>New wallet</button>}
            {mode !== "recover" && <button className="btn-ghost" onClick={() => setMode("recover")}>Lost my phone: recover</button>}
          </div>
        </Card>
      </div>
    </>
  );
}

const parseShare = (text) => {
  try {
    const j = JSON.parse(text);
    return j.lotusShare ?? text;
  } catch {
    return text;
  }
};

function PatientHome({ wallet, update, lock, lose }) {
  const lang = wallet.language || "en";
  const scan = useAsync(async () => {
    const [dispensed, recalls, lots] = await Promise.all([fetchDispensed(), fetchRecalls(), fetchLots()]);
    const result = matchRecalls(wallet.secret, dispensed, new Set(recalls.map((r) => r.lotKey)));
    return { ...result, recalls, lots };
  }, [wallet.secret]);

  // Re-check every 30 s while the app is open.
  useEffect(() => {
    const id = setInterval(scan.reload, 30_000);
    return () => clearInterval(id);
  }, [scan.reload]);

  const affected = scan.data?.affected || [];
  const lotOf = (k) => scan.data?.lots.find((l) => l.lotKey === k);

  // Fire one system notification per newly affected lot.
  useEffect(() => {
    const fresh = affected.filter((a) => !wallet.notified?.includes(a.lotKey));
    if (!fresh.length) return;
    if ("Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.ready
        .then((reg) => reg.showNotification("LOTUS recall alert", { body: t("affectedBody", lang), tag: "lotus-recall" }))
        .catch(() => new Notification("LOTUS recall alert", { body: t("affectedBody", lang) }));
    }
    update((w) => ({ ...w, notified: [...(w.notified || []), ...fresh.map((a) => a.lotKey)] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affected.length]);

  return (
    <>
      <PageHeader eyebrow="Patient app" title="Your private recall inbox">
        Matching happens here, on your phone. No server learns which medicines you take.
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={lang} onChange={(e) => update((w) => ({ ...w, language: e.target.value }))}>
          {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-ghost" onClick={scan.reload}>{scan.loading ? "Checking…" : "Check now"}</button>
        {"Notification" in window && Notification.permission === "default" && (
          <button className="btn-ghost" onClick={() => Notification.requestPermission()}>Allow alerts</button>
        )}
        <button className="btn-ghost" onClick={lock}>Lock</button>
        <button className="btn-ghost text-rose-300" onClick={lose}>Simulate lost phone</button>
      </div>

      {scan.data && (
        affected.length ? (
          <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6" role="alert">
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
            <p className="mt-1 text-sm text-emerald-100/70">{scan.data.myDispenses.length} dispense(s) found for you on-chain · checked {new Date().toLocaleTimeString()}</p>
          </div>
        )
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Prescriptions wallet={wallet} update={update} myDispenses={scan.data?.myDispenses || []} />
        <Card title="My dispenses" subtitle="Found by recomputing commitments on this phone">
          <ul className="space-y-2 text-sm">
            {(scan.data?.myDispenses || []).map((d) => {
              const recalled = scan.data.recalls.some((r) => r.lotKey === d.lotKey);
              return (
                <li key={d.lotKey + d.leafIndex} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850 px-3 py-2">
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

/**
 * Prescriptions + the counter QR. Each code reserves its own commitment index the moment it is
 * shown, so showing codes at two pharmacies before syncing can never produce a duplicate.
 */
function Prescriptions({ wallet, update, myDispenses }) {
  const [sel, setSel] = useState(0);
  const [adding, setAdding] = useState(false);
  const permits = wallet.permits || [];
  const permit = permits[sel];
  const used = useMemo(() => new Set(myDispenses.map((d) => d.index)), [myDispenses]);

  // Give the selected permit a fresh index if it has none, or if its code was already used at a counter.
  useEffect(() => {
    if (!permit) return;
    if (permit.codeIndex === undefined || used.has(permit.codeIndex)) rotate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, permit?.permitId, used.size]);

  function rotate() {
    update((w) => {
      const index = Math.max(w.nextIndex || 0, ...myDispenses.map((d) => d.index + 1));
      return { ...w, permits: w.permits.map((p, i) => (i === sel ? { ...p, codeIndex: index } : p)), nextIndex: index + 1 };
    });
  }

  const addPermit = (text) => {
    try {
      const p = JSON.parse(text);
      if (p.permitId === undefined || !p.permitSecret) throw new Error();
      if (permits.some((x) => String(x.permitId) === String(p.permitId))) return setAdding(false);
      update((w) => ({ ...w, permits: [...(w.permits || []), { permitId: p.permitId, permitSecret: p.permitSecret, ndc: p.ndc, qty: p.qty }] }));
      setSel(permits.length);
      setAdding(false);
    } catch {
      alert("That code isn't a LOTUS prescription.");
    }
  };

  const qr = permit && permit.codeIndex !== undefined
    ? counterQrPayload({ secret: wallet.secret, index: permit.codeIndex, permitId: permit.permitId, permitSecret: permit.permitSecret })
    : null;

  return (
    <Card title="Show at the pharmacy" subtitle="Carries your prescription and a one-time code. Your secret never leaves the phone.">
      {permits.length > 0 && (
        <>
          <select className="input mb-4" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
            {permits.map((p, i) => <option key={i} value={i}>Prescription #{p.permitId}{p.ndc ? ` · ${p.qty} × ${p.ndc}` : ""}</option>)}
          </select>
          {qr && (
            <>
              <div className="inline-block rounded-xl bg-white p-3"><QRCodeSVG value={qr} size={184} /></div>
              <p className="mt-2 text-xs text-slate-500">One-time code #{permit.codeIndex} · {short(commitmentAt(wallet.secret, permit.codeIndex).toString())}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={rotate}>New code</button>
                <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(qr).catch(() => {})} data-qr={qr}>Copy code</button>
              </div>
            </>
          )}
        </>
      )}
      <div className="mt-4">
        {adding ? (
          <QrScanner label="Scan prescription" onResult={addPermit} />
        ) : (
          <button className={permits.length ? "btn-ghost" : "btn"} onClick={() => setAdding(true)}>+ Add prescription from doctor</button>
        )}
      </div>
    </Card>
  );
}

function Guardians({ wallet, update }) {
  const [show, setShow] = useState(null);
  const names = wallet.guardianNames || ["This phone", "Pharmacy of record", "Prescriber"];
  return (
    <Card title="Guardians (2-of-3 recovery)" subtitle="Your secret is split into 3 shares. Any 2 rebuild it, and one alone reveals nothing.">
      {!wallet.guardianShares ? (
        <TxButton onRun={async () => { const shares = await splitSecret(wallet.secret); update((w) => ({ ...w, guardianShares: shares })); return "Shares created. Hand each one to its guardian."; }}>
          Create guardian shares
        </TxButton>
      ) : (
        <ul className="space-y-2">
          {wallet.guardianShares.map((s, i) => (
            <li key={i} className="rounded-lg bg-ink-850 p-3">
              <div className="flex items-center justify-between gap-2">
                {i === 2 ? (
                  <select className="input w-auto py-1 text-xs" value={names[2]} onChange={(e) => update((w) => ({ ...w, guardianNames: [names[0], names[1], e.target.value] }))}>
                    <option>Prescriber</option>
                    <option>Family member</option>
                  </select>
                ) : <span className="text-sm text-slate-300">{names[i]}</span>}
                {i > 0 && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setShow(show === i ? null : i)}>{show === i ? "Hide" : "Hand over"}</button>}
              </div>
              {show === i && (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <div className="rounded-lg bg-white p-2"><QRCodeSVG value={JSON.stringify({ lotusShare: s, guardian: names[i] })} size={140} /></div>
                  <p className="text-xs text-slate-500">The guardian scans this and keeps it. They can't read anything from it alone.</p>
                </div>
              )}
              <p className="mono mt-1 text-slate-500">{short(s)}</p>
            </li>
          ))}
        </ul>
      )}
      {names[2] === "Family member" && <p className="mt-3 text-xs text-emerald-300">Good choice: your pharmacy and doctor now can't rebuild your secret together.</p>}
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
            const s = contract("signals", await signerFor(RELAYER_ACCOUNT));
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
          <Field label="What happened (kept off-chain, only its hash goes on-chain)">
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
              const s = contract("signals", await signerFor(RELAYER_ACCOUNT));
              await (await s.reportAdverseEvent(body.lotKey, body.root, body.nullifierHash, severity, reportCid, body.proof)).wait();
            });
          }}>Submit report</TxButton>
        </div>
      )}
    </Card>
  );
}
