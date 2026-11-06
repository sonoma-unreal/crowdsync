import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_PULSE_MS, decodeBeatMap, decodeBeatStyles, normalizeShowPlan, sampleTorch, showStateAt } from '../src/safety.js';
import { buildMusicPlan, detectBeatTimes, encodeBeatMap } from '../public/show-planner.js';
import { cleanTrackTitle } from '../public/music-playlist.js';

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
  assert.equal(plan.beatStyles.length, plan.beatCount);
  assert.deepEqual(decodeBeatStyles(plan.beatStyles, plan.beatCount, plan.beatStyleTable), Array(plan.beatCount).fill(0));
  assert.ok(JSON.stringify(plan).length < 8192);
});

test('Beat This timestamps and downbeat mode survive score compilation and server validation', () => {
  const analysis = { ...pulseAnalysis(), beatMode: 'beat-this', beatTimes: [0, 500, 1_000, 1_500], beatStrengths: [1, 1, 1, 1], beatThisDownbeats: [0, 1_000] };
  const plan = buildMusicPlan(analysis, { bpm: 120, screenColor: '#25c3e8', accentColor: '#a855f7' });
  assert.equal(plan.beatMode, 'beat-this');
  assert.deepEqual(decodeBeatMap(plan.beatMap, plan.durationMs), analysis.beatTimes);
  assert.equal(normalizeShowPlan({ durationMs: plan.durationMs, cues: plan.cues, beatMap: plan.beatMap, beatStyles: plan.beatStyles, beatStyleTable: plan.beatStyleTable, beatMode: plan.beatMode }).ok, true);
});

test('compact beat map supports a ten-minute, 180 BPM score', () => {
  const times = Array.from({ length: 1_800 }, (_, index) => index * (60_000 / 180));
  const encoded = encodeBeatMap(times), decoded = decodeBeatMap(encoded, 600_000);
  assert.ok(encoded.length <= 3_600);
  assert.equal(decoded.length, times.length);
  assert.ok(Math.abs(decoded.at(-1) - times.at(-1)) <= 10);
});

test('maximum-length edited beat plans fit the bounded WebSocket payload', () => {
  const times = Array.from({ length: 1_800 }, (_, index) => index * (60_000 / 180));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const effects = ['pulse', 'doubleBeat', 'heartbeat', 'beacon', 'siren', 'wave', 'ripple', 'sparkle', 'twinkle', 'comet', 'morse', 'chase', 'march', 'stutter', 'crescendo', 'rapidSparkle'];
  const beatStyleTable = Array.from({ length: 32 }, (_, index) => ({ effect: effects[index % effects.length], screenColor: `#${(index * 7919).toString(16).padStart(6, '0')}` }));
  const plan = { durationMs: 600_000, cues: [{ at: 0, effect: 'pulse', rate: 1, screenColor: '#ffffff', accentColor: '#000000', group: null }], beatMap: encodeBeatMap(times), beatStyles: Array.from({ length: times.length }, (_, index) => alphabet[index % 32]).join(''), beatStyleTable };
  assert.ok(JSON.stringify(plan).length < 8_192);
  assert.equal(normalizeShowPlan(plan).ok, true);
});

test('beat keyframes produce one-shot pulses and malformed maps are rejected', () => {
  const beatMap = encodeBeatMap([0, 500, 1_000]);
  const result = normalizeShowPlan({
    durationMs: 2_000,
    cues: [{ at: 0, effect: 'pulse', rate: 1, screenColor: '#25c3e8', accentColor: '#a855f7', group: null }],
    beatMap,
    beatStyles: 'ABB',
    beatStyleTable: [{ effect: 'pulse', screenColor: '#25c3e8' }, { effect: 'doubleBeat', screenColor: '#ff315a' }],
    beatMode: 'detected',
  });
  assert.equal(result.ok, true);
  const state = { status: 'running', torchEnabled: true, startedAt: 10_000, enhancedProtection: true, showPlan: result.plan };
  assert.equal(sampleTorch(showStateAt(state, 10_000), 10_000), true);
  assert.equal(sampleTorch(showStateAt(state, 10_000 + BEAT_PULSE_MS), 10_000 + BEAT_PULSE_MS), false);
  assert.equal(sampleTorch(showStateAt(state, 10_500), 10_500), true);
  const edited = showStateAt(state, 10_500);
  assert.equal(edited.effect, 'doubleBeat');
  assert.equal(edited.screenColor, '#ff315a');
  assert.equal(sampleTorch(showStateAt(state, 10_690), 10_690), true);
  assert.equal(sampleTorch(showStateAt(state, 10_580), 10_580), false);
  assert.equal(decodeBeatMap('A!', 2_000), null);
  assert.equal(normalizeShowPlan({ ...result.plan, beatMap: 'A!' }).ok, false);
  assert.equal(normalizeShowPlan({ ...result.plan, beatStyles: 'AB' }).ok, false);
  assert.equal(normalizeShowPlan({ ...result.plan, beatStyleTable: [{ effect: 'solid', screenColor: '#ffffff' }] }).ok, false);
});

test('live score anchors preserve the shared show clock and offset beat pulses', () => {
  const normalized = normalizeShowPlan({
    durationMs: 2_000,
    anchorMs: 4_000,
    cues: [{ at: 0, effect: 'pulse', rate: 1, screenColor: '#25c3e8', accentColor: '#a855f7', group: null }],
    beatMap: encodeBeatMap([0, 500, 1_000]),
    beatStyles: 'AAA',
    beatStyleTable: [{ effect: 'pulse', screenColor: '#25c3e8' }],
  });
  assert.equal(normalized.ok, true);
  const state = { status: 'running', torchEnabled: true, startedAt: 10_000, enhancedProtection: true, showPlan: normalized.plan };
  assert.equal(showStateAt(state, 13_999).status, 'idle');
  assert.equal(showStateAt(state, 13_999).torchEnabled, false);
  assert.equal(showStateAt(state, 14_000).beatIndex, 0);
  assert.equal(showStateAt(state, 14_500).beatPulseAt, 14_500);
  assert.equal(showStateAt(state, 14_500).startedAt, 14_000);
  assert.equal(normalizeShowPlan({ ...normalized.plan, anchorMs: 12 * 60 * 60 * 1000 + 1 }).ok, false);
});

test('download-style filenames become readable local playlist titles', () => {
  assert.equal(cleanTrackTitle('YTDown.com_YouTube_Media_dQw4w9WgXcQ_Never-Gonna-Give-You-Up_009_128k.mp3'), 'Never – Gonna – Give – You – Up');
  assert.equal(cleanTrackTitle('evening lights.mp3'), 'evening lights');
});
