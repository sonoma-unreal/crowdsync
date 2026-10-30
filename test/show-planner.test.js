import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_PULSE_MS, decodeBeatMap, normalizeShowPlan, sampleTorch, showStateAt } from '../src/safety.js';
import { buildMusicPlan, detectBeatTimes, encodeBeatMap } from '../public/show-planner.js';

function pulseAnalysis(durationMs = 6_000, bpm = 120) {
  const frameMs = 50, envelope = Array(Math.ceil(durationMs / frameMs)).fill(0.1);
  for (let at = 500; at < durationMs; at += 500) {
    const frame = Math.round(at / frameMs);
    envelope[frame] = 0.9;
    if (frame + 1 < envelope.length) envelope[frame + 1] = 0.1;
  }
  return { durationMs, bpm, frameMs, envelope };
}

test('audio score creates discrete keyframes for detected transients', () => {
  const analysis = pulseAnalysis(), detected = detectBeatTimes(analysis);
  assert.equal(detected.mode, 'detected');
  assert.ok(detected.times.length >= 8);
  const plan = buildMusicPlan(analysis, { bpm: 120, screenColor: '#25c3e8', accentColor: '#a855f7' });
  assert.equal(plan.cues.length, 1);
  assert.equal(plan.beatMode, 'detected');
  assert.equal(decodeBeatMap(plan.beatMap, plan.durationMs).length, plan.beatCount);
  assert.ok(JSON.stringify({ durationMs: plan.durationMs, cues: plan.cues, beatMap: plan.beatMap, beatMode: plan.beatMode }).length < 4096);
});

test('compact beat map supports a ten-minute, 180 BPM score', () => {
  const times = Array.from({ length: 1_800 }, (_, index) => index * (60_000 / 180));
  const encoded = encodeBeatMap(times), decoded = decodeBeatMap(encoded, 600_000);
  assert.ok(encoded.length <= 3_600);
  assert.equal(decoded.length, times.length);
  assert.ok(Math.abs(decoded.at(-1) - times.at(-1)) <= 10);
});

test('beat keyframes produce one-shot pulses and malformed maps are rejected', () => {
  const beatMap = encodeBeatMap([0, 500, 1_000]);
  const result = normalizeShowPlan({
    durationMs: 2_000,
    cues: [{ at: 0, effect: 'pulse', rate: 1, screenColor: '#25c3e8', accentColor: '#a855f7', group: null }],
    beatMap,
    beatMode: 'detected',
  });
  assert.equal(result.ok, true);
  const state = { status: 'running', torchEnabled: true, startedAt: 10_000, enhancedProtection: true, showPlan: result.plan };
  assert.equal(sampleTorch(showStateAt(state, 10_000), 10_000), true);
  assert.equal(sampleTorch(showStateAt(state, 10_000 + BEAT_PULSE_MS), 10_000 + BEAT_PULSE_MS), false);
  assert.equal(sampleTorch(showStateAt(state, 10_500), 10_500), true);
  assert.equal(decodeBeatMap('A!', 2_000), null);
  assert.equal(normalizeShowPlan({ ...result.plan, beatMap: 'A!' }).ok, false);
});
