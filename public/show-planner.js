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

// Analyze audio locally in 50 ms hops. A longer, Hann-windowed FFT gives the
// detector better low-frequency resolution; spectral flux helps distinguish
// actual attacks from sections that are simply loud.
export function analyzeAudioBuffer(buffer, detection = {}) {
  const durationMs = Math.round(buffer.duration * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 10 * 60 * 1000) throw new Error('Choose a track between 1 second and 10 minutes long');
  const frameMs = 50, hopSamples = Math.max(1, Math.round(buffer.sampleRate * frameMs / 1000));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const envelope = [], bandEnergy = { low: [], mid: [], high: [] }, bandOnsets = { low: [], mid: [], high: [] };
  // Transform each channel independently at roughly 22 kHz. Averaging spectral
  // magnitudes prevents phase cancellation in wide stereo mixes without the
  // cost of a full-rate transform for every channel.
  const fftSize = 512, fftStride = Math.max(1, Math.round(buffer.sampleRate / 22_050)), fftRate = buffer.sampleRate / fftStride;
  const real = new Float64Array(fftSize), imaginary = new Float64Array(fftSize), hann = Float64Array.from({ length: fftSize }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (fftSize - 1))), previous = channels.map(() => new Float64Array(fftSize / 2));
  const ranges = {
    low: [Math.max(1, Math.floor(35 * fftSize / fftRate)), Math.max(2, Math.ceil(180 * fftSize / fftRate))],
    mid: [Math.max(3, Math.floor(180 * fftSize / fftRate)), Math.max(4, Math.ceil(2_500 * fftSize / fftRate))],
    high: [Math.max(5, Math.floor(2_500 * fftSize / fftRate)), Math.min(fftSize / 2 - 1, Math.ceil(10_000 * fftSize / fftRate))],
  };
  const frameCount = Math.ceil(buffer.length / hopSamples), halfFft = fftSize >> 1, windowStride = halfFft * fftStride;
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSamples, end = Math.min(buffer.length, start + hopSamples); let square = 0, samples = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
      let power = 0;
      for (const channel of channels) { const value = channel[sampleIndex] || 0; power += value * value; }
      square += power / channels.length; samples++;
    }
    envelope.push(Math.sqrt(square / Math.max(1, samples)));
    const center = start + Math.floor((end - start) / 2), windowStart = center - windowStride;
    const bandPower = { low: 0, mid: 0, high: 0 }, bandFlux = { low: 0, mid: 0, high: 0 };
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const channel = channels[channelIndex], prior = previous[channelIndex];
      for (let i = 0; i < fftSize; i++) {
        const sampleIndex = windowStart + i * fftStride, sample = sampleIndex >= 0 && sampleIndex < buffer.length ? channel[sampleIndex] || 0 : 0;
        real[i] = sample * hann[i]; imaginary[i] = 0;
      }
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
      for (const [name, [from, to]] of Object.entries(ranges)) {
        let power = 0, flux = 0;
        for (let bin = from; bin <= to; bin++) {
          const magnitude = Math.hypot(real[bin], imaginary[bin]) * 2 / fftSize;
          power += magnitude;
          const perceptualMagnitude = Math.log1p(magnitude * 128);
          flux += Math.max(0, perceptualMagnitude - prior[bin]); prior[bin] = perceptualMagnitude;
        }
        bandPower[name] += power; bandFlux[name] += flux;
      }
    }
    for (const [name, [from, to]] of Object.entries(ranges)) {
      const count = Math.max(1, to - from + 1);
      bandEnergy[name].push(bandPower[name] / (channels.length * count));
      // The square-root count scaling avoids letting the wide treble band drown
      // out bass and midrange attacks.
      bandOnsets[name].push(bandFlux[name] / (channels.length * Math.sqrt(count)));
    }
  }
  const envelopeFlux = envelope.map((value, index) => index ? Math.max(0, value - envelope[index - 1]) : 0);
  const normalized = Object.fromEntries(Object.entries(bandOnsets).map(([name, values]) => [name, normalizePositive(values)]));
  const normalizedEnvelopeFlux = normalizePositive(envelopeFlux);
  const onsets = envelope.map((_value, index) => .3 * normalized.low[index] + .4 * normalized.mid[index] + .3 * normalized.high[index] + .3 * normalizedEnvelopeFlux[index]);
  const analysis = { durationMs, frameMs, envelope, onsets, bandEnergy, bandOnsets, envelopeFlux };
  const tempo = estimateTempoDetails(onsets, frameMs);
  analysis.bpm = tempo.bpm; analysis.tempoConfidence = tempo.confidence;
  const beats = detectBeatTimes(analysis, detection);
  return { ...analysis, beatTimes: beats.times, beatStrengths: beats.strengths, beatMode: beats.mode };
}

