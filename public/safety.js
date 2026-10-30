export const MAX_FLASHES_PER_SECOND = 3;
export const ENHANCED_MAX_FLASHES_PER_SECOND = 1.5;
export const MIN_TORCH_EDGE_GAP_MS = 1000 / MAX_FLASHES_PER_SECOND;
export const MAX_SHOW_CUES = 24;
export const MAX_SHOW_DURATION_MS = 10 * 60 * 1000;

export const TORCH_EFFECTS = Object.freeze({
  pulse:      { label: 'Pulse',        description: 'A soft, even beacon pulse.', pulses: 1, kind: 'pulse' },
  doubleBeat: { label: 'Double beat', description: 'Two short pulses, then a breath.', pulses: 2, kind: 'double' },
  heartbeat:  { label: 'Heartbeat',    description: 'A paired heartbeat rhythm.', pulses: 2, kind: 'heartbeat' },
  beacon:     { label: 'Beacon',       description: 'A clear signal with a long dark interval.', pulses: 1, kind: 'beacon' },
  siren:      { label: 'Siren sweep',  description: 'Alternating long and short torch bursts.', pulses: 2, kind: 'siren' },
  wave:       { label: 'Stadium wave', description: 'A traveling pulse spreads across joined phones.', pulses: 1, kind: 'wave' },
  ripple:     { label: 'Ripple',       description: 'Two traveling pulses ripple through the crowd.', pulses: 2, kind: 'ripple' },
  sparkle:    { label: 'Sparkle',      description: 'Each phone twinkles at a different point in the shared cycle.', pulses: 1, kind: 'sparkle' },
  twinkle:    { label: 'Twinkle',      description: 'A scattered, randomized constellation of brief pulses.', pulses: 1, kind: 'twinkle' },
  comet:      { label: 'Comet',        description: 'A bright point travels from phone to phone.', pulses: 1, kind: 'comet' },
  morse:      { label: 'Morse',        description: 'A three-tap signal pattern with a long rest.', pulses: 3, kind: 'morse' },
  chase:      { label: 'Chase',        description: 'A crisp traveling chase across the audience.', pulses: 1, kind: 'chase' },
  march:      { label: 'March',        description: 'A steady double-step for a team entrance.', pulses: 2, kind: 'march' },
  stutter:    { label: 'Stutter',      description: 'Three quick taps; the fixed rate governor still applies.', pulses: 3, kind: 'stutter' },
  crescendo:  { label: 'Crescendo',    description: 'A long torch hold followed by a measured release.', pulses: 1, kind: 'crescendo' },
  solid:      { label: 'Solid light', description: 'Hold the selected screen color; torches stay on while the cue runs.', pulses: 0, kind: 'solid' },
  rapidSparkle:{ label:'Rapid sparkles',description:'A scattered crowd shimmer; each phone stays under the set flash cap.',pulses:1,kind:'rapidSparkle' },
});

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function maxRateForEffect(effect, enhancedProtection = true) {
  const spec = TORCH_EFFECTS[effect];
  if (!spec || spec.pulses === 0) return 0;
  const overallLimit = enhancedProtection ? ENHANCED_MAX_FLASHES_PER_SECOND : MAX_FLASHES_PER_SECOND;
  return overallLimit / spec.pulses;
}

export function normalizeTorchSettings(effect, rate, enhancedProtection = true) {
  const spec = TORCH_EFFECTS[effect] ? effect : 'pulse';
  const cap = maxRateForEffect(spec, enhancedProtection);
  return { effect: spec, rate: cap ? clamp(rate, 0.25, cap) : 0, maxRate: cap };
}

