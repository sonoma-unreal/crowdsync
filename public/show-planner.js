import { MAX_SHOW_CUES, maxRateForEffect, normalizeTorchSettings } from './safety.js';

const EFFECT_FLOW = ['pulse', 'wave', 'twinkle', 'comet', 'ripple', 'rapidSparkle', 'crescendo', 'chase', 'sparkle'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function analyzeAudioBuffer(buffer) {
  const durationMs = Math.round(buffer.duration * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 10 * 60 * 1000) {
    throw new Error('Choose a track between 1 second and 10 minutes long');
  }

  const frameMs = 50;
  const framesPerWindow = Math.max(1, Math.round(buffer.sampleRate * frameMs / 1000));
  const envelope = [];
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const sampleStride = Math.max(1, Math.floor(framesPerWindow / 256));
  for (let start = 0; start < buffer.length; start += framesPerWindow) {
    const end = Math.min(buffer.length, start + framesPerWindow);
    let sum = 0, count = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i += sampleStride) { const value = channel[i]; sum += value * value; count++; }
    }
    envelope.push(count ? Math.sqrt(sum / count) : 0);
  }
  const bpm = estimateTempo(envelope, frameMs);
  return { durationMs, bpm, frameMs, envelope };
}

export function estimateTempo(envelope, frameMs = 50) {
  if (!Array.isArray(envelope) || envelope.length < 40) return 120;
  const onset = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  let mean = 0;
  for (const value of onset) mean += value;
  mean /= Math.max(1, onset.length);
  for (let i = 0; i < onset.length; i++) onset[i] = Math.max(0, onset[i] - mean * 0.35);

  let bestBpm = 120, bestScore = -1;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = 60_000 / bpm / frameMs;
    const center = Math.round(lag);
    let score = 0, comparisons = 0;
    for (const shift of [center - 1, center, center + 1]) {
      if (shift < 1) continue;
      let candidate = 0, n = 0;
      for (let i = shift; i < onset.length; i++) { candidate += onset[i] * onset[i - shift]; n++; }
      if (n) { score += candidate / n; comparisons++; }
    }
    score /= Math.max(1, comparisons);
    if (score > bestScore) { bestScore = score; bestBpm = bpm; }
  }
  return Math.round(bestBpm);
}

export function buildMusicPlan(analysis, { bpm, screenColor, accentColor, enhancedProtection = true, groupCount = 0 }) {
  if (!analysis || !Number.isFinite(analysis.durationMs) || !Array.isArray(analysis.envelope)) throw new Error('Analyze a track before building its light score');
  const safeBpm = clamp(Math.round(Number(bpm) || 120), 60, 180);
  const beatMs = 60_000 / safeBpm;
  let beatsPerCue = 16;
  while (Math.ceil(analysis.durationMs / (beatMs * beatsPerCue)) > MAX_SHOW_CUES) beatsPerCue += 16;
  const cueLengthMs = beatMs * beatsPerCue;
  const count = Math.min(MAX_SHOW_CUES, Math.ceil(analysis.durationMs / cueLengthMs));
  const peak = Math.max(0.0001, ...analysis.envelope);
  const cues = [];

  for (let i = 0; i < count; i++) {
    const at = Math.round(i * cueLengthMs);
    const end = Math.min(analysis.durationMs, Math.round((i + 1) * cueLengthMs));
    const first = Math.floor(at / analysis.frameMs), last = Math.min(analysis.envelope.length, Math.ceil(end / analysis.frameMs));
    const energy = analysis.envelope.slice(first, Math.max(first + 1, last)).reduce((sum, value) => sum + value, 0) / Math.max(1, last - first) / peak;
    const flowIndex = Math.floor(clamp(energy, 0, 0.999) * EFFECT_FLOW.length);
    const effect = EFFECT_FLOW[(flowIndex + i * 3) % EFFECT_FLOW.length];
    const baseRate = 0.55 + clamp(energy, 0, 1) * 0.9;
    const rate = normalizeTorchSettings(effect, Math.min(baseRate, maxRateForEffect(effect, enhancedProtection) || 0), enhancedProtection).rate;
    const swap = Math.floor(i / 2) % 2 === 1;
    cues.push({ at, effect, rate, screenColor: swap ? accentColor : screenColor, accentColor: swap ? screenColor : accentColor, group: null });
  }
  return { durationMs: analysis.durationMs, cues, bpm: safeBpm, beatsPerCue };
}
