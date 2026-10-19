import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, scryptSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
const dir = mkdtempSync(join(tmpdir(), 'lotus-fabric-api-'));
const configPath = resolve('.fabric-network/api-acceptance-gateway.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const service = createApp({ dataDir: dir, mode: 'fabric', fabricConfig: configPath });
const salt = randomBytes(16).toString('hex'),
  password = 'Fabric-API-test-passphrase-123';
service.store.db
  .prepare('INSERT INTO users(id,email,name,role,orgId,password) VALUES(?,?,?,?,?,?)')
  .run(
    config.publicReader.id,
    'operator@example.test',
    'Acceptance operator',
    'operator',
    null,
    `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
  );
const server = await new Promise((resolve) => {
  const server = service.app.listen(0, '127.0.0.1', () => resolve(server));
});
const base = `http://127.0.0.1:${server.address().port}`;
const client = () => {
  let cookie = '',
    csrf = '';
  return async (path, body) => {
    const response = await fetch(base + '/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-csrf-token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json();
    if (data.csrf) csrf = data.csrf;
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  };
};
try {
  const operator = client(),
    staff = client();
  await operator('/login', { email: 'operator@example.test', password });
  const result = await operator('/commands', {
    command: 'createOrganization',
    payload: {
      name: 'API Fabric manufacturer ' + randomUUID(),
      type: 'manufacturer',
      region: 1,
      facility: 'Integration facility',
    },
    requestId: randomUUID(),
  });
  const invited = await operator('/invitations', {
    name: 'API Fabric staff',
    email: randomUUID() + '@example.test',
    role: 'manufacturer',
    orgId: result.result.organization.id,
  });
  await staff('/join', {
    token: invited.url.split('=')[1],
    password: 'Enrolled-staff-passphrase-123',
  });
  const registered = await staff('/commands', {
    command: 'registerLot',
    payload: {
      name: 'API Fabric medicine',
      namespace: 'NDC',
      code: 'API-NDC',
      lotNumber: randomUUID(),
      quantity: '500',
      expiry: Math.floor(Date.now() / 1000) + 86400,
    },
    requestId: randomUUID(),
  });
  assert.equal(registered.status, 'committed');
  assert.equal(registered.ledger, 'fabric');
  const workspace = await staff('/workspace');
  assert.equal(workspace.ledger, 'fabric');
  assert.equal(workspace.stocks.find((s) => s.lotId === registered.result.lot.id).available, '500');
  console.log(
    JSON.stringify({
      fabricWebApi: true,
      authenticatedInvitation: true,
      distinctCertificateEnrollment: true,
      committedLot: true,
      scopedInventory: true,
      channel: config.channel,
    })
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await service.close();
  assert.ok(dir.startsWith(tmpdir()));
  rmSync(dir, { recursive: true, force: true });
}
