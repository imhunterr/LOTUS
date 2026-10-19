import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { projectPublicFeed, projectSnapshot } from '../../../packages/domain/src/engine.js';

const require = createRequire(import.meta.url);
const { contracts: [Lotus] } = require('../../../chaincode/lotus/index.cjs');
const entities = {
  'org:maker': { id: 'maker', name: 'Public manufacturer', active: true, type: 'manufacturer', privateContact: 'hidden' },
  'lot:lot-1': {
    id: 'lot-1', name: 'Medicine', code: '001', namespace: 'NDC', lotNumber: 'L1',
    expiry: 9999999999, documentId: 'certificate', registeredAt: 10, recallId: 'recall-1',
    manufacturerId: 'maker', quantity: '1000', dispensedUnits: '20', dispenseRecords: 2,
    reportCount: 1, severitySum: 3, safetySignal: true, currentSegment: 0,
    unexpectedPrivateField: 'must never be published',
  },
  'recall:recall-1': {
    id: 'recall-1', lotId: 'lot-1', classification: 1, reason: 'Quality', instructions: 'Contact pharmacy',
    documentId: null, issuedAt: 20, regulatorId: 'authority', cutoffRecords: 2,
    acks: 1, actions: { 1: 1 }, fromSignal: true, unexpectedPrivateField: 'hidden',
  },
  'leaf:lot-1:0:000000': { lotId: 'lot-1', commitment: '123', leafIndex: 0, segment: 0, quantity: '20', region: 1, orgId: 'pharmacy' },
  'root:lot-1:0:123': { at: 11, size: 1, unexpectedPrivateField: 'hidden' },
  'configuration': { network: 'test-network' },
  'identity:Org1MSP:test-identity': { actorId: 'operator' },
  'actor:operator': { id: 'operator', role: 'operator', active: true, orgId: null },
};
const expected = {
  lots: [{ id: 'lot-1', name: 'Medicine', code: '001', namespace: 'NDC', lotNumber: 'L1', expiry: 9999999999,
    documentId: 'certificate', registeredAt: 10, recallId: 'recall-1', manufacturer: 'Public manufacturer' }],
  recalls: [{ id: 'recall-1', lotId: 'lot-1', classification: 1, reason: 'Quality', instructions: 'Contact pharmacy', documentId: null, issuedAt: 20 }],
  leaves: [{ lotId: 'lot-1', commitment: '123', leafIndex: 0, segment: 0 }],
  roots: [{ key: 'root:lot-1:0:123' }], network: 'test-network', checkedAt: 200000,
};

test('public release rejects operational and future fields while staff retain detailed lot state', () => {
  assert.deepEqual(projectPublicFeed(entities, { network: 'test-network', checkedAt: 200000 }), expected);
  const lot = projectSnapshot(Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, { ...value, _key: key }])), entities['actor:operator']).lots[0];
  assert.equal(lot.quantity, '1000');
  assert.equal(lot.reportCount, 1);
  assert.equal(lot.manufacturer, 'Public manufacturer');
});

test('Fabric PublicFeed uses the same allow-list and manufacturer resolution as the local feed', async () => {
  const ctx = {
    clientIdentity: { getMSPID: () => 'Org1MSP', getID: () => 'test-identity' },
    stub: {
      getState: async (key) => entities[key] ? Buffer.from(JSON.stringify(entities[key])) : Buffer.alloc(0),
      getStateByRange: async function* () {
        for (const [key, value] of Object.entries(entities)) yield { key, value: Buffer.from(JSON.stringify(value)) };
      },
      getTxTimestamp: () => ({ seconds: 200 }),
    },
  };
  assert.deepEqual(await new Lotus().PublicFeed(ctx), expected);
  assert.deepEqual(await new Lotus().PublicObject(ctx, 'lot:lot-1'), expected.lots[0]);
});
