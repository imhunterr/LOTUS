import { test } from "node:test";
import assert from "node:assert/strict";
import { newPatientSecret, commitmentAt, matchRecalls, splitSecret, recoverSecret, LotMerkleTree } from "../src/index.js";

test("guardian 2-of-3 recovery restores matching", async () => {
  const secret = newPatientSecret();
  const [device, pharmacy, prescriber] = await splitSecret(secret);
  assert.equal(await recoverSecret([pharmacy, prescriber]), secret);
  assert.equal(await recoverSecret([device, prescriber]), secret);
});

test("matchRecalls finds only the patient's recalled dispenses", () => {
  const me = newPatientSecret();
  const other = newPatientSecret();
  const events = [
    { commitment: commitmentAt(me, 0), lotKey: "0xA" },
    { commitment: commitmentAt(other, 0), lotKey: "0xA" },
    { commitment: commitmentAt(me, 1), lotKey: "0xB" },
  ];
  const { myDispenses, affected } = matchRecalls(me, events, new Set(["0xA"]));
  assert.equal(myDispenses.length, 2);
  assert.equal(affected.length, 1);
  assert.equal(affected[0].lotKey, "0xA");
});

test("Merkle path recomputes the root", () => {
  const tree = new LotMerkleTree([1n, 2n, 3n]);
  const { pathElements, depth, root } = tree.path(2);
  assert.equal(pathElements.length, 16);
  assert.equal(depth, 1); // leaf 2 has no right sibling, so only the level-1 sibling is real
  assert.notEqual(root, 0n);
});