export function estimateTempo(onsets, frameMs = 50) {
  return estimateTempoDetails(onsets, frameMs).bpm;
}

function estimateTempoDetails(onsets, frameMs = 50) {
  if (!Array.isArray(onsets) || onsets.length < 40 || !Number.isFinite(frameMs) || frameMs <= 0) return { bpm: 120, confidence: 0 };
  const values = onsets.map((value) => Math.max(0, Number(value) || 0)), radius = Math.max(2, Math.round(750 / frameMs));
  let squareSum = 0;
  for (let i = 0; i < values.length; i++) {
    let local = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) { local += values[j]; count++; }
    values[i] = Math.max(0, values[i] - local / Math.max(1, count)); squareSum += values[i] * values[i];
  }
  const rms = Math.sqrt(squareSum / values.length);
  if (rms < 1e-8) return { bpm: 120, confidence: 0 };
  for (let i = 0; i < values.length; i++) values[i] /= rms;
  let bestBpm = 120, bestScore = -Infinity, secondScore = -Infinity;
  for (let bpm = 60; bpm <= 180; bpm += .5) {
    const lag = 60_000 / bpm / frameMs, score = normalizedAutocorrelation(values, lag);
    // A light prior resolves octave-equivalent tempos in favor of the common
    // range without forcing tracks outside it to an arbitrary BPM.
    const prior = Math.exp(-Math.pow((bpm - 118) / 115, 2) * .035), adjusted = score * prior;
    if (adjusted > bestScore) { secondScore = bestScore; bestScore = adjusted; bestBpm = bpm; }
    else if (adjusted > secondScore && Math.abs(bpm - bestBpm) > 3) secondScore = adjusted;
  }
  return { bpm: Math.round(bestBpm), confidence: clamp(bestScore > 0 ? (bestScore - Math.max(0, secondScore)) / bestScore : 0, 0, 1) };
}

function normalizedAutocorrelation(values, lag) {
  const whole = Math.floor(lag), fraction = lag - whole;
  let product = 0, currentPower = 0, previousPower = 0, count = 0;
  for (let i = whole + 1; i < values.length; i++) {
    const previous = values[i - whole] * (1 - fraction) + values[i - whole - 1] * fraction, current = values[i];
    product += current * previous; currentPower += current * current; previousPower += previous * previous; count++;
  }
  return count ? product / Math.sqrt(Math.max(1e-12, currentPower * previousPower)) : 0;
}

function normalizePositive(values) {
  const sorted = values.map((value) => Math.max(0, Number(value) || 0)).sort((a, b) => a - b);
  const scale = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .9))] || sorted.at(-1) || 1;
  return values.map((value) => Math.min(4, Math.max(0, Number(value) || 0) / Math.max(scale, 1e-9)));
}

function localBaseline(values, radius) {
  const baseline = new Float64Array(values.length), deviation = new Float64Array(values.length), sums = new Float64Array(values.length + 1), squares = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) {
    const value = Math.max(0, Number(values[i]) || 0);
    sums[i + 1] = sums[i] + value; squares[i + 1] = squares[i] + value * value;
  }
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - radius), to = Math.min(values.length, i + radius + 1), count = to - from;
    const mean = (sums[to] - sums[from]) / count, meanSquare = (squares[to] - squares[from]) / count;
    baseline[i] = mean; deviation[i] = Math.sqrt(Math.max(0, meanSquare - mean * mean));
  }
  return { baseline, deviation };
}

function bestGridPhase(onset, intervalFrames) {
  if (!onset.length || intervalFrames <= 0) return 0;
  const steps = Math.max(8, Math.min(64, Math.round(intervalFrames * 2))), step = intervalFrames / steps;
  let bestPhase = 0, bestScore = -Infinity;
  for (let candidate = 0; candidate < steps; candidate++) {
    const phase = candidate * step; let score = 0, count = 0;
    for (let frame = phase; frame < onset.length; frame += intervalFrames) {
      score += Math.max(0, Number(onset[Math.min(onset.length - 1, Math.round(frame))]) || 0); count++;
    }
    score /= Math.max(1, count);
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }
  return bestPhase;
}

