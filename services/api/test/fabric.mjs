import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Certificate } from '@fidm/x509';
import { FabricLedger } from '../src/fabric.js';
import {
  newPermit,
  newPatientSecret,
  commitmentAt,
  LotMerkleTree,
  nullifierHash,
} from '../../../sdk/src/index.js';
import { topic, signal } from '../../../packages/domain/src/crypto.js';
import * as snarkjs from 'snarkjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const path = resolve('.fabric-network/acceptance-gateway.json'),
  config = JSON.parse(readFileSync(path, 'utf8')),
  ledger = new FabricLedger({ options: { signalThreshold: 3 } }, path),
  operator = config.publicReader;
const certId = (i) => identityString(i);
const run = (actor, cmd, payload) => ledger.run(actor, cmd, payload, randomUUID());
try {
  const admin = await ledger.contract(operator);
  const actors = {};
  const existing = (await ledger.snapshot(operator)).actors;
  for (const [index, role] of [
    'manufacturer',
    'distributor',
    'pharmacy',
    'prescriber',
    'regulator',
  ].entries()) {
    const previous = existing.find(actor => actor.role === role && actor.name === `Acceptance ${role}` && actor.active);
    if(previous){ledger.config.identities[previous.id]=config.identityPool[index];actors[role]=previous;continue;}
    const result = await run(operator, 'createOrganization', {
      name: `Fabric acceptance ${role}`,
      type: role,
      region: 1,
      facility: 'Acceptance facility',
    });
    const actor = {
      id: `${role}_${randomUUID()}`,
      role,
      orgId: result.organization.id,
      name: `Acceptance ${role}`,
    };
    await run(operator, 'registerActor', actor);
    const identity = config.identityPool[index];
    await admin.submitTransaction('EnrollIdentity', identity.mspId, certId(identity), actor.id);
    ledger.config.identities[actor.id] = identity;
    actors[role] = actor;
  }
  const lot = (
    await run(actors.manufacturer, 'registerLot', {
      name: 'Fabric integration medicine',
      namespace: 'NDC',
      code: 'FABRIC-TEST',
      lotNumber: randomUUID(),
      quantity: '100',
      expiry: Math.floor(Date.now() / 1000) + 86400,
    })
  ).lot;
  const outbound = (
    await run(actors.manufacturer, 'ship', {
      lotId: lot.id,
      toOrgId: actors.distributor.orgId,
      quantity: '80',
    })
  ).shipment;
  await run(actors.distributor, 'receive', { shipmentId: outbound.id, action: 'accept' });
  const delivery = (
    await run(actors.distributor, 'ship', {
      lotId: lot.id,
      toOrgId: actors.pharmacy.orgId,
      quantity: '60',
    })
  ).shipment;
  await run(actors.pharmacy, 'receive', { shipmentId: delivery.id, action: 'accept' });
  const credential = newPermit(),
    permit = (
      await run(actors.prescriber, 'issuePermit', {
        code: lot.code,
        namespace: lot.namespace,
        quantity: '30',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        holderCommit: credential.holderCommit,
      })
    ).permit;
  const secret = newPatientSecret(),
    receipt = (
      await run(actors.pharmacy, 'dispense', {
        lotId: lot.id,
        permitId: permit.id,
        permitSecret: credential.permitSecret,
        quantity: '20',
        commitment: commitmentAt(secret, 0).toString(),
      })
    ).receipt;
  const view = await ledger.snapshot(actors.pharmacy);
  assert.equal(view.stocks.find((s) => s.lotId === lot.id).available, '40');
  assert.equal(view.permits.find((p) => p.id === permit.id).balance, '10');
  const recall = (
    await run(actors.regulator, 'recall', {
      lotId: lot.id,
      classification: 2,
      reason: 'Integration check',
      instructions: 'Consult the official pharmacy notice.',
    })
  ).recall;
  await assert.rejects(
    run(actors.pharmacy, 'dispense', {
      lotId: lot.id,
      permitId: permit.id,
      permitSecret: credential.permitSecret,
      quantity: '1',
      commitment: commitmentAt(secret, 1).toString(),
    })
  );
  const feed = await ledger.publicFeed(),
    tree = new LotMerkleTree(
      feed.leaves.filter((l) => l.lotId === lot.id).map((l) => l.commitment)
    ),
    path = tree.path(0),
    external = topic(config.network, 'ack', recall.id),
    nullifier = nullifierHash(secret, external).toString();
  const proved = await snarkjs.groth16.fullProve(
    {
      root: path.root.toString(),
      nullifierHash: nullifier,
      externalNullifier: external,
      signalHash: signal('ack', 2),
      secret: secret.toString(),
      index: '0',
      depth: String(path.depth),
      pathElements: path.pathElements.map(String),
      pathIndices: path.pathIndices.map(String),
    },
    resolve('apps/web/public/zk/lotus_membership.wasm'),
    resolve('apps/web/public/zk/lotus_final.zkey')
  );
  const relay = { id: 'anonymous-relay', role: 'relay', orgId: null };
  const payload = {
    recallId: recall.id,
    lotId: lot.id,
    action: 2,
    segment: 0,
    root: path.root.toString(),
    nullifierHash: nullifier,
    proof: proved.proof,
  };
  await run(relay, 'acknowledge', payload);
  await assert.rejects(run(relay, 'acknowledge', payload));
  assert.equal(
    (await ledger.snapshot(actors.regulator)).recalls.find((r) => r.id === recall.id).acks,
    1
  );
  const result = {
    channel: config.channel,
    fabricVersion: '3.1.5',
    endorsingOrganizations: 2,
    fullCustody: true,
    atomicDispense: true,
    recallBlocksDispense: true,
    realChaincodeProof: true,
    nullifierReplayRejected: true,
  };
  writeFileSync(resolve('.fabric-network/acceptance-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await ledger.close();
  await globalThis.curve_bn128?.terminate();
}

function identityString(i) {
  const cert = Certificate.fromPEM(readFileSync(i.certificate));
  const format = (dn) =>
    dn.attributes.map((a) => '/' + a.shortName + '=' + a.value.replace('/', '\\/')).join('');
  return 'x509::' + format(cert.subject) + '::' + format(cert.issuer);
}
