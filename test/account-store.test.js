import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountStore } from '../src/account-store.js';

test('account sessions use opaque tokens and can be revoked', async () => {
  const store = createAccountStore({ databaseUrl: '' });
  await store.initialize();
  const token = await store.createSession({ sub: 'google-subject', email: 'host@example.test', name: 'Ada Lovelace', firstName: 'Ada' });
  assert.ok(token.length >= 40);
  assert.equal(token.includes('google-subject'), false);
  assert.deepEqual(await store.readSession(token), { sub: 'google-subject', email: 'host@example.test', name: 'Ada Lovelace', firstName: 'Ada' });
  await store.revokeSession(token);
  assert.equal(await store.readSession(token), null);
  await store.close();
});

test('saved show data is scoped to its account and deletable', async () => {
  const store = createAccountStore({ databaseUrl: '' });
  const id = await store.createShow('owner-a', 'Late night', { effect: 'ripple' });
  assert.equal((await store.getShow('owner-b', id)), null);
  await store.updateShow('owner-a', id, 'Opening night', { effect: 'comet' });
  assert.deepEqual((await store.getShow('owner-a', id)).config, { effect: 'comet' });
  assert.equal((await store.listShows('owner-b')).length, 0);
  assert.equal(await store.deleteShow('owner-b', id), false);
  assert.equal(await store.deleteShow('owner-a', id), true);
  assert.equal(await store.getShow('owner-a', id), null);
  await store.close();
});