// The controller compiles audio locally into a small, bounded cue sheet. Only
// effect parameters and cue timing cross the network; audio and track metadata
// stay in the controller's browser.
export function normalizeShowPlan(plan, enhancedProtection = true) {
  if (plan === null) return { ok: true, plan: null };
  if (!plan || Object.getPrototypeOf(plan) !== Object.prototype || Object.keys(plan).some((key) => !['durationMs', 'cues'].includes(key))) {
    return { ok: false, error: 'Show plan has an invalid structure' };
  }
  if (!Number.isSafeInteger(plan.durationMs) || plan.durationMs < 1_000 || plan.durationMs > MAX_SHOW_DURATION_MS) {
    return { ok: false, error: 'Show duration must be between 1 second and 10 minutes' };
  }
  if (!Array.isArray(plan.cues) || plan.cues.length < 1 || plan.cues.length > MAX_SHOW_CUES) {
    return { ok: false, error: `A show must contain between 1 and ${MAX_SHOW_CUES} cues` };
  }
  const cues = [];
  let previousAt = -1_000;
  for (const cue of plan.cues) {
    if (!cue || Object.getPrototypeOf(cue) !== Object.prototype || Object.keys(cue).some((key) => !['at', 'effect', 'rate', 'screenColor', 'accentColor', 'group'].includes(key))) {
      return { ok: false, error: 'A show cue has an invalid structure' };
    }
    if (!Number.isSafeInteger(cue.at) || cue.at < 0 || cue.at >= plan.durationMs || cue.at - previousAt < 1_000 ||
        typeof cue.effect !== 'string' || !Object.hasOwn(TORCH_EFFECTS, cue.effect) ||
        typeof cue.rate !== 'number' || !Number.isFinite(cue.rate) || cue.rate < 0 || cue.rate > 3 ||
        typeof cue.screenColor !== 'string' || !/^#[\da-f]{6}$/i.test(cue.screenColor) ||
        typeof cue.accentColor !== 'string' || !/^#[\da-f]{6}$/i.test(cue.accentColor) ||
        (cue.group !== undefined && cue.group !== null && (!Number.isSafeInteger(cue.group) || cue.group < 0 || cue.group >= 6))) {
      return { ok: false, error: 'A show cue contains an unsupported effect or value' };
    }
    if (cues.length === 0 && cue.at !== 0) return { ok: false, error: 'The first show cue must begin at zero' };
    const normalized = normalizeTorchSettings(cue.effect, cue.rate, enhancedProtection);
    cues.push({ at: cue.at, effect: normalized.effect, rate: normalized.rate, screenColor: cue.screenColor.toLowerCase(), accentColor: cue.accentColor.toLowerCase(), group: cue.group ?? null });
    previousAt = cue.at;
  }
  return { ok: true, plan: { durationMs: plan.durationMs, cues } };
}

export function showCueAt(plan, elapsedMs) {
  if (!plan || !Array.isArray(plan.cues) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= plan.durationMs) return null;
  let low = 0;
  let high = plan.cues.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (plan.cues[middle].at <= elapsedMs) low = middle + 1;
    else high = middle - 1;
  }
  return high >= 0 ? plan.cues[high] : null;
}

export function showStateAt(state, serverTimeMs, groupIndex = null) {
  if (!state?.showPlan || state.status !== 'running') return state;
  const elapsed = serverTimeMs - state.startedAt;
  const cue = showCueAt(state.showPlan, elapsed);
  if (!cue || (cue.group !== null && cue.group !== groupIndex)) return { ...state, status: 'idle', torchEnabled: false };
  return { ...state, effect: cue.effect, rate: cue.rate, screenColor: cue.screenColor, accentColor: cue.accentColor, startedAt: state.startedAt + cue.at };
}

