import { BrowserProvider, Contract, JsonRpcProvider, id as keccakId } from "ethers";

const generated = import.meta.glob("../generated/*.json", { eager: true, import: "default" });
export const deployment = generated["../generated/deployment.json"] ?? null;
export const demoPatient = generated["../generated/demo-patient.json"] ?? null;

export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
export const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://127.0.0.1:8787";

/** Demo identities = Hardhat default accounts, in the order scripts/seed-demo.js registers them. */
export const DEMO_ACCOUNTS = {
  admin: 0, manufacturer: 1, distributor: 2, pharmacyA: 3, pharmacyB: 4, pharmacyC: 5, prescriber: 6, regulator: 7,
};

export const ROLE = Object.fromEntries(
  ["MANUFACTURER", "DISTRIBUTOR", "PHARMACY", "PRESCRIBER", "REGULATOR"].map((r) => [r, keccakId(r)])
);

let readProvider;
export function provider() {
  readProvider ??= new JsonRpcProvider(RPC_URL);
  return readProvider;
}

/** Signer for a role. Demo mode uses unlocked Hardhat accounts; set VITE_USE_WALLET=1 for MetaMask. */
export async function signerFor(accountIndex) {
  if (import.meta.env.VITE_USE_WALLET && window.ethereum) {
    return new BrowserProvider(window.ethereum).getSigner();
  }
  return provider().getSigner(accountIndex);
}

export function contract(name, runner = provider()) {
  if (!deployment) throw new Error("No deployment found. Run `npm run deploy:local` first.");
  const c = deployment.contracts[name];
  return new Contract(c.address, c.abi, runner);
}

export async function asRole(name, accountIndex) {
  return contract(name, await signerFor(accountIndex));
}

export const short = (x) => (x ? `${String(x).slice(0, 8)}…${String(x).slice(-6)}` : "—");
export const fmtDate = (ts) => new Date(Number(ts) * 1000).toLocaleDateString();
export const errMsg = (e) => e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);

/** All Dispensed events, the patient's local matching input. */
export async function fetchDispensed() {
  const d = contract("dispenses");
  const logs = await d.queryFilter(d.filters.Dispensed(), 0);
  return logs.map((l) => ({
    lotKey: l.args.lotKey,
    pharmacy: l.args.pharmacyPseudonym,
    region: Number(l.args.region),
    qty: Number(l.args.qty),
    commitment: l.args.commitment,
    leafIndex: Number(l.args.leafIndex),
    block: l.blockNumber,
  }));
}

export async function fetchLots() {
  const b = contract("batches");
  const logs = await b.queryFilter(b.filters.LotRegistered(), 0);
  return logs.map((l) => ({
    lotKey: l.args.lotKey, ndc: l.args.ndc, lotNumber: l.args.lotNumber, expiry: Number(l.args.expiry),
    units: Number(l.args.units), manufacturer: l.args.manufacturer,
  }));
}

export async function fetchRecalls() {
  const r = contract("recalls");
  const logs = await r.queryFilter(r.filters.RecallIssued(), 0);
  return logs.map((l) => ({
    recallId: Number(l.args.recallId), lotKey: l.args.lotKey, ndc: l.args.ndc, lotNumber: l.args.lotNumber,
    classification: Number(l.args.classification), fromCrowdSignal: l.args.fromCrowdSignal, block: l.blockNumber,
  }));
}

export const STATUS = ["None", "Pending", "Accepted", "Rejected"];

export async function fetchShipments() {
  const c = contract("custody");
  const n = Number(await c.shipmentCount());
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = await c.getShipment(i);
    out.push({ id: i, lotKey: s.lotKey, from: s.from, to: s.to, qty: Number(s.qty), status: STATUS[Number(s.status)], createdAt: Number(s.createdAt) });
  }
  return out;
}

export async function addressOf(accountIndex) {
  return (await signerFor(accountIndex)).getAddress();
}
