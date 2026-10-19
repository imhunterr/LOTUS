import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, post, command, date, upload, parsePackCode } from "./api";
import {
  Icon,
  Card,
  Empty,
  Badge,
  Metric,
  Field,
  Action,
  DataTable,
  PageTitle,
  Form,
  LotSelect,
  Message,
  download,
} from "./ui";
const PatientWeb = React.lazy(() => import("./PatientWeb"));
const GuardianWeb = React.lazy(() => import("./GuardianWeb"));
import QrScanner from "../components/QrScanner";
import "./styles.css";
import sourceSamples from "../generated/fda-replay.json";

const Context = createContext();
export const useApplication = () => useContext(Context);
const names = {
  manufacturer: "Manufacturer",
  distributor: "Distributor",
  pharmacy: "Pharmacy",
  prescriber: "Prescriber",
  regulator: "Safety authority",
  operator: "Operator",
  auditor: "Auditor",
};
const tabs = {
  manufacturer: ["Overview", "Lots", "Shipments", "Returns", "Documents"],
  distributor: ["Overview", "Inventory", "Incoming", "Outgoing", "Returns"],
  pharmacy: [
    "Overview",
    "Counter",
    "Inventory",
    "Incoming",
    "Returns",
    "Losses",
    "Transfers",
  ],
  prescriber: ["Overview", "Issue permit", "Active permits"],
  regulator: [
    "Overview",
    "Investigations",
    "Recalls",
    "Regional view",
    "Imports",
    "Replay lab",
  ],
  operator: [
    "Overview",
    "Organizations",
    "Staff access",
    "Integrations",
    "Audit",
  ],
  auditor: ["Overview", "Inventory", "Integrations", "Audit"],
};
const slugs = (name) => name.toLowerCase().replaceAll(" ", "-");
export default function Application() {
  const [session, setSession] = useState(null),
    [error, setError] = useState("");
  const refreshSession = useCallback(
    () =>
      api("/session")
        .then(setSession)
        .catch((e) => setError(e.message)),
    []
  );
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);
  return (
    <Context.Provider value={{ session, setSession, refreshSession }}>
      <BrowserRouter>
        <React.Suspense
          fallback={
            <div className="loading-page">Opening your private workspace…</div>
          }
        >
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/join" element={<Join />} />
            <Route path="/patient/*" element={<PatientWeb />} />
            <Route path="/guardian" element={<GuardianWeb />} />
            <Route path="/verify" element={<Verify />} />
            <Route
              path="/workspace/:tab?"
              element={
                session ? (
                  <Workspace />
                ) : (
                  <div className="loading-page">
                    <Icon />
                    {error || "Opening workspace…"}
                  </div>
                )
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </Context.Provider>
  );
}
export function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand" to="/">
        <span className="brand-icon">
          <Icon name="leaf" />
        </span>
        LOTUS<span className="brand-caption">Medicine, accounted for.</span>
      </Link>
      <nav>
        <Link to="/verify">Verify a pack</Link>
        <Link to="/patient">My medicines</Link>
        <Link className="button subtle small" to="/login">
          Staff sign in
          <Icon name="arrow" size={16} />
        </Link>
      </nav>
    </header>
  );
}
function Landing() {
  return (
    <div className="landing">
      <PublicHeader />
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">
              <span className="status-dot" />A clearer path from lot to patient
            </p>
            <h1>
              Your medicine.
              <br />
              Its story.
              <br />
              <em>Your privacy.</em>
            </h1>
            <p className="hero-copy">
              Know the exact medicine lot you received. Get relevant recall
              information and share your response privately.
            </p>
            <div className="hero-actions">
              <Link to="/patient" className="button">
                Open my medicine inbox
                <Icon name="arrow" />
              </Link>
              <Link to="/verify" className="button outline">
                Check a medicine pack
                <Icon name="scan" />
              </Link>
            </div>
            <div className="hero-assurance">
              <Icon name="shield" size={17} />
              Your private secret stays in your browser. No crypto wallet
              needed.
            </div>
          </div>
          <div className="hero-art">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="medicine-card">
              <div className="art-card-top">
                <span className="brand-icon">
                  <Icon name="leaf" />
                </span>
                <Badge>YOUR PRIVATE INBOX</Badge>
              </div>
              <div className="pack-art">
                <div className="pack-stripe" />
                <Icon name="leaf" size={42} />
                <span>MEDICINE</span>
                <small>LOT TRACEABILITY</small>
              </div>
              <h3>Every lot has a story.</h3>
              <p>From verified custody to a receipt that belongs to you.</p>
              <div className="art-route">
                <Icon name="box" />
                <span />
                <Icon name="scan" />
                <span />
                <Icon name="shield" />
              </div>
            </div>
            <div className="floating-note">
              <Icon name="shield" />
              <div>
                <strong>Private by design</strong>
                <small>Matching happens on your device</small>
              </div>
            </div>
          </div>
        </section>
        <section className="landing-cards">
          <Card title="01 · Know the exact lot">
            <p>
              Check registry status, expiry and official recalls. A registered
              lot is a record, not proof of a pack’s physical authenticity.
            </p>
          </Card>
          <Card title="02 · Keep your history private">
            <p>
              Save prescription codes and committed receipts in an encrypted
              browser vault. Choose independent recovery guardians.
            </p>
          </Card>
          <Card title="03 · Respond with confidence">
            <p>
              Acknowledge a recall or submit a protected side-effect report with
              a real proof of receipt.
            </p>
          </Card>
        </section>
        <footer className="public-footer">
          <span>LOTUS · Lot-oriented traceability</span>
          <Link to="/guardian">
            Guardian share management
            <Icon name="arrow" size={16} />
          </Link>
        </footer>
      </main>
    </div>
  );
}
function Login() {
  const { session, setSession } = useApplication(),
    navigate = useNavigate();
  if (session?.user) return <Navigate to="/workspace" replace />;
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="auth-main">
        <div className="auth-story">
          <p className="eyebrow">Authorized workspaces</p>
          <h1>
            Good records.
            <br />
            Better decisions.
          </h1>
          <p>
            Operate the medicine journey with your organization’s approved
            access.
          </p>
          <div className="auth-features">
            <span>
              <Icon name="box" />
              Traceable stock and custody
            </span>
            <span>
              <Icon name="file" />
              Durable prescriptions and receipts
            </span>
            <span>
              <Icon name="shield" />
              Protected patient signals
            </span>
          </div>
        </div>
        <Card
          className="auth-card"
          title={
            session?.setupRequired ? "Set up your workspace" : "Welcome back"
          }
          subtitle={
            session?.setupRequired
              ? "Create the first operator account on this computer."
              : "Sign in with your invited staff account."
          }
        >
          <Form
            label={
              session?.setupRequired ? "Create operator account" : "Sign in"
            }
            onSubmit={async (values) => {
              const result = await post(
                session?.setupRequired ? "/setup" : "/login",
                values
              );
              setSession({ ...session, ...result, setupRequired: false });
              navigate("/workspace");
            }}
          >
            {session?.setupRequired && (
              <Field label="Your name">
                <input name="name" required autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </Field>
            <Field label="Password" hint="Use at least 12 characters.">
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete={
                  session?.setupRequired ? "new-password" : "current-password"
                }
              />
            </Field>
          </Form>
          <p className="muted auth-footnote">
            Patients use a private browser vault. They do not need a staff
            account.
          </p>
        </Card>
      </main>
    </div>
  );
}
function Join() {
  const { session, setSession } = useApplication(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    [invite, setInvite] = useState(null),
    [error, setError] = useState("");
  const token = params.get("invite");
  useEffect(() => {
    if (token)
      api(`/invitations/${token}`)
        .then(setInvite)
        .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="narrow-main">
        <Card
          title="Join your organization"
          subtitle={
            invite
              ? `${invite.name} · ${names[invite.role]}`
              : "Your invitation is being checked."
          }
        >
          <Message error={error} />
          {invite && (
            <Form
              label="Activate my access"
              onSubmit={async (values) => {
                const result = await post("/join", {
                  token,
                  password: values.password,
                });
                setSession({ ...session, ...result });
                navigate("/workspace");
              }}
            >
              <Field label="Invited email">
                <input value={invite.email} readOnly />
              </Field>
              <Field label="Choose a password">
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </Field>
            </Form>
          )}
        </Card>
      </main>
    </div>
  );
}

function Workspace() {
  const { session, setSession } = useApplication(),
    { tab } = useParams(),
    navigate = useNavigate();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api("/workspace"));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (session.user) refresh();
  }, [refresh, session.user]);
  if (!session.user) return <Navigate to="/login" replace />;
  const user = session.user,
    nav = tabs[user.role] || ["Overview"],
    selected = nav.find((n) => slugs(n) === tab) || "Overview";
  const org = data?.organizations.find((o) => o.id === user.orgId);
  return (
    <div className="workspace-shell">
      <aside className={`workspace-sidebar ${menu ? "open" : ""}`}>
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Icon />
          </span>
          LOTUS
        </Link>
        <div className="workspace-label">
          <span>{names[user.role]} workspace</span>
          <strong>{org?.name || "Consortium operations"}</strong>
          <small>{org?.facility || "Authorized organization scope"}</small>
        </div>
        <nav>
          {nav.map((name, i) => (
            <NavLink
              key={name}
              to={`/workspace/${slugs(name)}`}
              className={selected === name ? "active" : ""}
              onClick={() => setMenu(false)}
            >
              <Icon name={["home", "box", "file", "users", "shield"][i % 5]} />
              {name}
              <span className="nav-count">
                {name === "Incoming"
                  ? data?.shipments.filter(
                      (s) => s.toOrgId === user.orgId && s.status === "pending"
                    ).length || ""
                  : ""}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/patient">
            <Icon name="shield" />
            Patient web interface
          </Link>
          <Link to="/verify">
            <Icon name="scan" />
            Public verification
          </Link>
          <button
            onClick={async () => {
              await post("/logout", {});
              setSession({ ...session, user: null, csrf: null });
              navigate("/login");
            }}
          >
            <Icon name="logout" />
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-top">
          <div>
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMenu(!menu)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> {selected}
            </span>
          </div>
          <div className="top-controls">
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={refresh}
            >
              <Icon name="clock" />
            </button>
            <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
            <div className="user-label">
              <strong>{user.name}</strong>
              <span>{names[user.role]}</span>
            </div>
          </div>
        </header>
        <main className="workspace-content">
          <Message error={error} />
          {!data ? (
            <div className="loading-page">Loading your workspace…</div>
          ) : (
            <>
              <div className="ledger-status">
                <span>
                  <span className="status-dot" />
                  {data.ledger === "fabric"
                    ? data.transport === "firefly"
                      ? "Fabric through FireFly"
                      : "Fabric connected"
                    : "Local durable ledger"}{" "}
                  · {org?.facility || "Consortium"}{" "}
                </span>
                <small>
                  {busy
                    ? "Refreshing…"
                    : `Checked ${new Date(
                        data.checkedAt
                      ).toLocaleTimeString()}`}
                </small>
              </div>
              <Operations data={data} refresh={refresh} tab={selected} />
            </>
          )}
        </main>
      </div>
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
    </div>
  );
}

function Operations({ data: d, refresh, tab }) {
  const user = d.user;
  const run = async (cmd, payload) => {
    const result = await command(cmd, payload);
    await refresh();
    return result.result;
  };
  const lot = (id) => d.lots.find((l) => l.id === id);
  const org = (id) =>
    d.organizations.find((o) => o.id === id)?.name || "Organization";
  const held = d.stocks.filter((s) => s.orgId === user.orgId);
  const eligible = d.lots.filter(
    (l) =>
      held.some((s) => s.lotId === l.id && BigInt(s.available) > 0n) &&
      !l.recallId &&
      l.expiry > Date.now() / 1000
  );
  const title = {
    Overview: "Your day, at a glance",
    Lots: "Products & lots",
    Inventory: "Account for every unit",
    Incoming: "Receive with confidence",
    Outgoing: "Send the right stock",
    Shipments: "Track your shipments",
    Returns: "Returns & quarantine",
    Losses: "Document stock losses",
    Counter: "The right medicine. The exact lot.",
    Transfers: "Move remaining entitlement",
    "Issue permit": "Prescribe with a fresh credential",
    "Active permits": "Active prescription permits",
    Investigations: "Investigate safety signals",
    Recalls: "Act on the exact lot",
    "Regional view": "Regional response, with privacy",
    Imports: "Resolve recall notice scope",
    Organizations: "Your consortium, connected",
    "Staff access": "The right access, for every person",
    Audit: "A durable record of decisions",
    Integrations: "Connections & measured evidence",
    Documents: "Quality evidence, attached",
  };
  return (
    <>
      <PageTitle eyebrow={names[user.role]} title={title[tab] || tab}>
        {tab === "Overview"
          ? "Your live records, pending decisions and next actions."
          : descriptions[tab] || "Authorized operations for your organization."}
      </PageTitle>
      {tab === "Overview" ? (
        <Overview d={d} />
      ) : tab === "Organizations" ? (
        <Organizations d={d} run={run} />
      ) : tab === "Staff access" ? (
        <StaffAccess d={d} run={run} />
      ) : tab === "Lots" ? (
        <Lots d={d} run={run} />
      ) : tab === "Documents" ? (
        <Documents />
      ) : tab === "Inventory" ? (
        <Inventory d={d} run={run} />
      ) : ["Incoming", "Shipments", "Outgoing", "Returns"].includes(tab) ? (
        <Shipments d={d} tab={tab} run={run} />
      ) : tab === "Losses" ? (
        <Losses d={d} run={run} />
      ) : tab === "Issue permit" ? (
        <Prescribe d={d} run={run} />
      ) : tab === "Active permits" ? (
        <Permits d={d} />
      ) : tab === "Counter" ? (
        <Counter d={d} run={run} />
      ) : tab === "Transfers" ? (
        <Transfers d={d} run={run} />
      ) : tab === "Recalls" ? (
        <Recalls d={d} run={run} />
      ) : tab === "Investigations" ? (
        <Investigations d={d} />
      ) : tab === "Regional view" ? (
        <Regions d={d} />
      ) : tab === "Imports" ? (
        <Imports d={d} />
      ) : tab === "Replay lab" ? (
        <ReplayLab d={d} refresh={refresh} />
      ) : tab === "Audit" ? (
        <Audit />
      ) : tab === "Integrations" ? (
        <Integrations />
      ) : (
        <Empty />
      )}
    </>
  );
}
const descriptions = {
  Lots: "Register immutable batch identity, expiry, initial units and the actual certificate.",
  Inventory:
    "Available, in transit, quarantined, dispensed and lost quantities stay distinct.",
  Incoming: "Stock counts as received only after your organization accepts it.",
  Counter:
    "Scan the shelf pack and patient code. Hand over only after a recorded receipt.",
  Returns:
    "Returned or recalled stock remains quarantined until documented disposition.",
  Recalls:
    "An authorized decision blocks future dispensing and informs patient browsers.",
  Investigations:
    "Verified receipt eligibility supports review; it does not prove medical causation.",
  Organizations:
    "Approve real business organizations before granting staff access.",
};
function Overview({ d }) {
  const role = d.user.role,
    stocks = d.stocks.filter((s) => s.orgId === d.user.orgId),
    pending = d.shipments.filter(
      (s) => s.toOrgId === d.user.orgId && s.status === "pending"
    ),
    active = d.recalls;
  return (
    <>
      <div className="metrics-grid">
        <Metric
          label="Registered lots"
          value={d.lots.length}
          hint="Product and batch identities"
        />
        <Metric
          label={role === "regulator" ? "Verified reports" : "Awaiting receipt"}
          value={role === "regulator" ? d.reports.length : pending.length}
          hint={
            role === "regulator"
              ? "Eligible anonymous submissions"
              : "Recipient decision required"
          }
          icon="file"
        />
        <Metric
          label="Active recalls"
          value={active.length}
          hint="Exact lots blocked from dispensing"
          icon="bell"
          tone={active.length ? "warn" : ""}
        />
        <Metric
          label="Approved organizations"
          value={d.organizations.length}
          hint="Organization-scoped authority"
          icon="users"
        />
      </div>
      <div className="content-grid">
        <Card
          title="Recent lots"
          subtitle="Registered products and current batch status"
        >
          <DataTable
            headers={["Medicine / lot", "Expires", "Status"]}
            rows={d.lots
              .slice(-5)
              .reverse()
              .map((l) => [
                <div className="cell-product">
                  <span className="product-glyph">
                    <Icon name="box" />
                  </span>
                  <div>
                    <strong>{l.name}</strong>
                    <small>
                      {l.lotNumber} · {l.code}
                    </small>
                  </div>
                </div>,
                date(l.expiry),
                <Badge
                  tone={
                    l.recallId
                      ? "bad"
                      : l.expiry < Date.now() / 1000
                      ? "warn"
                      : ""
                  }
                >
                  {l.recallId
                    ? "Recalled"
                    : l.expiry < Date.now() / 1000
                    ? "Expired"
                    : "Registered"}
                </Badge>,
              ])}
            empty="No lot has been registered. Manufacturer staff can add the first batch."
          />
        </Card>
        <Card title="Your next action" className="next-action-card">
          <span className="next-icon">
            <Icon
              name={
                role === "operator"
                  ? "users"
                  : role === "regulator"
                  ? "shield"
                  : "scan"
              }
              size={30}
            />
          </span>
          <h3>
            {role === "operator"
              ? "Connect your organizations"
              : role === "manufacturer"
              ? "Register your first lot"
              : role === "pharmacy"
              ? "Keep the counter accountable"
              : role === "prescriber"
              ? "Issue a protected permit"
              : role === "regulator"
              ? "Review the safety inbox"
              : "Resolve incoming stock"}
          </h3>
          <p>
            {role === "operator"
              ? "Create an organization and invite its staff. Every person chooses their own password."
              : "Open the relevant workspace to complete an authorized operation with a durable receipt."}
          </p>
          <Link
            className="button"
            to={`/workspace/${
              role === "operator"
                ? "organizations"
                : role === "manufacturer"
                ? "lots"
                : role === "pharmacy"
                ? "counter"
                : role === "prescriber"
                ? "issue-permit"
                : role === "regulator"
                ? "investigations"
                : "incoming"
            }`}
          >
            Open task
            <Icon name="arrow" size={17} />
          </Link>
        </Card>
      </div>
      <Card title="The custody principle" className="principle">
        <Icon name="shield" size={24} />
        <div>
          <strong>Available stock comes from accepted custody.</strong>
          <p>
            Pending shipments and draft fills never count as completed
            operations.
          </p>
        </div>
      </Card>
    </>
  );
}
function Organizations({ d, run }) {
  return (
    <div className="content-grid">
      <Card title="Approved organizations">
        <DataTable
          headers={["Organization", "Type", "Facility", "Region"]}
          rows={d.organizations.map((o) => [
            o.name,
            <Badge>{names[o.type]}</Badge>,
            o.facility,
            o.region || "—",
          ])}
        />
      </Card>
      <Card title="Add an organization">
        <Form
          label="Approve organization"
          onSubmit={async (v) => {
            await run("createOrganization", v);
            return "Organization approved. You can now invite its staff.";
          }}
        >
          <Field label="Organization name">
            <input name="name" required />
          </Field>
          <Field label="Business type">
            <select name="type">
              {Object.entries(names)
                .filter(([r]) => r !== "operator")
                .map(([r, n]) => (
                  <option key={r} value={r}>
                    {n}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-columns">
            <Field label="Facility">
              <input name="facility" required defaultValue="Main facility" />
            </Field>
            <Field label="Region code">
              <input
                name="region"
                type="number"
                min="0"
                max="65535"
                defaultValue="1"
                required
              />
            </Field>
          </div>
        </Form>
      </Card>
    </div>
  );
}
function StaffAccess({ d, run }) {
  const [invitation, setInvitation] = useState(null);
  return (
    <div className="content-grid">
      <Card title="Registered actors">
        <DataTable
          headers={["Person", "Workspace", "Access", "Action"]}
          rows={d.actors.map((a) => [
            a.name,
            names[a.role],
            <Badge tone={a.active ? "" : "bad"}>
              {a.active ? "Active" : "Revoked"}
            </Badge>,
            a.id !== d.user.id && a.active ? (
              <Action
                className="subtle small"
                onClick={async () => {
                  await run("revokeActor", { id: a.id });
                  return "Access revoked.";
                }}
              >
                Revoke
              </Action>
            ) : (
              "—"
            ),
          ])}
        />
      </Card>
      <Card
        title="Invite staff"
        subtitle="Share the invitation link directly. LOTUS does not send messages."
      >
        <Form
          label="Create private invitation"
          onSubmit={async (v) => {
            const org = d.organizations.find((o) => o.id === v.orgId);
            const result = await post("/invitations", { ...v, role: org.type });
            setInvitation(location.origin + result.url);
            return "Invitation created. It expires in seven days.";
          }}
        >
          <Field label="Name">
            <input name="name" required />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required />
          </Field>
          <Field label="Approved organization">
            <select name="orgId" required defaultValue="">
              <option value="" disabled>
                Select organization
              </option>
              {d.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {names[o.type]}
                </option>
              ))}
            </select>
          </Field>
        </Form>
        {invitation && (
          <div className="receipt-box">
            <strong>Private invitation link</strong>
            <textarea
              readOnly
              value={invitation}
              aria-label="Invitation link"
            />
            <button
              className="button subtle small"
              onClick={() => navigator.clipboard.writeText(invitation)}
            >
              Copy link
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
function Lots({ d, run }) {
  const [pack, setPack] = useState(null);
  return (
    <div className="content-grid">
      <Card title="Lot registry">
        <DataTable
          headers={[
            "Medicine",
            "Product / lot",
            "Initial units",
            "Expiry",
            "Pack code",
          ]}
          rows={d.lots.map((l) => [
            l.name,
            `${l.namespace} ${l.code} · ${l.lotNumber}`,
            l.quantity,
            date(l.expiry),
            <button className="button subtle small" onClick={() => setPack(l)}>
              Pack code
            </button>,
          ])}
        />
        {pack && (
          <div className="receipt-box">
            <strong>
              {pack.name} · {pack.lotNumber}
            </strong>
            <div className="qr-wrap">
              <QRCodeSVG
                value={JSON.stringify({
                  type: "pack",
                  namespace: pack.namespace,
                  code: pack.code,
                  lotNumber: pack.lotNumber,
                })}
                size={170}
              />
            </div>
            <p className="table-note">
              This code identifies the registered lot. It cannot establish the
              physical pack's authenticity.
            </p>
          </div>
        )}
      </Card>
      <Card title="Register a lot">
        <Form
          label="Register and issue stock"
          onSubmit={async (v, form) => {
            let doc;
            const file = form.elements.document.files[0];
            if (file) doc = await upload(file, true);
            await run("registerLot", {
              ...v,
              expiry: Math.floor(
                new Date(v.expiry + "T23:59:59").getTime() / 1000
              ),
              documentId: doc?.id,
            });
            form.reset();
            return "Lot registered and initial stock issued once.";
          }}
        >
          <Field label="Medicine name">
            <input name="name" required />
          </Field>
          <div className="form-columns">
            <Field label="Namespace">
              <select name="namespace">
                <option>NDC</option>
                <option>GTIN</option>
                <option>LOCAL</option>
              </select>
            </Field>
            <Field label="Product code">
              <input name="code" required />
            </Field>
          </div>
          <div className="form-columns">
            <Field label="Lot number">
              <input name="lotNumber" required />
            </Field>
            <Field label="Expiry date">
              <input name="expiry" type="date" required />
            </Field>
          </div>
          <Field label="Initial base units">
            <input name="quantity" type="number" min="1" step="1" required />
          </Field>
          <Field
            label="Certificate of analysis"
            hint="Actual document bytes are stored with a verified digest."
          >
            <input name="document" type="file" accept=".pdf,.png,.jpg,.txt" />
          </Field>
        </Form>
      </Card>
    </div>
  );
}
function Documents() {
  const [doc, setDoc] = useState(null);
  return (
    <Card title="Upload a verified document">
      <Form
        label="Store document"
        onSubmit={async (v, form) => {
          const f = form.elements.file.files[0];
          if (!f) throw new Error("Choose a file.");
          setDoc(await upload(f, v.visibility === "public"));
          return "Document stored with a content digest.";
        }}
      >
        <Field label="Document">
          <input name="file" type="file" required />
        </Field>
        <Field label="Access">
          <select name="visibility">
            <option value="public">Approved public document</option>
            <option value="private">Organization only</option>
          </select>
        </Field>
      </Form>
      {doc && (
        <div className="receipt-box">
          <strong>{doc.name}</strong>
          <p className="mono">SHA-256 {doc.digest}</p>
          <a href={`/api/documents/${doc.id}`} className="text-link">
            Download verified bytes
            <Icon name="arrow" size={16} />
          </a>
        </div>
      )}
    </Card>
  );
}
function Inventory({ d, run }) {
  const lot = (id) => d.lots.find((l) => l.id === id);
  return (
    <>
      <Card title="Stock by lot">
        <DataTable
          headers={[
            "Medicine / lot",
            "Available",
            "In transit",
            "Quarantine",
            "Dispensed",
            "Returned",
            "Loss",
          ]}
          rows={d.stocks.map((s) => [
            `${lot(s.lotId)?.name || "Medicine"} · ${lot(s.lotId)?.lotNumber}`,
            s.available,
            s.inTransit,
            s.quarantine,
            s.dispensed,
            s.returned,
            s.shrinkage,
          ])}
        />
      </Card>
      {d.user.role !== "auditor" && (
        <Card title="Move held stock to quarantine">
          <Form
            label="Quarantine units"
            onSubmit={async (v) => {
              await run("quarantine", v);
              return "Stock quarantined. Ordinary dispensing cannot use it.";
            }}
          >
            <div className="form-columns">
              <Field label="Lot">
                <LotSelect
                  lots={d.lots.filter((l) =>
                    d.stocks.some(
                      (s) => s.lotId === l.id && BigInt(s.available) > 0n
                    )
                  )}
                />
              </Field>
              <Field label="Quantity">
                <input name="quantity" type="number" min="1" required />
              </Field>
            </div>
          </Form>
        </Card>
      )}
    </>
  );
}
function Shipments({ d, tab, run }) {
  const [receipt, setReceipt] = useState(null);
  const incoming = tab === "Incoming",
    isReturn = tab === "Returns";
  const org = (id) => d.organizations.find((o) => o.id === id)?.name;
  const lot = (id) => d.lots.find((l) => l.id === id);
  const rows = d.shipments.filter((s) =>
    incoming
      ? s.toOrgId === d.user.orgId
      : isReturn
      ? s.kind === "return"
      : true
  );
  const lots = d.lots.filter((l) =>
    d.stocks.some(
      (s) =>
        s.orgId === d.user.orgId &&
        s.lotId === l.id &&
        (BigInt(s.available) > 0n || (isReturn && BigInt(s.quarantine) > 0n))
    )
  );
  return (
    <div className={incoming ? "" : "content-grid"}>
      <Card title={incoming ? "Incoming shipments" : "Custody history"}>
        <DataTable
          headers={["Lot / route", "Quantity", "Status", "Decision"]}
          rows={rows.map((s) => [
            <div>
              <strong>{lot(s.lotId)?.lotNumber}</strong>
              <small className="block-muted">
                {org(s.fromOrgId)} → {org(s.toOrgId)}
              </small>
            </div>,
            s.quantity,
            <Badge tone={s.status === "pending" ? "warn" : ""}>
              {s.status}
            </Badge>,
            s.status === "pending" && s.toOrgId === d.user.orgId ? (
              <div className="inline-actions">
                <Action
                  className="small"
                  onClick={async () => {
                    await run("receive", {
                      shipmentId: s.id,
                      action: "accept",
                    });
                    return "Accepted custody recorded.";
                  }}
                >
                  Accept
                </Action>
                <Action
                  className="outline small"
                  onClick={async () => {
                    await run("receive", {
                      shipmentId: s.id,
                      action: "reject",
                      reason: "Recipient rejected the shipment",
                    });
                    return "Shipment rejected; sender stock restored.";
                  }}
                >
                  Reject
                </Action>
              </div>
            ) : (
              "—"
            ),
          ])}
        />
      </Card>
      {!incoming && (
        <Card
          title={
            isReturn ? "Return to an approved supplier" : "Create a shipment"
          }
        >
          <Form
            label={
              isReturn ? "Commit return shipment" : "Commit outbound shipment"
            }
            onSubmit={async (v, form) => {
              let doc;
              const f = form.elements.manifest.files[0];
              if (f) doc = await upload(f, false);
              const result = await run("ship", {
                ...v,
                kind: isReturn ? "return" : "shipment",
                documentId: doc?.id,
              });
              setReceipt(result.shipment);
              return "Shipment committed. Stock is in transit until the recipient resolves it.";
            }}
          >
            <Field label="Held stock">
              <LotSelect lots={lots} />
            </Field>
            <Field label="Recipient">
              <select name="toOrgId" required defaultValue="">
                <option value="" disabled>
                  Select approved recipient
                </option>
                {d.organizations
                  .filter(
                    (o) =>
                      ["manufacturer", "distributor", "pharmacy"].includes(
                        o.type
                      ) && o.id !== d.user.orgId
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Quantity in base units">
              <input name="quantity" type="number" min="1" required />
            </Field>
            {isReturn && (
              <Field label="Return reason">
                <input name="reason" required />
              </Field>
            )}
            <Field label="Shipping manifest">
              <input name="manifest" type="file" />
            </Field>
          </Form>
          {receipt && (
            <div className="receipt-box">
              <strong>Committed shipment</strong>
              <span className="mono">{receipt.id}</span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
function Losses({ d, run }) {
  return (
    <Card title="Record documented shrinkage">
      <Form
        label="Record stock loss"
        onSubmit={async (v) => {
          await run("shrinkage", v);
          return "Stock loss recorded with its reason.";
        }}
      >
        <div className="form-columns">
          <Field label="Lot">
            <LotSelect
              lots={d.lots.filter((l) =>
                d.stocks.some((s) => s.lotId === l.id)
              )}
            />
          </Field>
          <Field label="Stock bucket">
            <select name="bucket">
              <option value="available">Available</option>
              <option value="quarantine">Quarantined</option>
            </select>
          </Field>
        </div>
        <Field label="Quantity">
          <input name="quantity" type="number" min="1" required />
        </Field>
        <Field label="Evidence and reason">
          <textarea
            name="reason"
            required
            placeholder="Breakage, loss or documented destruction…"
          />
        </Field>
      </Form>
    </Card>
  );
}
function Prescribe({ d, run }) {
  const [issued, setIssued] = useState(null);
  return (
    <div className="content-grid">
      <Card title="Issue a product permit">
        <Form
          label="Sign and issue permit"
          onSubmit={async (v) => {
            const { newPermit } = await import("@lotus/sdk");
            const credential = newPermit();
            const result = await run("issuePermit", {
              ...v,
              expiry: Math.floor(
                new Date(v.expiry + "T23:59:59").getTime() / 1000
              ),
              holderCommit: credential.holderCommit,
            });
            setIssued({
              ...result.permit,
              permitSecret: credential.permitSecret,
              network: d.network,
              v: 2,
            });
            return "Prescription issued. Hand over the protected credential to the patient.";
          }}
        >
          <div className="form-columns">
            <Field label="Code namespace">
              <select name="namespace">
                <option>NDC</option>
                <option>GTIN</option>
                <option>LOCAL</option>
              </select>
            </Field>
            <Field label="Product code">
              <input name="code" required list="product-codes" />
              <datalist id="product-codes">
                {d.lots.map((l) => (
                  <option key={l.id} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Authorized base units">
            <input name="quantity" type="number" min="1" required />
          </Field>
          <Field label="Valid through">
            <input name="expiry" type="date" required />
          </Field>
        </Form>
      </Card>
      <Card
        title="Protected patient handover"
        subtitle="This credential belongs with the patient, not in analytics or a public document."
      >
        {issued ? (
          <>
            <div className="qr-wrap">
              <QRCodeSVG value={JSON.stringify(issued)} size={210} />
            </div>
            <p className="muted">
              {issued.quantity} units · {issued.code} · valid through{" "}
              {date(issued.expiry)}
            </p>
            <textarea
              readOnly
              value={JSON.stringify(issued)}
              aria-label="Prescription code"
            />
            <button
              className="button subtle"
              onClick={() =>
                navigator.clipboard.writeText(JSON.stringify(issued))
              }
            >
              Copy protected code
            </button>
          </>
        ) : (
          <Empty icon="scan">
            Issue a permit to create the patient handover code.
          </Empty>
        )}
      </Card>
    </div>
  );
}
function Permits({ d }) {
  return (
    <Card title="Authorized permit view">
      <DataTable
        headers={[
          "Product",
          "Original quantity",
          "Remaining",
          "Expiry",
          "Pharmacy binding",
        ]}
        rows={d.permits.map((p) => [
          `${p.namespace} ${p.code}`,
          p.quantity,
          p.balance,
          date(p.expiry),
          d.organizations.find((o) => o.id === p.boundOrgId)?.name ||
            "Not yet bound",
        ])}
      />
    </Card>
  );
}
function Counter({ d, run }) {
  const [scannedLotId, setScannedLotId] = useState("");
  const [code, setCode] = useState(null),
    [receipt, setReceipt] = useState(null),
    [queue, setQueue] = useState([]),
    [error, setError] = useState("");
  const draftId = `fills_${d.user.id}`;
  useEffect(() => {
    api(`/drafts/${draftId}`)
      .then((r) => setQueue(r.draft?.items || []))
      .catch((e) => setError(e.message));
  }, [draftId]);
  const persist = async (items) => {
    await api(`/drafts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    });
    setQueue(items);
  };
  const read = (text) => {
    try {
      const parsed = JSON.parse(text);
      if (
        !parsed.permitId ||
        !parsed.permitSecret ||
        !parsed.commitment ||
        parsed.network !== d.network
      )
        throw new Error();
      setCode(parsed);
      setError("");
    } catch {
      setError("This is not a valid patient code for this network.");
    }
  };
  const lots = d.lots.filter(
    (l) =>
      !l.recallId &&
      l.expiry > Date.now() / 1000 &&
      d.stocks.some(
        (s) =>
          s.orgId === d.user.orgId &&
          s.lotId === l.id &&
          BigInt(s.available) > 0n
      )
  );
  return (
    <>
      <div className="steps">
        <span className={code ? "complete" : ""}>1 Patient code</span>
        <span>2 Shelf pack</span>
        <span>3 Confirm fill</span>
        <span>4 Recorded receipt</span>
      </div>
      <div className="content-grid">
        <Card title="Dispense at the counter">
          <Message error={error} />
          {code ? (
            <div className="code-accepted">
              <Icon name="check" />
              <div>
                <strong>Protected code received</strong>
                <small>No patient root secret is included.</small>
              </div>
              <button className="text-button" onClick={() => setCode(null)}>
                Clear
              </button>
            </div>
          ) : (
            <QrScanner label="Scan patient code" onResult={read} />
          )}
          <Form
            label="Validate and record fill"
            onSubmit={async (v) => {
              if (!code) throw new Error("Scan the patient code first.");
              const item = {
                ...v,
                permitId: code.permitId,
                permitSecret: code.permitSecret,
                commitment: code.commitment,
              };
              if (v.mode === "batch") {
                await persist([...queue, item]);
                setCode(null);
                return "Draft saved durably. Handover is pending until the batch commits.";
              }
              const result = await run("dispense", item);
              setReceipt(result.receipt);
              setCode(null);
              return "Fill committed. Verify the receipt, then hand over the medicine.";
            }}
          >
            <Field label="Scanned shelf lot">
              <LotSelect
                lots={lots}
                value={scannedLotId}
                onChange={(e) => setScannedLotId(e.target.value)}
              />
            </Field>
            <QrScanner
              label="Scan shelf pack"
              onResult={(value) => {
                try {
                  const code = parsePackCode(value);
                  const match = lots.find(
                    (l) =>
                      l.code === code.code &&
                      l.namespace === code.namespace &&
                      l.lotNumber === code.lotNumber
                  );
                  if (!match)
                    throw new Error("Scanned lot is not eligible held stock.");
                  setScannedLotId(match.id);
                  setError("");
                } catch (e) {
                  setError(e.message);
                }
              }}
            />
            <Field label="Quantity in base units">
              <input name="quantity" type="number" min="1" required />
            </Field>
            <Field label="Submission">
              <select name="mode">
                <option value="single">Record this fill now</option>
                <option value="batch">Save to atomic batch</option>
              </select>
            </Field>
          </Form>
        </Card>
        <Card
          title={receipt ? "Recorded patient receipt" : "Durable draft batch"}
        >
          {receipt ? (
            <>
              <Badge>Recorded · ready for handover</Badge>
              <div className="qr-wrap">
                <QRCodeSVG
                  value={JSON.stringify({ v: 2, type: "receipt", ...receipt })}
                  size={190}
                />
              </div>
              <textarea
                readOnly
                value={JSON.stringify({ v: 2, type: "receipt", ...receipt })}
                aria-label="Recorded receipt code"
              />
              <p className="muted">
                Patient scans this receipt into their private browser vault.
              </p>
              <button
                className="button subtle small"
                onClick={() => setReceipt(null)}
              >
                Back to draft batch
              </button>
            </>
          ) : (
            <>
              <div className="batch-number">
                {queue.length}
                <span>pending fills</span>
              </div>
              <p className="muted">
                Combined stock, permit balances and one-time commitments are
                validated atomically. No draft permits handover.
              </p>
              {queue.length > 0 && (
                <>
                  <Action
                    disabled={!queue.length}
                    onClick={async () => {
                      const result = await run("dispenseBatch", {
                        items: queue,
                      });
                      await persist([]);
                      setReceipt(result.receipts[0]);
                      download("lotus-batch-receipts.json", result.receipts);
                      return "Entire batch committed. Receipt package downloaded.";
                    }}
                  >
                    Submit atomic batch
                    <Icon name="arrow" size={16} />
                  </Action>
                  <Action
                    className="outline small"
                    onClick={async () => {
                      await persist([]);
                      return "Drafts removed; no stock was changed.";
                    }}
                  >
                    Clear drafts
                  </Action>
                </>
              )}
            </>
          )}
        </Card>
      </div>
      <Card
        title="Recorded fill history"
        subtitle="Recover a signed receipt after a reload without dispensing twice."
      >
        <DataTable
          headers={["Medicine / lot", "Units", "Recorded", "Receipt"]}
          rows={[...d.receipts]
            .sort((a, b) => b.at - a.at)
            .slice(0, 20)
            .map((r) => [
              d.lots.find((l) => l.id === r.lotId)?.lotNumber,
              r.quantity,
              date(r.at),
              <Action
                className="subtle small"
                onClick={async () => {
                  setReceipt((await api(`/receipts/${r.id}`)).receipt);
                  return "Committed receipt reissued. Stock and permit balances were not changed.";
                }}
              >
                Reissue receipt
              </Action>,
            ])}
        />
      </Card>
    </>
  );
}
function Transfers({ d, run }) {
  const [code, setCode] = useState(null),
    [error, setError] = useState("");
  return (
    <Card title="Patient-requested pharmacy transfer">
      <QrScanner
        label="Scan prescription credential"
        onResult={(text) => {
          try {
            const p = JSON.parse(text);
            if (!p.id || !p.permitSecret) throw new Error();
            setCode(p);
            setError("");
          } catch {
            setError("Use the prescription credential from the patient vault.");
          }
        }}
      />
      <Message error={error} />
      {code && <Badge>Credential received · {code.code}</Badge>}
      <Form
        label="Transfer remaining balance"
        onSubmit={async (v) => {
          if (!code) throw new Error("Scan the patient credential.");
          await run("transferPermit", {
            permitId: code.id,
            permitSecret: code.permitSecret,
            toOrgId: v.toOrgId,
          });
          return "Balance transferred. This pharmacy can no longer redeem it.";
        }}
      >
        <Field label="Target pharmacy">
          <select name="toOrgId" required defaultValue="">
            <option value="" disabled>
              Select pharmacy
            </option>
            {d.organizations
              .filter((o) => o.type === "pharmacy" && o.id !== d.user.orgId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </Field>
      </Form>
    </Card>
  );
}
function Recalls({ d, run }) {
  return (
    <div className="content-grid">
      <Card title="Issued decisions">
        <DataTable
          headers={[
            "Medicine / lot",
            "Class",
            "Affected units",
            "Dispense records",
            "Acknowledgements",
            "Stopped",
            "Returned",
            "Consulted",
          ]}
          rows={d.recalls.map((r) => [
            d.lots.find((l) => l.id === r.lotId)?.lotNumber,
            ["", "I", "II", "III"][r.classification],
            d.lots.find((l) => l.id === r.lotId)?.dispensedUnits || "0",
            r.cutoffRecords,
            r.acks,
            r.actions[1],
            r.actions[2],
            r.actions[3],
          ])}
        />
        <p className="table-note">
          Acknowledgements are counted per root secret. They are not a
          percentage of distinct patients reached.
        </p>
      </Card>
      <Card title="Issue an immutable recall">
        <Form
          label="Issue authorized recall"
          onSubmit={async (v, form) => {
            let doc;
            const f = form.elements.notice.files[0];
            if (f) doc = await upload(f, true);
            await run("recall", {
              ...v,
              documentId: doc?.id,
              fromSignal: v.basis === "signal",
            });
            return "Recall committed. Future dispensing is blocked and patient browsers can match the notice.";
          }}
        >
          <Field label="Exact lot">
            <LotSelect lots={d.lots.filter((l) => !l.recallId)} />
          </Field>
          <div className="form-columns">
            <Field label="Classification">
              <select name="classification">
                <option value="1">Class I</option>
                <option value="2">Class II</option>
                <option value="3">Class III</option>
              </select>
            </Field>
            <Field label="Basis">
              <select name="basis">
                <option value="manual">Authority decision</option>
                <option value="signal">Safety investigation</option>
                <option value="import">Imported official notice</option>
              </select>
            </Field>
          </div>
          <Field label="Reason">
            <textarea name="reason" required maxLength={2000} />
          </Field>
          <Field label="Approved patient instructions">
            <textarea name="instructions" required maxLength={2000} />
          </Field>
          <Field label="Full notice">
            <input name="notice" type="file" />
          </Field>
        </Form>
      </Card>
    </div>
  );
}
function Investigations({ d }) {
  const [opened, setOpened] = useState(null);
  return (
    <>
      <div className="metrics-grid three">
        <Metric label="Verified reports" value={d.reports.length} />
        <Metric
          label="Threshold signals"
          value={d.lots.filter((l) => l.safetySignal).length}
          tone="warn"
          icon="bell"
        />
        <Metric label="Active recalls" value={d.recalls.length} icon="shield" />
      </div>
      <Card title="Protected report inbox">
        <DataTable
          headers={["Product / lot", "Severity", "Received", "Evidence"]}
          rows={d.reports.map((r) => [
            d.lots.find((l) => l.id === r.lotId)?.lotNumber,
            `${r.severity} / 5`,
            date(r.at),
            <Action
              className="subtle small"
              onClick={async () => {
                setOpened(await api(`/reports/${r.id}`));
                return "Narrative decrypted within the authorized safety workspace.";
              }}
            >
              Open protected report
            </Action>,
          ])}
        />
      </Card>
      {opened && (
        <Card title="Authorized narrative">
          <p className="report-text">{opened.text}</p>
          <p className="table-note">
            Membership establishes eligibility to report; it does not establish
            causation.
          </p>
        </Card>
      )}
    </>
  );
}
function Regions({ d }) {
  return (
    <>
      <div className="callout">
        <Icon name="shield" />
        <p>
          Counts describe dispense records, not distinct people. Small cells and
          complementary cells are suppressed together.
        </p>
      </div>
      {d.regions.length ? (
        d.regions.map((r) => (
          <Card
            key={r.recallId}
            title={`Recall · ${
              d.lots.find(
                (l) =>
                  l.id === d.recalls.find((rc) => rc.id === r.recallId)?.lotId
              )?.lotNumber
            }`}
          >
            <DataTable
              headers={["Region", "Dispense records", "Privacy release"]}
              rows={r.cells.map((c) => [
                `Region ${c.region}`,
                c.suppressed ? "Hidden" : c.records,
                <Badge tone={c.suppressed ? "warn" : ""}>
                  {c.suppressed ? "Suppressed" : "Released"}
                </Badge>,
              ])}
            />
          </Card>
        ))
      ) : (
        <Card>
          <Empty icon="shield">
            A regional release becomes available after a lot recall.
          </Empty>
        </Card>
      )}
    </>
  );
}
function Imports({ d }) {
  const [imports, setImports] = useState([]);
  const refresh = () => api("/imports").then((r) => setImports(r.imports));
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div className="content-grid">
      <Card title="Source notice imports">
        {imports.length ? (
          imports.map((i) => (
            <div key={i.id}>
              {i.items.map((item, n) => (
                <div className="import-row" key={n}>
                  <strong>
                    {item.source.recall_number || "Source notice"}
                  </strong>
                  <Badge tone={item.status === "unresolved" ? "warn" : ""}>
                    {item.status === "unresolved"
                      ? "Unresolved"
                      : "Exact candidates"}
                  </Badge>
                  <p>{item.source.reason_for_recall}</p>
                  <small>
                    {item.lotIds.length} exact lot matches · no automatic recall
                  </small>
                </div>
              ))}
            </div>
          ))
        ) : (
          <Empty icon="file">
            Import source records to review exact product and lot matches.
          </Empty>
        )}
      </Card>
      <Card
        title="Import official source JSON"
        subtitle="Paste an array of openFDA notice records. Unparseable or unrelated scope stays unresolved."
      >
        <Action
          className="subtle"
          onClick={async () => {
            const source = await post("/imports/fetch", {});
            await post("/imports", { events: source.events });
            await refresh();
            return `Imported ${source.events.length} official source notices. Exact scope still requires review.`;
          }}
        >
          Fetch official openFDA notices
          <Icon name="file" size={16} />
        </Action>
        <Form
          label="Resolve exact candidates"
          onSubmit={async (v) => {
            let events;
            try {
              events = JSON.parse(v.source);
            } catch {
              throw new Error("Enter a valid JSON array.");
            }
            await post("/imports", { events });
            await refresh();
            return "Source notices imported with provenance; no recall was issued.";
          }}
        >
          <Field label="Source records">
            <textarea
              name="source"
              required
              rows={12}
              placeholder={
                '[{"recall_number":"…","product_ndc":["…"],"code_info":"Lot …"}]'
              }
            />
          </Field>
        </Form>
      </Card>
    </div>
  );
}
function ReplayLab({ d, refresh }) {
  const [eventIndex, setEventIndex] = useState(0),
    [comparison, setComparison] = useState(null);
  const event = sourceSamples.events?.[eventIndex];
  return (
    <Card
      title="Isolated recall replay"
      subtitle={
        sourceSamples.sample
          ? "Illustrative offline source events. Fetch or regenerate the source file for real notices."
          : "Imported openFDA source events."
      }
    >
      {!d.sandbox ? (
        <Empty icon="shield" title="Use the isolated sandbox">
          This workspace cannot replay notices onto live inventory. Start the
          separate sandbox profile, register the exact source lots, and sign in
          as its safety authority.
        </Empty>
      ) : event ? (
        <>
          <div className="callout">
            <Icon name="shield" />
            <p>
              Sandbox inventory only. Unrelated lots are never chosen as a
              fallback.
            </p>
          </div>
          <Field label="Source notice">
            <select
              value={eventIndex}
              onChange={(e) => {
                setEventIndex(Number(e.target.value));
                setComparison(null);
              }}
            >
              {sourceSamples.events.map((e, i) => (
                <option value={i} key={i}>
                  {e.recall_number} · {e.classification}
                </option>
              ))}
            </select>
          </Field>
          <h3>{event.product_description}</h3>
          <p className="muted">{event.reason_for_recall}</p>
          <p className="table-note">Source lot scope: {event.code_info}</p>
          <Action
            onClick={async () => {
              const result = await post("/sandbox/replay", { event });
              setComparison(result);
              await refresh();
              return `${result.recalled.length} exact lot decisions recorded in the sandbox.`;
            }}
          >
            Replay exact matched lots
          </Action>
          {comparison && (
            <div className="metrics-grid">
              <Metric
                label="Product-code records"
                value={comparison.productRecords}
                hint="Any lot of the matched product"
              />
              <Metric
                label="Exact-lot records"
                value={comparison.exactRecords}
                hint="Only source-named lots"
              />
            </div>
          )}
        </>
      ) : (
        <Empty>No source events are available.</Empty>
      )}
    </Card>
  );
}
function Integrations() {
  const [info, setInfo] = useState(null),
    [error, setError] = useState("");
  const refresh = () =>
    api("/integrations")
      .then(setInfo)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  return (
    <>
      <Message error={error} />
      <button className="button subtle" onClick={refresh}>
        Check connections
      </button>
      {!info ? (
        <Empty title="Checking integration evidence" />
      ) : (
        <>
          <div className="metrics-grid">
            <Metric
              label="Application ledger"
              value={info.ledger === "fabric" ? "Fabric" : "Local ledger"}
              hint={info.network}
            />
            <Metric
              label="FireFly gateway"
              value={
                info.firefly.connected
                  ? "Connected"
                  : info.firefly.configured
                  ? "Unavailable"
                  : "Not selected"
              }
              hint="Contract API and durable commit events"
            />
            <Metric
              label="Caliper"
              value={info.caliper ? "Measured" : "Not run"}
              hint="Recorded run on an isolated Fabric channel"
            />
            <Metric
              label="Brownie"
              value={info.brownie ? "Reference measured" : "Not run"}
              hint="Solidity regression and EVM gas reference"
            />
            <Metric
              label="Document storage"
              value={
                info.documentStorage.type === "ipfs"
                  ? "IPFS"
                  : "Encrypted database"
              }
              hint={
                info.documentStorage.connected ? "Connected" : "Unavailable"
              }
            />
          </div>
          <Card
            title="Fabric transaction measurements"
            subtitle="Historical integration measurements. This screen does not measure current production capacity."
          >
            {info.caliper ? (
              <>
                <DataTable
                  headers={[
                    "Operation",
                    "Successful",
                    "Failed",
                    "Mean latency",
                    "95th percentile",
                  ]}
                  rows={Object.entries(info.caliper.rounds).map(([kind, r]) => [
                    kind,
                    r.successful,
                    r.failed,
                    `${r.meanLatencyMs.toFixed(0)} ms`,
                    `${r.p95LatencyMs.toFixed(0)} ms`,
                  ])}
                />
                <p>{info.caliper.scope}</p>
                <button
                  className="button subtle"
                  onClick={() =>
                    download("lotus-caliper-measurements.json", info.caliper)
                  }
                >
                  Download measurement summary
                </button>
              </>
            ) : (
              <Empty title="No Caliper result yet">
                Run the isolated Fabric benchmark to publish its measured
                results here.
              </Empty>
            )}
          </Card>
          <Card
            title="Solidity reference costs"
            subtitle="Brownie executes the original EVM contracts used for migration regression."
          >
            {info.brownie ? (
              <>
                <DataTable
                  headers={["Operation", "Gas used"]}
                  rows={Object.entries(info.brownie.gas).map(
                    ([name, value]) => [
                      name.replaceAll("_", " "),
                      value.toLocaleString(),
                    ]
                  )}
                />
                <p>{info.brownie.scope}</p>
                <button
                  className="button subtle"
                  onClick={() =>
                    download("lotus-brownie-gas-reference.json", info.brownie)
                  }
                >
                  Download gas reference
                </button>
              </>
            ) : (
              <Empty title="No Brownie result yet" />
            )}
          </Card>
          <Card title="FireFly workflow verification">
            {info.verification ? (
              <p>
                {info.verification.checks} checks completed on{" "}
                {info.verification.channel}. Verified{" "}
                {new Date(info.verification.checkedAt).toLocaleString()}.
              </p>
            ) : (
              <p>
                No FireFly acceptance result has been recorded on this computer.
              </p>
            )}
            <p>
              Patient matching stays in the encrypted browser vault.
              Prescription credentials travel through Fabric transient data so
              FireFly cannot persist them in its operation history.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
function Audit() {
  const [rows, setRows] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/audit")
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Card title="Application operation journal">
      <Message error={error} />
      <DataTable
        headers={["Sequence", "Operation", "Request", "Time"]}
        rows={rows.map((r) => [
          r.seq,
          r.command,
          <span className="mono">{r.requestId.slice(0, 16)}…</span>,
          new Date(r.at * 1000).toLocaleString(),
        ])}
      />
      <button
        className="button subtle"
        onClick={() => download("lotus-operation-journal.json", rows)}
      >
        Export scoped journal
        <Icon name="file" size={16} />
      </button>
    </Card>
  );
}
function Verify() {
  const [result, setResult] = useState(null);
  const [scanned, setScanned] = useState(null),
    [scanError, setScanError] = useState("");
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="verify-main">
        <PageTitle
          eyebrow="Public verification · no account"
          title="Check the record behind your medicine."
        >
          Confirm registered lot status, expiry and official recalls. A batch
          lookup cannot establish physical pack authenticity.
        </PageTitle>
        <Card>
          <QrScanner
            label="Scan medicine pack"
            onResult={(value) => {
              try {
                setScanned(parsePackCode(value));
                setResult(null);
                setScanError("");
              } catch (e) {
                setScanError(e.message);
              }
            }}
          />
          <Message error={scanError} />
          <Form
            key={scanned ? JSON.stringify(scanned) : "manual"}
            label="Check lot status"
            onSubmit={async (v) => {
              setResult(null);
              const r = await api(
                `/public/verify?code=${encodeURIComponent(
                  v.code
                )}&lot=${encodeURIComponent(v.lot)}&namespace=${v.namespace}`
              );
              setResult(r);
              return "Registry check completed.";
            }}
          >
            <div className="form-columns three">
              <Field label="Code namespace">
                <select
                  name="namespace"
                  defaultValue={scanned?.namespace || "NDC"}
                >
                  <option>NDC</option>
                  <option>GTIN</option>
                  <option>LOCAL</option>
                </select>
              </Field>
              <Field label="Product code">
                <input
                  name="code"
                  defaultValue={scanned?.code || ""}
                  required
                />
              </Field>
              <Field label="Lot number">
                <input
                  name="lot"
                  defaultValue={scanned?.lotNumber || ""}
                  required
                />
              </Field>
            </div>
          </Form>
        </Card>
        {result && (
          <>
            {result.matches.length ? (
              result.matches.map((l) => (
                <Card
                  key={l.id}
                  className={l.recallId ? "recall-panel" : ""}
                  title={
                    l.recallId
                      ? "This lot has an official recall"
                      : l.expiry < Date.now() / 1000
                      ? "Registered lot · expired"
                      : "Registered lot"
                  }
                >
                  <div className="verify-product">
                    <span className="product-glyph large">
                      <Icon name="box" size={32} />
                    </span>
                    <div>
                      <h3>{l.name}</h3>
                      <p>
                        {l.namespace} {l.code} · lot {l.lotNumber}
                      </p>
                    </div>
                  </div>
                  <div className="detail-grid">
                    <div>
                      <span>Manufacturer</span>
                      <strong>{l.manufacturer}</strong>
                    </div>
                    <div>
                      <span>Expiry</span>
                      <strong>{date(l.expiry)}</strong>
                    </div>
                    <div>
                      <span>Last checked</span>
                      <strong>
                        {new Date(result.checkedAt).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                  <div className="custody-summary">
                    <h3>Approved custody summary</h3>
                    {result.custody
                      ?.filter((s) => s.lotId === l.id)
                      .map((s, i) => (
                        <div className="custody-step" key={i}>
                          <Icon name="box" size={18} />
                          <span>
                            {s.fromRole} → {s.toRole}
                          </span>
                          <Badge tone={s.status === "pending" ? "warn" : ""}>
                            {s.status}
                          </Badge>
                        </div>
                      ))}
                    {!result.custody?.some((s) => s.lotId === l.id) && (
                      <p className="muted">
                        Manufacturer registration recorded; no onward shipment
                        recorded.
                      </p>
                    )}
                    <p className="table-note">
                      Institution roles and custody status are public. Counter
                      details, quantities and pharmacy identities are withheld.
                    </p>
                  </div>
                  {l.recallId && (
                    <div className="notice-text">
                      <strong>Official instructions</strong>
                      <p>
                        {
                          result.recalls.find((r) => r.lotId === l.id)
                            ?.instructions
                        }
                      </p>
                    </div>
                  )}
                  {l.documentId && (
                    <a
                      className="text-link"
                      href={`/api/documents/${l.documentId}`}
                    >
                      Download approved certificate
                      <Icon name="file" size={17} />
                    </a>
                  )}
                  <p className="table-note">
                    A copied label can pass this lookup. Contact a pharmacist if
                    the pack or source seems suspicious.
                  </p>
                </Card>
              ))
            ) : (
              <Card title="This lot could not be verified">
                <p>
                  The product and lot were not found in this registry. Coverage
                  may be incomplete; a counterfeit is also possible. Ask your
                  pharmacy to verify the source.
                </p>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
