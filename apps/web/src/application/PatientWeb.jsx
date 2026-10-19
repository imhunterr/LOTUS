import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { keccak256 } from 'ethers';
import { api, post, date } from './api';
import { Icon, Card, Empty, Badge, Field, Action, Form, Message, PageTitle, download } from './ui';
import { PublicHeader } from './Application';
import {
  hasVault,
  unlockVault,
  createVault,
  saveVault,
  lockVault,
  guardians,
  exportBackup,
  restoreBackup,
  reserveCode,
  matching,
  membership,
  encryptedReport,
  cacheFeed,
  cachedFeed,
  vaultUnlocked,
  verifyReceipt,
} from './vault';
import { LANGS, t } from '../lib/i18n';
import QrScanner from '../components/QrScanner';

const nav = [
  ['/patient', 'Home', 'home'],
  ['/patient/medicines', 'Medicines', 'box'],
  ['/patient/code', 'Counter code', 'scan'],
  ['/patient/alerts', 'Alerts', 'bell'],
  ['/patient/recovery', 'Recovery', 'shield'],
];
export default function PatientWeb() {
  const [wallet, setWallet] = useState(null),
    [exists, setExists] = useState(false),
    [feed, setFeed] = useState(null),
    [syncError, setSyncError] = useState(''),
    [loading, setLoading] = useState(false),
    [notificationPermission, setNotificationPermission] = useState(
      () => globalThis.Notification?.permission || 'unsupported'
    ),
    [gate, setGate] = useState('unlock');
  const location = useLocation();
  useEffect(() => {
    hasVault().then((v) => {
      setExists(v);
      setGate(v ? 'unlock' : 'create');
    });
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const f = await api('/public/feed');
      await cacheFeed(f);
      setFeed(f);
      setSyncError('');
    } catch (e) {
      const cached = await cachedFeed();
      if (cached) setFeed(cached);
      setSyncError('Could not complete a fresh check. Showing your last saved bulletin.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!wallet) return;
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [Boolean(wallet), refresh]);
  useEffect(() => {
    if (!wallet) return;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        lockVault();
        setWallet(null);
        setExists(true);
        setGate('unlock');
      }, 5 * 60000);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [Boolean(wallet)]);
  const update = async (next) => {
    await saveVault(next);
    if (vaultUnlocked()) setWallet(next);
  };
  const mine = wallet && feed ? matching(wallet, feed) : [],
    affected = mine.filter((r) => feed.recalls.some((c) => c.lotId === r.lotId));
  const notified = useRef(new Set());
  useEffect(() => {
    if (!wallet || notificationPermission !== 'granted' || !affected.length) return;
    const fresh = [
      ...new Set(affected.map((r) => feed.recalls.find((c) => c.lotId === r.lotId)?.id)),
    ].filter((id) => id && !notified.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => notified.current.add(id));
    const options = {
      body: 'Open your private medicine inbox to review a relevant recall.',
      tag: 'lotus-private-recall',
    };
    if (navigator.serviceWorker?.controller)
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification('LOTUS recall update', options))
        .catch(() => {});
    else new Notification('LOTUS recall update', options);
  }, [wallet, feed, notificationPermission, affected.length]);
  const view = location.pathname.split('/')[2] || 'home';
  return (
    <div className="patient-app">
      <PublicHeader />
      <main className="patient-main">
        {!wallet ? (
          <>
            <PageTitle
              eyebrow="Private patient web interface"
              title="Your medicines. Your private space."
            >
              An encrypted browser vault keeps your secret and prescription credentials on this
              device.
            </PageTitle>
            <div className="patient-gate-grid">
              <Card
                title={
                  gate === 'recover'
                    ? 'Restore your private history'
                    : gate === 'create'
                    ? 'Create a private vault'
                    : 'Welcome back'
                }
                subtitle={
                  gate === 'recover'
                    ? 'Use any two independent shares and your encrypted backup.'
                    : 'Your passphrase unlocks this browser; it is not sent to LOTUS.'
                }
              >
                <div className="segmented">
                  <button
                    className={gate === 'create' ? 'active' : ''}
                    onClick={() => setGate('create')}
                  >
                    Create
                  </button>
                  {exists && (
                    <button
                      className={gate === 'unlock' ? 'active' : ''}
                      onClick={() => setGate('unlock')}
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    className={gate === 'recover' ? 'active' : ''}
                    onClick={() => setGate('recover')}
                  >
                    Recover
                  </button>
                </div>
                <Form
                  label={
                    gate === 'recover'
                      ? 'Recover history'
                      : gate === 'create'
                      ? 'Create my vault'
                      : 'Unlock my vault'
                  }
                  onSubmit={async (v, form) => {
                    let w;
                    if (gate === 'recover') {
                      const f = form.elements.backup.files[0];
                      if (!f) throw new Error('Select the encrypted backup package.');
                      const backup = JSON.parse(await f.text());
                      const shares = [parseShare(v.share1), parseShare(v.share2)];
                      if (shares[0] === shares[1])
                        throw new Error('Use two different guardian shares.');
                      w = await restoreBackup(shares, backup, v.passphrase);
                    } else
                      w =
                        gate === 'create'
                          ? await createVault(v.passphrase)
                          : await unlockVault(v.passphrase);
                    setWallet(w);
                    setExists(true);
                    navigator.storage?.persist?.().catch(() => {});
                    return 'Private vault opened.';
                  }}
                >
                  {gate === 'recover' && (
                    <>
                      <Field label="Guardian share one">
                        <textarea name="share1" required />
                      </Field>
                      <Field label="Guardian share two">
                        <textarea name="share2" required />
                      </Field>
                      <Field label="Encrypted backup package">
                        <input name="backup" type="file" accept=".json" required />
                      </Field>
                    </>
                  )}
                  <Field
                    label={gate === 'unlock' ? 'Vault passphrase' : 'Choose a vault passphrase'}
                    hint="At least 12 characters. Use a passphrase you can remember."
                  >
                    <input
                      type="password"
                      name="passphrase"
                      minLength={gate === 'unlock' ? 1 : 12}
                      required
                      autoComplete={gate === 'unlock' ? 'current-password' : 'new-password'}
                    />
                  </Field>
                </Form>
                {exists && gate === 'create' && (
                  <p className="table-note">
                    Creating a new vault replaces this browser’s current vault. Export your
                    encrypted backup first.
                  </p>
                )}
              </Card>
              <Card className="privacy-card" title="A smaller digital footprint">
                <Icon name="shield" size={36} />
                <h3>Matching belongs to you.</h3>
                <p>
                  Your browser compares commitments locally. The server never needs your root secret
                  or a list of your medicines.
                </p>
                <ul>
                  <li>No staff account or crypto wallet</li>
                  <li>Fresh one-time code for every fill</li>
                  <li>Recovery with independent guardians</li>
                </ul>
                <p className="table-note">
                  Private recall checks run when this web app is open and unlocked. Keep
                  conventional pharmacy recall channels available.
                </p>
              </Card>
            </div>
          </>
        ) : (
          <>
            <div className="patient-toolbar">
              <div>
                <p className="eyebrow">My private inbox</p>
                <span className="sync-label">
                  <Icon name="clock" size={14} />
                  {feed
                    ? `Last complete check: ${new Date(feed.checkedAt).toLocaleString()}`
                    : 'No complete check yet'}
                </span>
              </div>
              <div>
                <select
                  aria-label="Alert language"
                  value={wallet.language}
                  onChange={(e) => update({ ...wallet, language: e.target.value })}
                >
                  {Object.entries(LANGS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="button outline small"
                  onClick={() => {
                    lockVault();
                    setWallet(null);
                    setGate('unlock');
                  }}
                >
                  Lock
                  <Icon name="shield" size={15} />
                </button>
              </div>
            </div>
            <Message error={syncError} />
            {notificationPermission === 'default' && (
              <button
                className="button subtle small"
                onClick={async () =>
                  setNotificationPermission(await Notification.requestPermission())
                }
              >
                <Icon name="bell" size={15} />
                Allow recall notifications while open
              </button>
            )}
            <nav className="patient-tabs" aria-label="Patient navigation">
              {nav.map(([url, label, icon]) => (
                <NavLink key={url} to={url} end={url === '/patient'}>
                  <Icon name={icon} />
                  <span>{label}</span>
                  {label === 'Alerts' && affected.length > 0 && (
                    <b>{new Set(affected.map((a) => a.lotId)).size}</b>
                  )}
                </NavLink>
              ))}
            </nav>
            {view === 'home' ? (
              <PatientHome
                wallet={wallet}
                mine={mine}
                affected={affected}
                feed={feed}
                error={syncError}
                loading={loading}
                refresh={refresh}
              />
            ) : view === 'medicines' ? (
              <Medicines wallet={wallet} update={update} mine={mine} feed={feed} />
            ) : view === 'code' ? (
              <CounterCode wallet={wallet} update={update} />
            ) : view === 'alerts' ? (
              <PatientAlerts
                wallet={wallet}
                update={update}
                mine={mine}
                affected={affected}
                feed={feed}
                refresh={refresh}
              />
            ) : view === 'recovery' ? (
              <Recovery wallet={wallet} update={update} />
            ) : (
              <Empty />
            )}
            <div className="patient-privacy-footer">
              <Icon name="shield" size={15} />
              Private details stay in this browser · automatic lock after 5 minutes of inactivity
            </div>
          </>
        )}
      </main>
      <nav className="patient-bottom-nav">
        {wallet &&
          nav.slice(0, 4).map(([url, label, icon]) => (
            <NavLink key={url} to={url} end={url === '/patient'}>
              <Icon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
      </nav>
    </div>
  );
}
const parseShare = (text) => {
  try {
    const value = JSON.parse(text);
    return value.share || value.lotusShare || text.trim();
  } catch {
    return text.trim();
  }
};
function PatientHome({ wallet, mine, affected, feed, error, loading, refresh }) {
  const unique = [...new Set(affected.map((r) => r.lotId))];
  return (
    <>
      <div className="patient-welcome">
        <div>
          <p className="eyebrow">CARE THAT RESPECTS YOUR PRIVACY</p>
          <h1>Your medicine inbox.</h1>
          <p>A clear record of what you received and what needs your attention.</p>
        </div>
        <span className="welcome-leaf">
          <Icon name="leaf" size={56} />
        </span>
      </div>
      {unique.length ? (
        <div className="patient-recall-card" role="alert">
          <div className="recall-symbol">
            <Icon name="bell" size={27} />
          </div>
          <div>
            <Badge tone="bad">
              {unique.length} affected {unique.length === 1 ? 'lot' : 'lots'}
            </Badge>
            <h2>{t('affectedTitle', wallet.language)}</h2>
            <p>{t('affectedBody', wallet.language)}</p>
            <Link to="/patient/alerts" className="button danger">
              Review recall details
              <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      ) : (
        <Card className="patient-status-card">
          <span className={`status-round ${error || !feed ? 'pending' : ''}`}>
            <Icon name={error || !feed ? 'clock' : 'check'} size={25} />
          </span>
          <div>
            <h2>
              {error || !feed
                ? 'A current check is still needed'
                : 'No matching recalls at the last complete check'}
            </h2>
            <p>
              {feed
                ? `${mine.length} locally matched records · ${new Date(
                    feed.checkedAt
                  ).toLocaleString()}`
                : 'Connect to the service for your first check.'}
            </p>
          </div>
          <button className="button subtle small" onClick={refresh} disabled={loading}>
            {loading ? 'Checking…' : 'Check now'}
          </button>
        </Card>
      )}
      <div className="patient-home-grid">
        <Link className="patient-task primary" to="/patient/code">
          <Icon name="scan" size={28} />
          <h3>At the pharmacy?</h3>
          <p>Show a fresh, protected counter code.</p>
          <span>
            Open counter code
            <Icon name="arrow" size={17} />
          </span>
        </Link>
        <Link className="patient-task" to="/patient/medicines">
          <Icon name="box" size={28} />
          <h3>Your medicine records</h3>
          <p>
            {wallet.permits.length} saved prescriptions · {mine.length} matched fills
          </p>
          <span>
            View medicines
            <Icon name="arrow" size={17} />
          </span>
        </Link>
        <Link className="patient-task" to="/patient/recovery">
          <Icon name="shield" size={28} />
          <h3>Keep history recoverable</h3>
          <p>
            {wallet.guardianShares.length
              ? 'Guardian shares created. Store your backup separately.'
              : 'Choose guardians and save an encrypted backup.'}
          </p>
          <span>
            Review recovery
            <Icon name="arrow" size={17} />
          </span>
        </Link>
      </div>
    </>
  );
}
function Medicines({ wallet, update, mine, feed }) {
  const [mode, setMode] = useState(null),
    [error, setError] = useState('');
  const read = async (text) => {
    try {
      const p = JSON.parse(text);
      if (p.type === 'receipt') {
        if (!feed) throw new Error('Complete a bulletin check before verifying this receipt.');
        await verifyReceipt(p, feed);
        if (!mine.some((r) => r.commitment === p.commitment))
          throw new Error(
            'Receipt is not matched to a committed record owned by this vault. Check again after the fill is recorded.'
          );
        await update({
          ...wallet,
          receipts: [...(wallet.receipts || []).filter((r) => r.id !== p.id), p],
        });
      } else {
        if (
          p.v !== 2 ||
          !p.id ||
          !/^0x[0-9a-fA-F]{64}$/.test(p.permitSecret) ||
          keccak256(p.permitSecret) !== p.holderCommit
        )
          throw new Error('Prescription credential is invalid.');
        if (feed && p.network !== feed.network)
          throw new Error('Prescription belongs to another network.');
        if (wallet.permits.some((v) => v.id === p.id))
          throw new Error('This prescription is already saved.');
        await update({ ...wallet, permits: [...wallet.permits, p] });
      }
      setMode(null);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="Private device records"
        title="Your medicines"
        action={
          <button className="button" onClick={() => setMode('prescription')}>
            <Icon name="plus" size={17} />
            Add prescription
          </button>
        }
      >
        Scan a protected prescription or a recorded pharmacy receipt.
      </PageTitle>
      <Message error={error} />
      {mode && (
        <Card title={mode === 'receipt' ? 'Scan recorded pharmacy receipt' : 'Import prescription'}>
          <QrScanner onResult={read} />
          <button className="text-button" onClick={() => setMode(null)}>
            Cancel
          </button>
        </Card>
      )}
      <div className="patient-medicine-grid">
        {mine.map((r) => {
          const l = feed.lots.find((l) => l.id === r.lotId),
            receipt = wallet.receipts?.find((x) => x.commitment === r.commitment);
          return (
            <Card key={`${r.lotId}:${r.leafIndex}:${r.segment}`}>
              <div className="medicine-icon">
                <Icon name="box" size={27} />
              </div>
              <Badge tone={l?.recallId ? 'bad' : ''}>
                {l?.recallId ? 'Recalled' : 'Matched committed record'}
              </Badge>
              <h3>{l?.name || 'Received medicine'}</h3>
              <p>
                Lot {l?.lotNumber} · {l?.code}
              </p>
              {receipt ? (
                <p>
                  {receipt.quantity} units · {receipt.pharmacy}
                </p>
              ) : (
                <button className="text-button" onClick={() => setMode('receipt')}>
                  Add the detailed pharmacy receipt
                </button>
              )}
              <small>Expires {date(l?.expiry)}</small>
            </Card>
          );
        })}
        {!mine.length && (
          <Card>
            <Empty title="Your first receipt starts here">
              Import a prescription, show its counter code and refresh after the pharmacy records
              your fill.
            </Empty>
          </Card>
        )}
      </div>
      <Card title="Saved prescription credentials">
        <div className="permit-list">
          {wallet.permits.map((p) => (
            <div key={p.id}>
              <span className="product-glyph">
                <Icon name="file" />
              </span>
              <div>
                <strong>
                  {p.namespace} {p.code}
                </strong>
                <small>
                  {p.quantity} authorized units · expires {date(p.expiry)}
                </small>
              </div>
              <Badge>Private credential</Badge>
              <button
                className="text-button"
                onClick={() => download('lotus-prescription.json', p)}
              >
                Export
              </button>
            </div>
          ))}
        </div>
        {!wallet.permits.length && (
          <Empty icon="file">Your prescriber gives you a protected QR. Import it here.</Empty>
        )}
      </Card>
    </>
  );
}
function CounterCode({ wallet, update }) {
  const [selected, setSelected] = useState(''),
    [code, setCode] = useState(null);
  const permit = wallet.permits.find((p) => p.id === selected) || wallet.permits[0];
  return (
    <>
      <PageTitle eyebrow="One-time pharmacy exchange" title="Show at the counter">
        Your root secret never appears in this code. A prescription credential is shared only with
        the pharmacy you choose.
      </PageTitle>
      <div className="counter-code-grid">
        <Card title="Select your prescription">
          {wallet.permits.length ? (
            <>
              <Field label="Prescription">
                <select
                  value={permit?.id || ''}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setCode(null);
                  }}
                >
                  {wallet.permits.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.quantity} units
                    </option>
                  ))}
                </select>
              </Field>
              <Action
                onClick={async () => {
                  if (permit.expiry < Date.now() / 1000)
                    throw new Error('This prescription has expired.');
                  const result = await reserveCode(wallet, permit);
                  await update(result.wallet);
                  setCode(result.code);
                  return 'One-time index saved securely before this code was displayed.';
                }}
              >
                Create fresh counter code
                <Icon name="scan" size={17} />
              </Action>
              <p className="table-note">
                Unused codes stay recorded in your vault’s allocation history. They do not silently
                break recovery.
              </p>
            </>
          ) : (
            <Empty icon="file">Add a prescription in Medicines first.</Empty>
          )}
        </Card>
        <Card
          className="counter-code-card"
          title={code ? 'Ready for the pharmacy' : 'Your protected code'}
        >
          {code ? (
            <>
              <div className="qr-wrap">
                <QRCodeSVG value={JSON.stringify(code)} size={224} />
              </div>
              <Badge>Waiting for a recorded fill</Badge>
              <p>
                Keep this screen private. Confirm the shelf pack and wait for the pharmacy’s
                recorded receipt.
              </p>
              <textarea readOnly value={JSON.stringify(code)} aria-label="Patient counter code" />
              <button
                className="button subtle"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(code))}
              >
                Copy counter code
              </button>
            </>
          ) : (
            <Empty icon="scan">Create a new code for the selected prescription.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
function PatientAlerts({ wallet, update, mine, affected, feed, refresh }) {
  const [report, setReport] = useState('');
  const unique = [...new Set(affected.map((r) => r.lotId))];
  return (
    <>
      <PageTitle eyebrow="Private lot matching" title="Your alerts & responses">
        Eligibility is proved locally. Your secret and the exact receipt you own are not sent with a
        signal.
      </PageTitle>
      {unique.length ? (
        unique.map((id) => {
          const l = feed.lots.find((l) => l.id === id),
            r = feed.recalls.find((r) => r.lotId === id),
            receipt = affected.find((a) => a.lotId === id);
          return (
            <Card
              key={id}
              className="recall-panel"
              title={l?.name}
              subtitle={`Affected lot ${l?.lotNumber} · Class ${
                ['', 'I', 'II', 'III'][r.classification]
              }`}
            >
              <div className="notice-text">
                <strong>Official patient instructions</strong>
                <p>{r.instructions}</p>
                <small>
                  Issued {date(r.issuedAt)} · {r.reason}
                </small>
              </div>
              <Form
                label="Send anonymous acknowledgement"
                onSubmit={async (v) => {
                  const payload = await membership(wallet, receipt, feed, 'ack', Number(v.action));
                  await post('/anonymous/ack', payload);
                  await update({ ...wallet, acknowledged: [...(wallet.acknowledged || []), r.id] });
                  await refresh();
                  return 'Anonymous acknowledgement accepted.';
                }}
              >
                <Field label="Your action">
                  <select name="action">
                    <option value="1">I stopped using it</option>
                    <option value="2">I returned it to the pharmacy</option>
                    <option value="3">I consulted my doctor</option>
                  </select>
                </Field>
              </Form>
              {wallet.acknowledged?.includes(r.id) && (
                <Badge>Acknowledgement already recorded</Badge>
              )}
            </Card>
          );
        })
      ) : (
        <Card>
          <Empty icon="bell" title="No locally matched recall alerts">
            The last completed check is shown above. Offline or incomplete checks do not establish a
            current result.
          </Empty>
        </Card>
      )}
      <Card
        title="Report a side effect privately"
        subtitle="The narrative is encrypted to authorized safety staff before upload."
      >
        {mine.length ? (
          <Form
            label="Encrypt, prove and submit"
            onSubmit={async (v) => {
              const receipt = mine[Number(v.receipt)],
                object = await encryptedReport(v.text);
              const proof = await membership(
                wallet,
                receipt,
                feed,
                'report',
                Number(v.severity),
                object.digest
              );
              const result = await post('/anonymous/report', { ...proof, documentId: object.id });
              setReport(result.result.reportId);
              return 'Encrypted report accepted with a verified membership proof.';
            }}
          >
            <Field label="Received medicine">
              <select name="receipt">
                {mine.map((r, i) => (
                  <option key={`${r.lotId}:${r.leafIndex}`} value={i}>
                    {feed.lots.find((l) => l.id === r.lotId)?.name} ·{' '}
                    {feed.lots.find((l) => l.id === r.lotId)?.lotNumber}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reported severity">
              <select name="severity">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5 {n === 1 ? '· mild' : n === 5 ? '· very serious' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="What happened"
              hint="Do not include names, contact details or identifying attachments."
            >
              <textarea name="text" required maxLength={12000} />
            </Field>
            <p className="table-note">
              One report per vault secret for this lot. Receipt eligibility does not establish
              medical causation.
            </p>
          </Form>
        ) : (
          <Empty icon="file">A committed medicine receipt is required before you can report.</Empty>
        )}
        {report && (
          <div className="receipt-box">
            <strong>Accepted report receipt</strong>
            <span className="mono">{report}</span>
          </div>
        )}
      </Card>
    </>
  );
}
function Recovery({ wallet, update }) {
  const [show, setShow] = useState(-1);
  return (
    <>
      <PageTitle eyebrow="Independent guardian custody" title="Make your history recoverable">
        Keep your encrypted backup package separately from the guardian shares.
      </PageTitle>
      <div className="content-grid">
        <Card
          title="Two-of-three guardians"
          subtitle="Any two valid shares reconstruct your root secret. One alone is insufficient."
        >
          {wallet.guardianShares.length ? (
            <div className="guardian-list">
              {wallet.guardianShares.map((share, i) => (
                <div key={i}>
                  <Field label={`Guardian ${i + 1}`}>
                    <input
                      value={wallet.guardianNames[i]}
                      onChange={(e) =>
                        update({
                          ...wallet,
                          guardianNames: wallet.guardianNames.map((n, j) =>
                            j === i ? e.target.value : n
                          ),
                        })
                      }
                    />
                  </Field>
                  <button
                    className="button outline small"
                    onClick={() => setShow(show === i ? -1 : i)}
                  >
                    Show handover share
                  </button>
                  {show === i && (
                    <>
                      <div className="qr-wrap">
                        <QRCodeSVG
                          value={JSON.stringify({
                            v: 2,
                            type: 'guardian',
                            share,
                            name: wallet.guardianNames[i],
                          })}
                          size={165}
                        />
                      </div>
                      <textarea
                        readOnly
                        aria-label={`Guardian share ${i + 1}`}
                        value={JSON.stringify({
                          v: 2,
                          type: 'guardian',
                          share,
                          name: wallet.guardianNames[i],
                        })}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="muted">
                Choose personal and professional guardians independently. Do not put two shares
                under one operator.
              </p>
              <Action
                onClick={async () => {
                  await update(await guardians(wallet));
                  return 'Shares created. Hand each one to an independent guardian.';
                }}
              >
                Create guardian shares
                <Icon name="users" size={17} />
              </Action>
            </>
          )}
          <Link to="/guardian" className="text-link">
            Open guardian share vault
            <Icon name="arrow" size={16} />
          </Link>
        </Card>
        <Card title="Complete encrypted backup">
          <Icon name="shield" size={35} />
          <h3>More than a recovered secret.</h3>
          <p className="muted">
            This package preserves receipts, active prescription credentials and every allocated
            code index. The root secret reconstructed from two shares decrypts it locally.
          </p>
          <Action
            disabled={!wallet.guardianShares.length}
            onClick={async () => {
              download('lotus-encrypted-backup.json', await exportBackup(wallet));
              return 'Encrypted backup downloaded. Save an updated copy after new prescriptions and fills.';
            }}
          >
            Download encrypted backup
            <Icon name="file" size={17} />
          </Action>
          <p className="table-note">
            A stale backup cannot restore newer credentials. Replacing a guardian requires new
            shares and an updated backup, not only a renamed label.
          </p>
          <Action
            className="outline small"
            disabled={!wallet.guardianShares.length}
            onClick={async () => {
              await update(await guardians(wallet));
              setShow(-1);
              return 'New shares created. Replace every guardian’s share and save a new backup.';
            }}
          >
            Replace share arrangement
          </Action>
        </Card>
      </div>
    </>
  );
}