const mod = (n, m) => ((n % m) + m) % m;
function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Pure, time-derived torch program. It returns only an on/off request; physical
// LEDs do not expose brightness ramps consistently across browsers and hardware.
export function sampleTorch(state, serverTimeMs, audienceSeed = 0, audienceIndex = 0, audienceTotal = 1) {
  if (!state || state.status !== 'running' || !state.torchEnabled) return false;
  const spec = TORCH_EFFECTS[state.effect];
  if (!spec) return false;
  if (serverTimeMs < state.startedAt) return false;
  if (spec.kind === 'solid') return true;
  const rate = normalizeTorchSettings(state.effect, state.rate, state.enhancedProtection).rate;
  if (!rate) return false;
  const period = 1000 / rate;
  const t = Math.max(0, serverTimeMs - state.startedAt);
  const basePhase = mod(t, period) / period;
  const split = (windows) => windows.some(([from, to]) => basePhase >= from && basePhase < to);

  switch (spec.kind) {
    case 'pulse': return basePhase < 0.22;
    case 'double': return split([[0.04, 0.16], [0.36, 0.48]]);
    case 'heartbeat': return split([[0.04, 0.13], [0.22, 0.31]]);
    case 'beacon': return basePhase < 0.12;
    case 'siren': return split([[0.02, 0.27], [0.52, 0.62]]);
    case 'wave':
    case 'ripple': {
      const total = Math.max(1, audienceTotal);
      const shift = (mod(audienceIndex, total) / total) * period;
      const phase = mod(t - shift, period) / period;
      return spec.kind === 'wave' ? phase < 0.16 : phase < 0.1 || (phase >= 0.4 && phase < 0.5);
    }
    case 'sparkle': {
      const cycle = Math.floor(t / period);
      const offset = 0.1 + hash01((audienceSeed | 0) ^ cycle) * 0.72;
      return basePhase >= offset && basePhase < offset + 0.08;
    }
    case 'rapidSparkle': {
      const cycle = Math.floor(t / period);
      const phase = mod(t, period) / period;
      const lane = mod(audienceIndex, Math.max(1, audienceTotal));
      const offset = 0.04 + hash01((audienceSeed | 0) ^ cycle ^ Math.imul(lane + 1, 0x45d9f3b)) * 0.78;
      const skips = hash01((audienceSeed | 0) ^ cycle ^ Math.imul(lane + 3, 0x27d4eb2d));
      return skips > 0.14 && phase >= offset && phase < offset + 0.09;
    }
    case 'twinkle': {
      const cycle = Math.floor(t / (period * 3));
      const phase = mod(t, period * 3) / (period * 3);
      const pick = hash01((audienceSeed | 0) ^ cycle);
      const at = 0.08 + pick * 0.72;
      return phase >= at && phase < at + 0.035;
    }
    case 'comet':
    case 'chase': {
      const total = Math.max(1, audienceTotal);
      const normalized = mod(t / period - audienceIndex / total, 1);
      return spec.kind === 'comet' ? normalized < 0.12 : normalized < 0.18;
    }
    case 'morse': return split([[0.02, 0.08], [0.14, 0.20], [0.26, 0.32]]);
    case 'march': return split([[0.03, 0.15], [0.28, 0.40]]);
    case 'stutter': return split([[0.02, 0.09], [0.14, 0.21], [0.26, 0.33]]);
    case 'crescendo': return basePhase < 0.58;
    default: return false;
  }
}

// Device-side backstop: at most three rising edges in any rolling second,
// plus a minimum 333 ms gap. Falling edges always pass so Stop is immediate.
export function createTorchGovernor() {
  let isOn = false;
  const risingEdges = [];
  return function governTorch(wanted, nowMs, enhancedProtection = true) {
    if (!wanted) { isOn = false; return false; }
    if (isOn) return true;
    const windowMs = 1000;
    while (risingEdges.length && nowMs - risingEdges[0] >= windowMs) risingEdges.shift();
    const minimumGap = 1000 / (enhancedProtection ? ENHANCED_MAX_FLASHES_PER_SECOND : MAX_FLASHES_PER_SECOND);
    const previous = risingEdges[risingEdges.length - 1] ?? -Infinity;
    if (risingEdges.length >= MAX_FLASHES_PER_SECOND || nowMs - previous < minimumGap) return false;
    risingEdges.push(nowMs); isOn = true;
    return true;
  };
}
