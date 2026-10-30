export function classifyOperatorDisconnect(code, roomEnded = false) {
  if (roomEnded || code === 1000 || code === 1008) return 'unavailable';
  return 'retry';
}

export function operatorReconnectDelay(attempt, random = Math.random) {
  const exponent = Math.max(0, Math.min(10, Math.trunc(attempt) || 0));
  const base = Math.min(15_000, 1_000 * (2 ** exponent));
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.floor(base * jitter);
}

export function isCurrentOperatorSocket(candidate, current) {
  return candidate === current;
}

export function operatorOriginsMatch(publicUrl, currentOrigin) {
  try {
    return new URL(publicUrl).origin === currentOrigin;
  } catch {
    return false;
  }
}
