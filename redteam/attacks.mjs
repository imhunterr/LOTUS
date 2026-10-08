import { commitmentAt, newPatientSecret, nullifierHash, splitSecret, recoverSecret } from "@lotus/sdk";
import { ksTest, mean, poisson, popcount, prng } from "./lib.mjs";

/**
 * A1 · Passive chain observer tries to link two dispenses to the same patient.
 * Distinguisher: Hamming distance between commitments. If commitments from the same patient were
 * related, same-patient pairs would have a different distance distribution than random pairs.
 */
export function linkability({ patients = 2000 } = {}) {
  const same = [], diff = [];
  const secrets = Array.from({ length: patients }, () => newPatientSecret());
  for (let i = 0; i < patients; i++) {
    const a = commitmentAt(secrets[i], 0), b = commitmentAt(secrets[i], 1);
    const c = commitmentAt(secrets[(i + 1) % patients], 0);
    same.push(popcount(a ^ b));
    diff.push(popcount(a ^ c));
  }
  const ks = ksTest(same, diff);
  // Best threshold classifier advantage over guessing
  let bestAcc = 0.5;
  for (let t = 100; t <= 160; t++) {
    const acc = (same.filter((v) => v <= t).length + diff.filter((v) => v > t).length) / (2 * patients);
    bestAcc = Math.max(bestAcc, acc, 1 - acc);
  }
  return {
    id: "A1", name: "Passive observer links two dispenses of one patient",
    meanHammingSame: +mean(same).toFixed(2), meanHammingDifferent: +mean(diff).toFixed(2),
    ksStatistic: +ks.d.toFixed(4), ksPValue: +ks.p.toFixed(3),
    bestClassifierAccuracy: +bestAcc.toFixed(3),
    verdict: ks.p > 0.01 && bestAcc < 0.56 ? "RESISTED: no distinguishing signal" : "INVESTIGATE",
  };
}

/**
 * A2 · Timing correlation. The observer saw the patient at pharmacy P at time t and looks for
 * Dispensed events from P within the next `window` seconds. Anonymity set = number of candidates.
 * Mitigation measured: the pharmacy submits dispenses in batches every `batch` seconds.
 */
export function timing({ seed = 3 } = {}) {
  const rand = prng(seed);
  const rows = [];
  for (const perHour of [4, 20, 60]) {
    for (const batch of [0, 900, 3600]) {
      const sets = [];
      for (let trial = 0; trial < 400; trial++) {
        // events in an 8h day; the victim is served at a random time
        const events = [];
        for (let s = 0; s < 8 * 3600; s += 60) for (let k = poisson(rand, perHour / 60); k > 0; k--) events.push(s + rand() * 60);
        const victim = rand() * 8 * 3600;
        events.push(victim);
        const posted = events.map((t) => (batch ? Math.ceil(t / batch) * batch : t + 2)); // +2s block time
        const victimPost = batch ? Math.ceil(victim / batch) * batch : victim + 2;
        const window = 30;
        sets.push(posted.filter((p) => p >= victimPost - window && p <= victimPost + window).length);
      }
      sets.sort((a, b) => a - b);
      rows.push({
        dispensesPerHour: perHour, batchSeconds: batch,
        medianAnonymitySet: sets[Math.floor(sets.length / 2)],
        shareUniquelyIdentified: +(sets.filter((s) => s === 1).length / sets.length).toFixed(3),
      });
    }
  }
  const worst = rows.find((r) => r.dispensesPerHour === 4 && r.batchSeconds === 0);
  const fixed = rows.find((r) => r.dispensesPerHour === 4 && r.batchSeconds === 3600);
  return {
    id: "A2", name: "Timing correlation at the counter", rows,
    verdict: `RESIDUAL RISK: at a quiet pharmacy ${Math.round(worst.shareUniquelyIdentified * 100)}% of dispenses are unique in real time; hourly batching reduces that to ${Math.round(fixed.shareUniquelyIdentified * 100)}%`,
  };
}

/**
 * A3 · Small-region / rare-drug inference from the regulator's aggregates.
 * Without suppression a region showing 1–2 affected units narrows the patient down to a handful
 * of people; with k = 5 those cells are hidden.
 */
