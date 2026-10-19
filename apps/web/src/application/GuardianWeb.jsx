import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { PublicHeader } from './Application';
import { PageTitle, Card, Form, Field, Message, Icon } from './ui';
import { bytesToBase64, base64ToBytes } from './api';
import QrScanner from '../components/QrScanner';

const enc = new TextEncoder();
async function key(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
export default function GuardianWeb() {
  const [share, setShare] = useState(null),
    [opened, setOpened] = useState(null),
    [error, setError] = useState('');
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="narrow-main">
        <PageTitle eyebrow="Guardian share management" title="One share. Independent custody.">
          Store one share in an encrypted guardian vault on this browser. It does not contain a
          medicine list.
        </PageTitle>
        <Card title="Accept a protected handover">
          <QrScanner
            label="Scan guardian share"
            onResult={(text) => {
              try {
                const s = JSON.parse(text);
                if (s.type !== 'guardian' || !/^0x[0-9a-f]+$/i.test(s.share)) throw new Error();
                setShare(s);
                setError('');
              } catch {
                setError('This is not a guardian handover code.');
              }
            }}
          />
          <Message error={error} />
          <Form
            label={share ? 'Accept and encrypt this share' : 'Unlock stored guardian share'}
            onSubmit={async (v) => {
              if (share) {
                const salt = crypto.getRandomValues(new Uint8Array(16)),
                  iv = crypto.getRandomValues(new Uint8Array(12)),
                  k = await key(v.password, salt),
                  data = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    k,
                    enc.encode(JSON.stringify(share))
                  );
                localStorage.setItem(
                  'lotus.guardian.v2',
                  JSON.stringify({
                    salt: bytesToBase64(salt),
                    iv: bytesToBase64(iv),
                    data: bytesToBase64(new Uint8Array(data)),
                  })
                );
                setShare(null);
                setOpened(null);
                return 'One share encrypted and accepted. Store no other guardian share on this browser.';
              }
              const raw = JSON.parse(localStorage.getItem('lotus.guardian.v2') || 'null');
              if (!raw) throw new Error('No accepted share on this browser.');
              const k = await key(v.password, base64ToBytes(raw.salt));
              try {
                setOpened(
                  JSON.parse(
                    new TextDecoder().decode(
                      await crypto.subtle.decrypt(
                        { name: 'AES-GCM', iv: base64ToBytes(raw.iv) },
                        k,
                        base64ToBytes(raw.data)
                      )
                    )
                  )
                );
              } catch {
                throw new Error('Guardian passphrase could not unlock this share.');
              }
              return 'Share unlocked. Release only to the verified patient recovery session.';
            }}
          >
            <Field label="Guardian vault passphrase">
              <input name="password" type="password" minLength={12} required />
            </Field>
            {share && (
              <p className="muted">
                Receiving share for {share.name}. Accepting replaces a previously stored share.
              </p>
            )}
          </Form>
        </Card>
        {opened && (
          <Card title="Protected recovery release">
            <div className="qr-wrap">
              <QRCodeSVG value={JSON.stringify(opened)} size={210} />
            </div>
            <textarea
              value={JSON.stringify(opened)}
              readOnly
              aria-label="Unlocked recovery share"
            />
            <button className="button outline" onClick={() => setOpened(null)}>
              <Icon name="shield" />
              Lock this share
            </button>
          </Card>
        )}
      </main>
    </div>
  );
}
