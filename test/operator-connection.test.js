import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperatorDisconnect, isCurrentOperatorSocket, operatorOriginsMatch, operatorReconnectDelay } from '../public/operator-connection.js';

test('operator reconnect stops on an ended or unauthorized room and retries transient disconnects', () => {
  assert.equal(classifyOperatorDisconnect(1008), 'unavailable');
  assert.equal(classifyOperatorDisconnect(1000), 'unavailable');
  assert.equal(classifyOperatorDisconnect(1006), 'retry');
  assert.equal(classifyOperatorDisconnect(1013), 'retry');
  assert.equal(classifyOperatorDisconnect(1006, true), 'unavailable');
});

test('operator reconnect backoff is bounded and jittered', () => {
  assert.equal(operatorReconnectDelay(0, () => 0.5), 1_000);
  assert.equal(operatorReconnectDelay(1, () => 0.5), 2_000);
  assert.equal(operatorReconnectDelay(20, () => 0.5), 15_000);
  assert.equal(operatorReconnectDelay(0, () => 0), 800);
  assert.equal(operatorReconnectDelay(0, () => 1), 1_200);
});

test('stale socket events cannot mutate the current connection', () => {
  const active = {}, previous = {};
  assert.equal(isCurrentOperatorSocket(active, active), true);
  assert.equal(isCurrentOperatorSocket(previous, active), false);
});

test('operator detects a room link created for a different browser origin', () => {
  assert.equal(operatorOriginsMatch('https://show.example.test/join/123456', 'https://show.example.test'), true);
  assert.equal(operatorOriginsMatch('http://localhost:3000/join/123456', 'https://show.example.test'), false);
  assert.equal(operatorOriginsMatch('not a URL', 'https://show.example.test'), false);
});
