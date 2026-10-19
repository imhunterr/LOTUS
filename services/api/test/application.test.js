import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  randomUUID,
  createPublicKey,
  publicEncrypt,
  constants,
  randomBytes,
  createCipheriv,
} from 'node:crypto';
import * as snarkjs from 'snarkjs';
import {
  newPermit,
  newPatientSecret,
  commitmentAt,
  LotMerkleTree,
  nullifierHash,
} from '../../../sdk/src/index.js';
import { topic, signal } from '../../../packages/domain/src/crypto.js';
import { createApp } from '../src/server.js';
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));

test('durable application lifecycle with independent actors and real anonymous proofs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lotus-application-'));
  const service = createApp({ dataDir: dir });
  const server = await new Promise((resolve) => {
    const s = service.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await service.close();
    await globalThis.curve_bn128?.terminate();
    rmSync(dir, { recursive: true, force: true });
  });
  function client() {
    let cookie = '',
      csrf = '';
    return {
      async call(path, body, method = body ? 'POST' : 'GET') {
        const r = await fetch(base + '/api' + path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
        const data = await r.json();
        if (data.csrf) csrf = data.csrf;
        return { ...data, status: r.status };
      },
      async command(command, payload, requestId = randomUUID()) {
        return this.call('/commands', { command, payload, requestId });
      },
    };
  }
  const operator = client(),
    mfr = client(),
    dist = client(),
    pharm = client(),
    pharmB = client(),
    doctor = client(),
    regulator = client(),
    anonymous = client();
  let orgs = {},
    lot,
    permit,
    credential,
    receipt,
    recall,
    reportObject;
  const secret = newPatientSecret();
  await t.test('first-run setup, invitations, sessions and scoped organizations', async () => {
    const setup = await operator.call('/setup', {
      email: 'operator@example.test',
      name: 'Operator',
      password: 'Operator-test-passphrase-123',
    });
    assert.equal(setup.status, 201);
    for (const [name, role, c] of [
      ['Manufacturer', 'manufacturer', mfr],
      ['Distributor', 'distributor', dist],
      ['Pharmacy A', 'pharmacy', pharm],
      ['Pharmacy B', 'pharmacy', pharmB],
      ['Clinic', 'prescriber', doctor],
      ['Authority', 'regulator', regulator],
    ]) {
      const result = await operator.command('createOrganization', {
        name,
        type: role,
        region: 1,
        facility: 'Main',
      });
      assert.equal(result.status, 200);
      orgs[name] = result.result.organization.id;
      const invitation = await operator.call('/invitations', {
        name,
        email: `${name.replaceAll(' ', '').toLowerCase()}@example.test`,
        role,
        orgId: orgs[name],
      });
      assert.equal(invitation.status, 201);
      const token = invitation.url.split('=')[1],
        joined = await c.call('/join', { token, password: 'Staff-test-passphrase-123' });
      assert.equal(joined.status, 201);
      assert.equal((await c.call('/workspace')).user.role, role);
    }
    assert.equal((await anonymous.call('/workspace')).status, 401);
    assert.equal(
      (await mfr.command('createOrganization', { name: 'Wrong', type: 'pharmacy' })).status,
      403
    );
  });
  await t.test('document bytes, lot registration and idempotent initial issuance', async () => {
    const doc = await mfr.call('/documents', {
      name: 'certificate.txt',
      mime: 'text/plain',
      public: true,
      base64: Buffer.from('Verified laboratory certificate').toString('base64'),
    });
    assert.equal(doc.status, 201);
    const payload = {
        name: 'Test medicine',
        namespace: 'NDC',
        code: '0002-1433-80',
        lotNumber: 'REAL-TEST-1',
        quantity: '1000',
        expiry: Math.floor(Date.now() / 1000) + 86400,
        documentId: doc.id,
      },
      id = randomUUID();
    const result = await mfr.command('registerLot', payload, id);
    assert.equal(result.status, 200);
    lot = result.result.lot;
    assert.equal((await mfr.command('registerLot', payload, id)).result.lot.id, lot.id);
    assert.equal((await mfr.command('registerLot', { ...payload, quantity: '9' }, id)).status, 409);
    assert.equal((await mfr.command('registerLot', payload)).error.code, 'LOT_EXISTS');
    for (const published of [
      (await anonymous.call('/public/feed')).lots.find((l) => l.id === lot.id),
      (await anonymous.call(`/public/verify?code=${lot.code}&lot=${lot.lotNumber}`)).matches[0],
    ]) {
      assert.equal(published.manufacturer, 'Manufacturer');
      for (const field of ['manufacturerId', 'quantity', 'dispensedUnits', 'dispenseRecords', 'reportCount', 'severitySum', 'safetySignal', 'currentSegment'])
        assert.equal(Object.hasOwn(published, field), false, `${field} must stay out of anonymous responses`);
    }
    const response = await fetch(base + `/api/documents/${doc.id}`);
    assert.equal(await response.text(), 'Verified laboratory certificate');
  });
  await t.test(
    'two-sided supply chain, wrong recipient and rejected shipment restoration',
    async () => {
      const first = await mfr.command('ship', {
        lotId: lot.id,
        toOrgId: orgs.Distributor,
        quantity: '400',
      });
      const id = first.result.shipment.id;
      assert.equal(
        (await pharm.command('receive', { shipmentId: id, action: 'accept' })).status,
        403
      );
      assert.equal((await dist.call('/workspace')).stocks.length, 0);
      assert.equal(
        (await dist.command('receive', { shipmentId: id, action: 'accept' })).status,
        200
      );
      assert.equal(
        (await dist.command('receive', { shipmentId: id, action: 'accept' })).error.code,
        'SHIPMENT_RESOLVED'
      );
      const second = await dist.command('ship', {
        lotId: lot.id,
        toOrgId: orgs['Pharmacy A'],
        quantity: '200',
      });
      assert.equal(
        (
          await pharm.command('receive', {
            shipmentId: second.result.shipment.id,
            action: 'accept',
          })
        ).status,
        200
      );
      const rejected = await dist.command('ship', {
        lotId: lot.id,
        toOrgId: orgs['Pharmacy B'],
        quantity: '20',
      });
      await pharmB.command('receive', {
        shipmentId: rejected.result.shipment.id,
        action: 'reject',
      });
      assert.equal((await dist.call('/workspace')).stocks[0].available, '200');
    }
  );
  await t.test(
    'prescription, atomic fills, invalid batch rollback and network-safe uniqueness',
    async () => {
      credential = newPermit();
      const issued = await doctor.command('issuePermit', {
        code: lot.code,
        namespace: 'NDC',
        quantity: '60',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        holderCommit: credential.holderCommit,
      });
      permit = issued.result.permit;
      const payload = {
        lotId: lot.id,
        permitId: permit.id,
        permitSecret: credential.permitSecret,
        quantity: '30',
        commitment: commitmentAt(secret, 0).toString(),
      };
      const invalid = await pharm.command('dispenseBatch', {
        items: [
          payload,
          { ...payload, quantity: '90', commitment: commitmentAt(secret, 1).toString() },
        ],
      });
      assert.equal(invalid.error.code, 'PERMIT_EXHAUSTED');
      assert.equal((await pharm.call('/workspace')).stocks[0].available, '200');
      const fill = await pharm.command('dispense', payload);
      assert.equal(fill.status, 200);
      receipt = fill.result.receipt;
      assert.equal((await pharm.command('dispense', payload)).error.code, 'COMMITMENT_REUSED');
      assert.equal(
        (
          await pharmB.command('dispense', {
            ...payload,
            quantity: '1',
            commitment: commitmentAt(secret, 2).toString(),
          })
        ).error.code,
        'PHARMACY_BINDING'
      );
      const workspace = await pharm.call('/workspace');
      assert.equal(workspace.stocks[0].available, '170');
      assert.equal(workspace.permits[0].balance, '30');
      assert.equal((await regulator.call('/workspace')).receipts.length, 0);
      const feed = await anonymous.call('/public/feed');
      assert.ok(feed.leaves.length);
      assert.equal(feed.leaves[0].region, undefined);
      assert.equal(feed.leaves[0].orgId, undefined);
      assert.equal(feed.leaves[0].quantity, undefined);
    }
  );
  await t.test('returns, rejection and shrinkage preserve closure', async () => {
    const result = await pharm.command('ship', {
      lotId: lot.id,
      toOrgId: orgs.Distributor,
      quantity: '10',
      kind: 'return',
      reason: 'Quality return',
    });
    await dist.command('receive', { shipmentId: result.result.shipment.id, action: 'reject' });
    let s = (await pharm.call('/workspace')).stocks[0];
    assert.equal(s.returned, '0');
    assert.equal(s.available, '170');
    assert.equal(
      (await pharm.command('shrinkage', { lotId: lot.id, quantity: '5', reason: 'Damaged units' }))
        .status,
      200
    );
    s = (await pharm.call('/workspace')).stocks[0];
    assert.equal(s.shrinkage, '5');
    assert.equal(s.available, '165');
  });
  async function proof(kind, value, reportDigest = '', proofSecret = secret, leafIndex = 0) {
    const feed = await anonymous.call('/public/feed'),
      leaves = feed.leaves.filter((l) => l.lotId === lot.id).map((l) => l.commitment),
      tree = new LotMerkleTree(leaves),
      path = tree.path(leafIndex),
      external = topic(feed.network, kind, kind === 'ack' ? recall.id : lot.id),
      nul = nullifierHash(proofSecret, external).toString();
    const proved = await snarkjs.groth16.fullProve(
      {
        root: path.root.toString(),
        nullifierHash: nul,
        externalNullifier: external,
        signalHash: signal(kind, value, reportDigest),
        secret: proofSecret.toString(),
        index: '0',
        depth: String(path.depth),
        pathElements: path.pathElements.map(String),
        pathIndices: path.pathIndices.map(String),
      },
      resolve('apps/web/public/zk/lotus_membership.wasm'),
      resolve('apps/web/public/zk/lotus_final.zkey')
    );
    return {
      requestId: randomUUID(),
      lotId: lot.id,
      recallId: recall?.id,
      segment: 0,
      root: path.root.toString(),
      nullifierHash: nul,
      proof: proved.proof,
      ...(kind === 'ack' ? { action: value } : { severity: value, reportDigest }),
    };
  }
  await t.test(
    'real anonymous encrypted side-effect report and protected narrative retrieval',
    async () => {
      const pub = await anonymous.call('/public/safety-key'),
        key = randomBytes(32),
        iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv),
        bytes = Buffer.concat([
          cipher.update('A rash after two days'),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
      const envelope = {
        v: 1,
        key: publicEncrypt(
          {
            key: createPublicKey({ key: pub.jwk, format: 'jwk' }),
            oaepHash: 'sha256',
            padding: constants.RSA_PKCS1_OAEP_PADDING,
          },
          key
        ).toString('base64'),
        iv: iv.toString('base64'),
        data: bytes.toString('base64'),
      };
      const uploaded = await anonymous.call('/anonymous/upload', { envelope });
      reportObject = uploaded;
      const p = await proof('report', 3, uploaded.digest);
      p.documentId = uploaded.id;
      const tampered = await anonymous.call('/anonymous/report', { ...p, severity: 4 });
      assert.equal(tampered.error.code, 'INVALID_PROOF');
      const accepted = await anonymous.call('/anonymous/report', p);
      assert.equal(accepted.status, 200);
      assert.equal(
        (await anonymous.call('/anonymous/report', { ...p, requestId: randomUUID() })).error.code,
        'ALREADY_SUBMITTED'
      );
      const text = await regulator.call(`/reports/${accepted.result.reportId}`);
      assert.equal(text.text, 'A rash after two days');
      assert.equal((await mfr.call(`/reports/${accepted.result.reportId}`)).status, 403);
    }
  );
  await t.test(
    'incremental lot roots accept compressed real proofs and raise a threshold event once',
    async () => {
      for (let leafIndex = 1; leafIndex <= 2; leafIndex++) {
        const recipient = newPatientSecret();
        const result = await pharm.command('dispense', {
          lotId: lot.id,
          permitId: permit.id,
          permitSecret: credential.permitSecret,
          quantity: '1',
          commitment: commitmentAt(recipient, 0).toString(),
        });
        assert.equal(result.status, 200);
        const payload = await proof('report', 3, reportObject.digest, recipient, leafIndex);
        payload.documentId = reportObject.id;
        const report = await anonymous.call('/anonymous/report', payload);
        assert.equal(report.status, 200);
        assert.equal(
          report.result.events.some((e) => e.type === 'SafetySignal'),
          leafIndex === 2
        );
      }
      const current = service.store.get(`lot:${lot.id}`);
      assert.equal(current.reportCount, 3);
      assert.equal(current.safetySignal, true);
    }
  );
  await t.test(
    'regulator-only recall, blocked dispense, anonymous acknowledgement and suppression',
    async () => {
      const p = {
        lotId: lot.id,
        classification: 2,
        reason: 'Official quality investigation',
        instructions: 'Contact your pharmacy or prescriber today.',
      };
      assert.equal((await mfr.command('recall', p)).status, 403);
      const result = await regulator.command('recall', p);
      assert.equal(result.status, 200);
      recall = result.result.recall;
      assert.equal(
        (
          await pharm.command('dispense', {
            lotId: lot.id,
            permitId: permit.id,
            permitSecret: credential.permitSecret,
            quantity: '1',
            commitment: commitmentAt(secret, 3).toString(),
          })
        ).error.code,
        'LOT_RECALLED'
      );
      const ack = await proof('ack', 2);
      assert.equal((await anonymous.call('/anonymous/ack', ack)).status, 200);
      assert.equal(
        (await anonymous.call('/anonymous/ack', { ...ack, requestId: randomUUID() })).error.code,
        'ALREADY_SUBMITTED'
      );
      const view = await regulator.call('/workspace');
      assert.equal(view.recalls[0].acks, 1);
      assert.equal(view.regions[0].cells[0].records, null);
    }
  );
  await t.test('credentialed permit transfer and scoped durable drafts', async () => {
    assert.equal(
      (
        await pharm.command('transferPermit', {
          permitId: permit.id,
          toOrgId: orgs['Pharmacy B'],
          permitSecret: credential.permitSecret,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await pharm.command('transferPermit', {
          permitId: permit.id,
          toOrgId: orgs['Pharmacy B'],
          permitSecret: credential.permitSecret,
        })
      ).status,
      403
    );
    await pharm.call(
      '/drafts/private-draft',
      { items: [{ permitSecret: credential.permitSecret }] },
      'PUT'
    );
    assert.equal((await pharm.call('/drafts/private-draft')).draft.items.length, 1);
    assert.equal((await pharmB.call('/drafts/private-draft')).draft, null);
  });
  await t.test(
    'immutable state persisted in SQLite and no sensitive input in the audit journal',
    async () => {
      const audit = await operator.call('/audit');
      assert.ok(audit.rows.length > 10);
      assert.ok(!JSON.stringify(audit).includes(credential.permitSecret));
      assert.equal(service.store.get(`lot:${lot.id}`).recallId, recall.id);
      assert.equal(service.store.get(`permit:${permit.id}`).boundOrgId, orgs['Pharmacy B']);
      const login = await client().call('/login', {
        email: 'manufacturer@example.test',
        password: 'Wrong-passphrase-123',
      });
      assert.equal(login.status, 401);
    }
  );
});
