import test from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, verifyToken } from '../src/auth.js';

test('signed claims verify and tampered claims fail', () => {
  const token = issueToken({ role: 'operator', room: 'room-a' });
  assert.equal(verifyToken(token).room, 'room-a');
  const [body, sig] = token.split('.');
  const changedSignature = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
  assert.equal(verifyToken(`${body}.${changedSignature}`), null);
  assert.equal(verifyToken(`${body}.bad.signature`), null);
  assert.equal(verifyToken('not a token'), null);
});

test('expired and malformed claim sets are rejected', async () => {
  const expired = issueToken({ role: 'operator', room: 'room-a' }, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(verifyToken(expired), null);
  assert.equal(verifyToken(Buffer.from('{"exp":null}').toString('base64url') + '.invalid'), null);
  assert.throws(() => issueToken({ role: 'operator' }, -1), /lifetime/);
});
