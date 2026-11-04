import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, hashToken, isPublicWebUrl, newSessionToken, verifyPassword } from '../server/security.js';

test('password hashes verify only the original password', async () => {
  const encoded = await hashPassword('a-long-demo-password-123');
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('a-long-demo-password-123', encoded), true);
  assert.equal(await verifyPassword('a-different-password', encoded), false);
});

test('session token is opaque and stored as a one-way digest', () => {
  const first = newSessionToken();
  const second = newSessionToken();
  assert.notEqual(first, second);
  assert.notEqual(hashToken(first), first);
  assert.equal(hashToken(first).length, 64);
});

test('public URL validation rejects local/private network destinations', () => {
  for (const url of ['http://127.0.0.1/admin', 'http://10.0.0.8/', 'http://192.168.1.1/', 'http://localhost/', 'http://service.internal/', 'file:///etc/passwd', 'https://user:pass@example.com/']) {
    assert.equal(isPublicWebUrl(url), false, url);
  }
  assert.equal(isPublicWebUrl('https://example.org/research'), true);
});