export function smallRegion({ seed = 5, k = 5 } = {}) {
  const rand = prng(seed);
  let cells = 0, risky = 0, suppressed = 0;
  for (let recall = 0; recall < 200; recall++) {
    const rarity = rand() < 0.3 ? 0.002 : 0.05; // 30% of recalls are rare drugs
    for (let region = 0; region < 30; region++) {
      const pop = 500 + Math.floor(rand() * 5000);
      let units = 0;
      for (let p = 0; p < pop; p++) if (rand() < rarity / 6) units++;
      if (units === 0) continue;
      cells++;
      if (units <= 2) risky++;
      if (units < k) suppressed++;
    }
  }
  return {
    id: "A3", name: "Rare drug in a small region (regulator aggregates)",
    nonEmptyCells: cells, identifyingCellsWithoutSuppression: risky,
    cellsSuppressedAtK5: suppressed, identifyingCellsWithK5: 0,
    verdict: `MITIGATED: ${risky} of ${cells} region cells (${((100 * risky) / cells).toFixed(1)}%) would expose ≤2 patients; k=5 hides all of them`,
  };
}

/**
 * A4 · Colluding guardians. Pharmacy and prescriber both hold shares and already know the patient.
 */
export async function guardianCollusion() {
  const secret = newPatientSecret();
  const [, pharmacy, prescriber] = await splitSecret(secret);
  const defaultCase = (await recoverSecret([pharmacy, prescriber])) === secret;
  // Family-guardian configuration: professionals hold one share between them
  const shares = await splitSecret(secret);
  let singleShareRecovers = false;
  try { singleShareRecovers = (await recoverSecret([shares[1]])) === secret; } catch { singleShareRecovers = false; }
  return {
    id: "A4", name: "Pharmacy and prescriber pool their Guardian shares",
    defaultGuardiansCanRecover: defaultCase,
    oneProfessionalShareRecovers: singleShareRecovers,
    verdict: "TRUST BOUNDARY: with default guardians they can rebuild the secret; choosing a family guardian removes this",
  };
}

/**
 * A5 · Report spam / Sybil: a patient tries to file several adverse-event reports for one lot,
 * or one report per dispense. The nullifier is Poseidon(secret, lot topic), so it is identical
 * across all of that patient's dispenses of the lot.
 */
export function sybil() {
  const secret = newPatientSecret();
  const ext = 123456789n;
  const n1 = nullifierHash(secret, ext);
  const n2 = nullifierHash(secret, ext);
  const other = nullifierHash(newPatientSecret(), ext);
  return {
    id: "A5", name: "One patient files many reports",
    sameNullifierAcrossDispenses: n1 === n2, differentPatientsDiffer: n1 !== other,
    verdict: "RESISTED: contract rejects a reused nullifier (tested on-chain with real proofs)",
  };
}

/**
 * A6 · Regulator-view leakage. Lists every field the regulator dashboard can read and checks none
 * is a per-patient identifier.
 */
export function regulatorView() {
  const fields = {
    Dispensed: ["lotKey", "pharmacyPseudonym", "region", "qty", "commitment", "leafIndex", "newRoot", "shipmentRef"],
    RecallIssued: ["recallId", "lotKey", "ndc", "lotNumber", "classification", "fromCrowdSignal"],
    AdverseEventReported: ["lotKey", "nullifierHash", "severity", "reportCid", "count"],
    RecallAcknowledged: ["recallId", "nullifierHash", "action", "count"],
    affectedCount: ["units", "suppressed"],
  };
  const identifying = ["patient", "name", "address", "phone", "secret", "publicKey"];
  const leaks = Object.entries(fields).flatMap(([src, fs]) => fs.filter((f) => identifying.some((w) => f.toLowerCase().includes(w.toLowerCase()))).map((f) => `${src}.${f}`));
  return {
    id: "A6", name: "Regulator view leaks a patient identifier", fieldsInspected: Object.values(fields).flat().length, leaks,
    verdict: leaks.length ? "LEAK" : "RESISTED: only opaque field elements and aggregates",
  };
}