export function detectBeatTimes(analysis, { mode = 'adaptive', sensitivity = 55, minimumGapMs = 300, focus = 'all' } = {}) {
  const { durationMs, envelope, frameMs = 50 } = analysis || {};
  const bpm = clamp(Math.round(Number(analysis?.bpm) || 120), 60, 180);
  if (!Number.isFinite(durationMs) || !Array.isArray(envelope) || envelope.length < 3 || !Number.isFinite(frameMs) || frameMs <= 0) throw new Error('Audio analysis does not contain a usable beat envelope');
  const onset = focus !== 'all' && Array.isArray(analysis.bandOnsets?.[focus]) ? analysis.bandOnsets[focus] : (Array.isArray(analysis.onsets) ? analysis.onsets : envelope.map((value, index) => index ? Math.max(0, Number(value) - Number(envelope[index - 1])) : 0));
  const safeSensitivity = clamp(Number(sensitivity) || 0, 0, 100), safeGap = clamp(Math.round(Number(minimumGapMs) || 300), 250, 1200);
  const usableOnset = onset.slice(0, envelope.length).map((value) => Math.max(0, Number(value) || 0));
  if (usableOnset.length < 3) return { times: [], strengths: [], mode: mode === 'onsets' ? 'detected' : 'tempo-grid' };
  const radius = Math.max(3, Math.round(900 / frameMs)), { baseline, deviation } = localBaseline(usableOnset, radius);
  const sorted = [...usableOnset].sort((a, b) => a - b), globalScale = sorted[Math.floor(sorted.length * .95)] || 0;
  const prominence = 2.8 - safeSensitivity * .022, floorRatio = .13 - safeSensitivity * .00105;
  const intervalMs = 60_000 / bpm, minGap = Math.max(safeGap, Math.round(intervalMs * .36)), peaks = [];
  const gridPhase = bestGridPhase(usableOnset, intervalMs / frameMs);
  if (mode !== 'grid') for (let i = 1; i < usableOnset.length - 1; i++) {
    const strength = usableOnset[i];
    const threshold = baseline[i] + Math.max(deviation[i] * prominence, globalScale * Math.max(.025, floorRatio));
    if (strength < threshold || strength < usableOnset[i - 1] || strength <= usableOnset[i + 1]) continue;
    // A five-frame neighbourhood rejects little FFT ripples around one attack.
    let localMax = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(usableOnset.length - 1, i + 2); j++) if (j !== i && usableOnset[j] > strength) { localMax = false; break; }
    if (!localMax) continue;
    const beat = { at: Math.min(durationMs - 1, Math.round(i * frameMs)), strength }, last = peaks.at(-1);
    if (last && beat.at - last.at < minGap) { if (beat.strength > last.strength) peaks[peaks.length - 1] = beat; }
    else if (peaks.length < MAX_BEAT_EVENTS) peaks.push(beat);
  }
  const expected = durationMs / (60_000 / bpm);
  const phaseMs = gridPhase * frameMs, aligned = peaks.filter((beat) => {
    const nearest = Math.round((beat.at - phaseMs) / intervalMs), distance = Math.abs(beat.at - (phaseMs + nearest * intervalMs));
    return nearest >= 0 && distance <= Math.min(140, intervalMs * .22);
  });
  const enoughTransients = peaks.length >= Math.max(2, Math.min(6, Math.ceil(expected * .18)));
  const supportedGrid = aligned.length >= Math.max(2, Math.min(5, Math.ceil(expected * .2)));
  if (peaks.length && (mode === 'onsets' || (mode === 'adaptive' && enoughTransients && (supportedGrid || peaks.length >= Math.min(8, expected * .35))))) return { times: peaks.map((beat) => beat.at), strengths: peaks.map((beat) => beat.strength), mode: 'detected' };
  if (mode === 'onsets') return { times: [], strengths: [], mode: 'detected' };
  const times = [], strengths = [];
  for (let at = phaseMs; at < durationMs && times.length < MAX_BEAT_EVENTS; at += intervalMs) { const time = Math.max(0, Math.round(at)), frame = Math.max(0, Math.min(usableOnset.length - 1, Math.round(time / frameMs))); times.push(time); strengths.push(Math.max(0, Number(usableOnset[frame]) || 0)); }
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
