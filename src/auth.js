import crypto from 'node:crypto';

const secret = process.env.SESSION_SECRET || '';
const processSigningKey = crypto.randomBytes(32);
export function assertProductionConfig() {
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters in production');
  }
  if (process.env.NODE_ENV === 'production') {
    let base;
    try { base = new URL(process.env.PUBLIC_BASE_URL || ''); } catch { throw new Error('PUBLIC_BASE_URL must be an absolute HTTPS URL in production'); }
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('PUBLIC_BASE_URL must be an HTTPS origin in production');
  }
}

function signingKey() {
  return secret.length >= 32 ? secret : processSigningKey;
}
export function issueToken(claims, ttlMs = 12 * 60 * 60 * 1000) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) || !Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError('Valid token claims and lifetime are required');
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra) return null;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!claims || typeof claims !== 'object' || Array.isArray(claims) || !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now()) return null;
    return claims;
  } catch { return null; }
}
