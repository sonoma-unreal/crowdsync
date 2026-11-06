import { BEAT_MAP_QUANTUM_MS, MAX_BEAT_EVENTS, MAX_BEAT_MAP_LENGTH, maxRateForEffect, normalizeTorchSettings } from './safety.js';

const BEAT_MAP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function encodeBeatMap(times) {
  if (!Array.isArray(times) || !times.length || times.length > MAX_BEAT_EVENTS) throw new Error('Beat count is outside the supported range');
  let previous = 0, encoded = '';
  for (const time of times) {
    const at = Number(time); if (!Number.isFinite(at) || at < 0) throw new Error('Beat time is invalid');
    const units = Math.round(at / BEAT_MAP_QUANTUM_MS), delta = units - previous;
    if (delta < 0 || delta > 2047 || (encoded && delta * BEAT_MAP_QUANTUM_MS < 250)) throw new Error('Detected beats are too close together to encode safely');
    if (delta < 32) encoded += BEAT_MAP_ALPHABET[delta];
    else { encoded += BEAT_MAP_ALPHABET[32 + (delta & 31)]; encoded += BEAT_MAP_ALPHABET[Math.floor(delta / 32)]; }
    previous = units;
  }
  if (encoded.length > MAX_BEAT_MAP_LENGTH) throw new Error('Beat timeline is too large to share');
  return encoded;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MOOD_STYLES = ['beacon', 'ripple', 'wave', 'pulse', 'chase', 'crescendo', 'sparkle', 'march'];

// Analyze mono audio locally in 50 ms windows. Short FFTs provide bass, mid,
// treble, and positive spectral-flux tracks without sending the audio anywhere.
export function analyzeAudioBuffer(buffer, detection = {}) {
  const durationMs = Math.round(buffer.duration * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 10 * 60 * 1000) throw new Error('Choose a track between 1 second and 10 minutes long');
  const frameMs = 50, framesPerWindow = Math.max(1, Math.round(buffer.sampleRate * frameMs / 1000));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const envelope = [], bandEnergy = { low: [], mid: [], high: [] }, bandOnsets = { low: [], mid: [], high: [] };
  const fftSize = 256, real = new Float64Array(fftSize), imaginary = new Float64Array(fftSize), previous = new Float64Array(fftSize / 2);
  for (let start = 0; start < buffer.length; start += framesPerWindow) {
    const end = Math.min(buffer.length, start + framesPerWindow); let square = 0;
    for (let i = 0; i < fftSize; i++) {
      const sampleIndex = Math.min(end - 1, start + Math.floor(i * Math.max(1, end - start) / fftSize));
      let sample = 0; for (const channel of channels) sample += channel[sampleIndex] || 0;
      sample /= channels.length; square += sample * sample;
      real[i] = sample * (.5 - .5 * Math.cos(2 * Math.PI * i / (fftSize - 1))); imaginary[i] = 0;
    }
    envelope.push(Math.sqrt(square / fftSize));
    for (let i = 1, j = 0; i < fftSize; i++) {
      let bit = fftSize >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
    }
    for (let length = 2; length <= fftSize; length <<= 1) {
      const angle = -2 * Math.PI / length, stepReal = Math.cos(angle), stepImag = Math.sin(angle);
      for (let offset = 0; offset < fftSize; offset += length) {
        let wr = 1, wi = 0;
        for (let k = 0; k < length / 2; k++) {
          const even = offset + k, odd = even + length / 2, or = real[odd] * wr - imaginary[odd] * wi, oi = real[odd] * wi + imaginary[odd] * wr;
          real[odd] = real[even] - or; imaginary[odd] = imaginary[even] - oi; real[even] += or; imaginary[even] += oi;
          [wr, wi] = [wr * stepReal - wi * stepImag, wr * stepImag + wi * stepReal];
        }
      }
    }
    const ranges = { low: [1, 5], mid: [6, 30], high: [31, 127] };
    for (const [name, [from, to]] of Object.entries(ranges)) {
      let power = 0, flux = 0;
      for (let bin = from; bin <= to; bin++) { const magnitude = Math.hypot(real[bin], imaginary[bin]) / fftSize; power += magnitude; flux += Math.max(0, magnitude - previous[bin]); previous[bin] = magnitude; }
      bandEnergy[name].push(power / (to - from + 1)); bandOnsets[name].push(flux / (to - from + 1));
    }
  }
  const onsets = envelope.map((_value, index) => .45 * bandOnsets.low[index] + .85 * bandOnsets.mid[index] + 1.1 * bandOnsets.high[index]);
  const analysis = { durationMs, frameMs, envelope, onsets, bandEnergy, bandOnsets };
  analysis.bpm = estimateTempo(onsets, frameMs);
  const beats = detectBeatTimes(analysis, detection);
  return { ...analysis, beatTimes: beats.times, beatStrengths: beats.strengths, beatMode: beats.mode };
}

export function estimateTempo(onsets, frameMs = 50) {
  if (!Array.isArray(onsets) || onsets.length < 40) return 120;
  const values = onsets.map((value) => Math.max(0, Number(value) || 0));
  let mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  for (let i = 0; i < values.length; i++) values[i] = Math.max(0, values[i] - mean * .25);
  let bestBpm = 120, bestScore = -Infinity;
  for (let bpm = 60; bpm <= 180; bpm += .5) {
    const center = Math.round(60_000 / bpm / frameMs); let score = 0, comparisons = 0;
    for (const shift of [center - 1, center, center + 1]) {
      if (shift < 1) continue; let sum = 0, count = 0;
      for (let i = shift; i < values.length; i++) { sum += values[i] * values[i - shift]; count++; }
      if (count) { score += sum / count; comparisons++; }
    }
    score /= Math.max(1, comparisons);
    if (score > bestScore) { bestScore = score; bestBpm = bpm; }
  }
  // Prefer a musical tempo in the common 80–160 BPM range when its half/double
  // alternative has nearly the same autocorrelation score.
  return Math.round(bestBpm);
}

export function detectBeatTimes(analysis, { mode = 'adaptive', sensitivity = 55, minimumGapMs = 300, focus = 'all' } = {}) {
  const { durationMs, envelope, frameMs = 50 } = analysis || {};
  const bpm = clamp(Math.round(Number(analysis?.bpm) || 120), 60, 180);
  if (!Number.isFinite(durationMs) || !Array.isArray(envelope) || envelope.length < 3 || !Number.isFinite(frameMs) || frameMs <= 0) throw new Error('Audio analysis does not contain a usable beat envelope');
  const onset = focus !== 'all' && Array.isArray(analysis.bandOnsets?.[focus]) ? analysis.bandOnsets[focus] : (Array.isArray(analysis.onsets) ? analysis.onsets : envelope.map((value, index) => index ? Math.max(0, Number(value) - Number(envelope[index - 1])) : 0));
  const safeSensitivity = clamp(Number(sensitivity) || 0, 0, 100), safeGap = clamp(Math.round(Number(minimumGapMs) || 300), 250, 1200);
  let sum = 0, squares = 0;
  for (const raw of onset) { const value = Math.max(0, Number(raw) || 0); sum += value; squares += value * value; }
  const mean = sum / onset.length, deviation = Math.sqrt(Math.max(0, squares / onset.length - mean * mean));
  const threshold = Math.max(.00001, mean * (2.05 - safeSensitivity * .013), mean + deviation * (.75 - safeSensitivity * .0045));
  const minGap = Math.max(safeGap, Math.round((60_000 / bpm) * .45)), peaks = [];
  if (mode !== 'grid') for (let i = 1; i < onset.length - 1; i++) {
    const strength = Math.max(0, Number(onset[i]) || 0);
    if (strength < threshold || strength < onset[i - 1] || strength <= onset[i + 1]) continue;
    const beat = { at: Math.min(durationMs - 1, Math.round(i * frameMs)), strength }, last = peaks.at(-1);
    if (last && beat.at - last.at < minGap) { if (beat.strength > last.strength) peaks[peaks.length - 1] = beat; }
    else if (peaks.length < MAX_BEAT_EVENTS) peaks.push(beat);
  }
  const expected = durationMs / (60_000 / bpm);
  if (peaks.length && (mode === 'onsets' || (peaks.length >= 2 && peaks.length >= Math.min(8, expected * .2)))) return { times: peaks.map((beat) => beat.at), strengths: peaks.map((beat) => beat.strength), mode: 'detected' };
  if (mode === 'onsets') return { times: [], strengths: [], mode: 'detected' };
  const times = [], strengths = [], interval = 60_000 / bpm;
  for (let at = 0; at < durationMs && times.length < MAX_BEAT_EVENTS; at += interval) { const time = Math.round(at), frame = Math.max(0, Math.min(onset.length - 1, Math.round(time / frameMs))); times.push(time); strengths.push(Math.max(0, Number(onset[frame]) || 0)); }
  return { times, strengths, mode: 'tempo-grid' };
}

function blendColor(first, second, amount) {
  const a = first.match(/[\da-f]{2}/gi).map((value) => parseInt(value, 16)), b = second.match(/[\da-f]{2}/gi).map((value) => parseInt(value, 16));
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function buildMusicPlan(analysis, { bpm, screenColor, accentColor, enhancedProtection = true, detection = {} } = {}) {
  if (!analysis || !Number.isFinite(analysis.durationMs) || !Array.isArray(analysis.envelope)) throw new Error('Analyze a track before building its light score');
  const safeBpm = clamp(Math.round(Number(bpm) || analysis.bpm || 120), 60, 180), beatResult = analysis.beatMode === 'beat-this' && Array.isArray(analysis.beatTimes)
    ? { times: analysis.beatTimes, strengths: analysis.beatStrengths || analysis.beatTimes.map(() => 1), mode: 'beat-this' }
    : detectBeatTimes({ ...analysis, bpm: safeBpm }, detection);
  if (!beatResult.times.length) throw new Error('No beat transients found. Lower sensitivity or choose Adaptive / Tempo grid.');
  const beatMap = encodeBeatMap(beatResult.times), energy = analysis.envelope.map((value) => Math.max(0, Number(value) || 0)), sorted = [...energy].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * .12)] || 0, high = Math.max(low + 1e-6, sorted[Math.floor(sorted.length * .92)] || 0);
  const strengths = beatResult.strengths, peak = Math.max(.000001, ...strengths), table = [], tableKeys = new Map(), codes = [];
  for (let i = 0; i < beatResult.times.length; i++) {
    const at = beatResult.times[i], frame = clamp(Math.floor(at / (analysis.frameMs || 50)), 0, energy.length - 1), span = Math.max(2, Math.round(60_000 / safeBpm / (analysis.frameMs || 50)));
    const from = Math.max(0, frame - Math.floor(span * .2)), to = Math.min(energy.length, frame + span), local = energy.slice(from, to);
    const level = local.reduce((sum, value) => sum + value, 0) / Math.max(1, local.length), intensity = clamp((level - low) / (high - low), 0, .999), transient = clamp((strengths[i] || 0) / peak, 0, 1);
    const bass = analysis.bandEnergy?.low?.[frame] || 0, treble = analysis.bandEnergy?.high?.[frame] || 0, tone = bass + treble ? treble / (bass + treble) : .5;
    const mood = clamp(intensity * .66 + transient * .24 + tone * .1, 0, .999), effect = MOOD_STYLES[Math.floor(mood * MOOD_STYLES.length)];
    const colorMix = clamp(intensity * .62 + transient * .28 + tone * .1, 0, 1), style = { effect, screenColor: blendColor(screenColor.toLowerCase(), accentColor.toLowerCase(), colorMix) };
    const key = `${style.effect}|${style.screenColor}`;
    if (!tableKeys.has(key)) {
      if (table.length < 32) { tableKeys.set(key, table.length); table.push(style); }
      else tableKeys.set(key, Math.max(0, Math.min(table.length - 1, Math.round(colorMix * (table.length - 1)))));
    }
    codes.push(ALPHABET[tableKeys.get(key)]);
  }
  const fallbackRate = normalizeTorchSettings('pulse', Math.min(1, maxRateForEffect('pulse', enhancedProtection)), enhancedProtection).rate;
  return {
    durationMs: analysis.durationMs,
    cues: [{ at: 0, effect: 'pulse', rate: fallbackRate, screenColor: screenColor.toLowerCase(), accentColor: accentColor.toLowerCase(), group: null }],
    beatMap, beatStyles: codes.join(''), beatStyleTable: table.length ? table : [{ effect: 'pulse', screenColor: screenColor.toLowerCase() }],
    beatCount: beatResult.times.length, beatMode: beatResult.mode, bpm: safeBpm,
  };
}
