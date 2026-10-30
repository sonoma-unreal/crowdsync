import test from 'node:test';
import assert from 'node:assert/strict';
import { createTorchGovernor, ENHANCED_MAX_FLASHES_PER_SECOND, MAX_FLASHES_PER_SECOND, normalizeTorchSettings, sampleTorch, TORCH_EFFECTS } from '../src/safety.js';

test('all torch effects produce deterministic on/off states only while running and enabled', () => {
  for (const effect of Object.keys(TORCH_EFFECTS)) {
    const state = { status: 'running', torchEnabled: true, enhancedProtection: true, startedAt: 0, effect, rate: 0.5 };
    assert.equal(typeof sampleTorch(state, 1200, 18, 1, 5), 'boolean', effect);
    assert.equal(sampleTorch({ ...state, status: 'paused' }, 1200, 18, 1, 5), false, effect);
    assert.equal(sampleTorch({ ...state, torchEnabled: false }, 1200, 18, 1, 5), false, effect);
  }
});

test('effect rate normalization observes enhanced and fixed baseline ceilings', () => {
  for (const [effect, spec] of Object.entries(TORCH_EFFECTS)) {
    if (!spec.pulses) continue;
    const enhanced = normalizeTorchSettings(effect, 99, true);
    const standard = normalizeTorchSettings(effect, 99, false);
    assert.ok(enhanced.rate <= ENHANCED_MAX_FLASHES_PER_SECOND / spec.pulses, effect);
    assert.ok(standard.rate <= MAX_FLASHES_PER_SECOND / spec.pulses, effect);
  }
  assert.equal(normalizeTorchSettings('unknown', 2).effect, 'pulse');
});

test('device governor enforces the rolling second cap and enhanced minimum gap', () => {
  for (const [enhanced, expected] of [[true, 1.5], [false, 3]]) {
    const govern = createTorchGovernor(), edges = [];
    let previous = false;
    for (let t = 0; t <= 5000; t += 10) {
      const on = govern(true, t, enhanced);
      if (on && !previous) edges.push(t);
      previous = on;
      if (t % 120 === 0) { govern(false, t, enhanced); previous = false; }
    }
    for (const edge of edges) assert.ok(edges.filter((other) => other <= edge && other > edge - 1000).length <= 3);
    for (let i = 1; i < edges.length; i++) assert.ok(edges[i] - edges[i - 1] >= 1000 / expected - 10);
  }
});

test('device governor lets emergency off pass immediately', () => {
  const govern = createTorchGovernor();
  assert.equal(govern(true, 0), true);
  assert.equal(govern(false, 1), false);
});
