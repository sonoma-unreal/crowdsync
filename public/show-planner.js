import { BEAT_MAP_QUANTUM_MS, MAX_BEAT_EVENTS, MAX_BEAT_MAP_LENGTH, maxRateForEffect, normalizeTorchSettings } from './safety.js';

const BEAT_MAP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
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
  const beatResult = detectBeatTimes({ durationMs, bpm, frameMs, envelope });
  return { durationMs, bpm, frameMs, envelope, beatTimes: beatResult.times, beatMode: beatResult.mode };
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

export function detectBeatTimes(analysis) {
  const { durationMs, envelope, frameMs = 50 } = analysis || {};
  const bpm = clamp(Math.round(Number(analysis?.bpm) || 120), 60, 180);
  if (!Number.isFinite(durationMs) || !Array.isArray(envelope) || envelope.length < 3 || !Number.isFinite(frameMs) || frameMs <= 0) {
    throw new Error('Audio analysis does not contain a usable beat envelope');
  }

  const onset = new Float64Array(envelope.length);
  let sum = 0, sumSquares = 0;
  for (let i = 1; i < envelope.length; i++) {
    onset[i] = Math.max(0, Number(envelope[i]) - Number(envelope[i - 1]));
    sum += onset[i]; sumSquares += onset[i] * onset[i];
  }
  const mean = sum / onset.length;
  const deviation = Math.sqrt(Math.max(0, sumSquares / onset.length - mean * mean));
  const threshold = Math.max(0.00001, mean * 1.45, mean + deviation * 0.35);
  const minimumGapMs = Math.max(333, Math.round((60_000 / bpm) * 0.68));
  const peaks = [];
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] < threshold || onset[i] < onset[i - 1] || onset[i] <= onset[i + 1]) continue;
    const peak = { at: Math.min(durationMs - 1, Math.round(i * frameMs)), strength: onset[i] };
    const previous = peaks.at(-1);
    if (previous && peak.at - previous.at < minimumGapMs) {
      if (peak.strength > previous.strength) peaks[peaks.length - 1] = peak;
    } else if (peaks.length < MAX_BEAT_EVENTS) peaks.push(peak);
  }

  const expectedCount = durationMs / (60_000 / bpm);
  if (peaks.length >= 2 && peaks.length >= Math.min(8, expectedCount * 0.25)) {
    return { times: peaks.map(({ at }) => at), mode: 'detected' };
  }

  const times = [];
  const beatMs = 60_000 / bpm;
  for (let at = 0; at < durationMs && times.length < MAX_BEAT_EVENTS; at += beatMs) times.push(Math.round(at));
  return { times, mode: 'tempo-grid' };
}

export function encodeBeatMap(beatTimes) {
  if (!Array.isArray(beatTimes) || beatTimes.length < 1 || beatTimes.length > MAX_BEAT_EVENTS) throw new Error('The detected beat count is outside the supported range');
  let previousUnits = 0;
  let encoded = '';
  for (let i = 0; i < beatTimes.length; i++) {
    const at = Number(beatTimes[i]);
    if (!Number.isFinite(at) || at < 0) throw new Error('A detected beat has an invalid timestamp');
    const units = Math.round(at / BEAT_MAP_QUANTUM_MS);
    const delta = units - previousUnits;
    if (delta < 0 || delta > 1023 || (i > 0 && delta * BEAT_MAP_QUANTUM_MS < 250)) throw new Error('Detected beats are too close together to encode safely');
    if (delta < 32) encoded += BEAT_MAP_ALPHABET[delta];
    else encoded += BEAT_MAP_ALPHABET[32 + (delta & 31)] + BEAT_MAP_ALPHABET[Math.floor(delta / 32)];
    previousUnits = units;
  }
  if (encoded.length > MAX_BEAT_MAP_LENGTH) throw new Error('The beat timeline is too large to share with the room');
  return encoded;
}

export function buildMusicPlan(analysis, { bpm, screenColor, accentColor, enhancedProtection = true } = {}) {
  if (!analysis || !Number.isFinite(analysis.durationMs) || !Array.isArray(analysis.envelope)) throw new Error('Analyze a track before building its light score');
  const safeBpm = clamp(Math.round(Number(bpm) || analysis.bpm || 120), 60, 180);
  const beatResult = detectBeatTimes({ ...analysis, bpm: safeBpm });
  const beatMap = encodeBeatMap(beatResult.times);
  const pulseRate = normalizeTorchSettings('pulse', Math.min(1, maxRateForEffect('pulse', enhancedProtection)), enhancedProtection).rate;
  const cues = [{ at: 0, effect: 'pulse', rate: pulseRate, screenColor, accentColor, group: null }];
  return { durationMs: analysis.durationMs, cues, beatMap, bpm: safeBpm, beatCount: beatResult.times.length, beatMode: beatResult.mode };
}
