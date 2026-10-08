import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

/**
 * Gasless relayer (feature D). Patients send their zero-knowledge proof here; the relayer pays gas
 * and submits it. The relayer learns nothing: the proof hides which dispense is the patient's, and
 * the nullifier is unlinkable to the patient's identity.
 */
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// Relative paths are taken from the repository root.
const DEPLOYMENT = path.resolve(REPO, process.env.DEPLOYMENT || "contracts/deployments/localhost.json");
// Hardhat account #9 by default (local development only).
const KEY = process.env.RELAYER_KEY || "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const PORT = Number(process.env.PORT || 8787);

const dep = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
const wallet = new Wallet(KEY, new JsonRpcProvider(RPC_URL));
const signals = new Contract(dep.contracts.signals.address, dep.contracts.signals.abi, wallet);

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function relay(res, fn) {
  try {
    const tx = await fn();
    const receipt = await tx.wait();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.shortMessage || e.message });
  }
}

app.post("/report", (req, res) => {
  const { lotKey, root, nullifierHash, severity, reportCid, proof } = req.body;
  relay(res, () => signals.reportAdverseEvent(lotKey, root, nullifierHash, severity, reportCid, proof));
});

app.post("/ack", (req, res) => {
  const { recallId, root, nullifierHash, action, proof } = req.body;
  relay(res, () => signals.acknowledgeRecall(recallId, root, nullifierHash, action, proof));
});

app.get("/health", (_req, res) => res.json({ ok: true, relayer: wallet.address }));

app.listen(PORT, () => console.log(`LOTUS relayer on :${PORT} as ${wallet.address}`));
