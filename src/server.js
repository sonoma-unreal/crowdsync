if (process.env.NODE_ENV !== 'test') await import('dotenv/config');
import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { assertProductionConfig, issueToken, verifyToken } from './auth.js';
import { createAccountStore, SESSION_COOKIE_MAX_AGE } from './account-store.js';
import { normalizeShowPlan, normalizeTorchSettings, TORCH_EFFECTS } from './safety.js';

assertProductionConfig();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const configuredBase = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : null;
if (configuredBase && (!['http:', 'https:'].includes(configuredBase.protocol) || configuredBase.username || configuredBase.password || configuredBase.pathname !== '/' || configuredBase.search || configuredBase.hash)) {
  throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without credentials or a path');
}
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const googleAuthEnabled = Boolean(googleClientId && googleClientSecret);
const configuredGoogleCallback = process.env.GOOGLE_CALLBACK_URL ? new URL(process.env.GOOGLE_CALLBACK_URL) : null;
if (configuredGoogleCallback && (configuredGoogleCallback.pathname !== '/auth/google/callback' || configuredGoogleCallback.search || configuredGoogleCallback.hash || configuredGoogleCallback.username || configuredGoogleCallback.password || !['http:', 'https:'].includes(configuredGoogleCallback.protocol) || (process.env.NODE_ENV === 'production' && configuredGoogleCallback.protocol !== 'https:') || (configuredBase && configuredGoogleCallback.origin !== configuredBase.origin))) {
  throw new Error('GOOGLE_CALLBACK_URL must be the /auth/google/callback URL on PUBLIC_BASE_URL (HTTPS in production)');
}
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info', serializers: { req: (request) => ({ method: request.method, url: (() => { try { return new URL(request.url, 'http://localhost').pathname; } catch { return '/'; } })() }) } },
  bodyLimit: 16 * 1024,
});
const accountStore = createAccountStore();
await accountStore.initialize();
if (!accountStore.persistent && process.env.NODE_ENV === 'production') app.log.warn('DATABASE_URL is not configured; account sessions and saved shows are temporary until the server restarts');
app.addHook('onClose', async () => accountStore.close());
const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
const rooms = new Map();
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
const serverNow = () => performance.now();
function positiveLimit(name, fallback, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be a whole number between 1 and ${maximum}`);
  return value;
}
const maxRooms = positiveLimit('MAX_ROOMS', 100, 1000);
const maxAudience = positiveLimit('MAX_AUDIENCE_PER_ROOM', 2000, 10000);
const maxWebSockets = positiveLimit('MAX_WEBSOCKET_CONNECTIONS', 5000, 20000);
const showLeaseMs = positiveLimit('SHOW_CONTROL_LEASE_MS', 30_000, 120_000);
const roomLookupsPerMinute = positiveLimit('ROOM_LOOKUPS_PER_MINUTE', 300, 60000);
const operatorCommandsPerWindow = positiveLimit('OPERATOR_COMMANDS_PER_10_SECONDS', 200, 2000);
const startLeadMs = 1200;
const createTimestamps = new Map();
const googleAuthTimestamps = new Map();
const roomLookupTimestamps = new Map();
const operatorCommandTimestamps = new Map();
function consumeRateLimit(map, key, limit, windowMs, now = Date.now()) {
  const recent = (map.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  const retryAfter = recent.length ? Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) : 1;
  if (recent.length >= limit) {
    map.delete(key); map.set(key, recent);
    return { allowed: false, retryAfter };
  }
  recent.push(now);
  if (!map.has(key) && map.size >= 5000) map.delete(map.keys().next().value);
  map.delete(key); map.set(key, recent);
  return { allowed: true, retryAfter: 0 };
}
function siteOrigin(req) {
  if (configuredBase) return configuredBase.origin;
  const host = String(req.headers.host || 'localhost');
  const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) || /^\[[a-f0-9:]+\](?::\d{1,5})?$/i.test(host) ? host : 'localhost';
  return `${req.protocol === 'https' ? 'https' : 'http'}://${safeHost}`;
}
function hasSameOrigin(req) {
  if (typeof req.headers.origin !== 'string') return false;
  try { return new URL(req.headers.origin).origin === siteOrigin(req); } catch { return false; }
}
function requestCookie(req, name) {
  const prefix = `${name}=`;
  for (const part of String(req.headers.cookie || '').split(';')) {
    const cookie = part.trim();
    if (!cookie.startsWith(prefix)) continue;
    try { return decodeURIComponent(cookie.slice(prefix.length)); } catch { return ''; }
  }
  return '';
}
function sessionCookie(name, value, maxAge, req) {
  const secure = process.env.NODE_ENV === 'production' || siteOrigin(req).startsWith('https://');
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function googleCallbackUrl(req) {
  return configuredGoogleCallback?.toString() || `${siteOrigin(req)}/auth/google/callback`;
}
function googleOauthClient(req) {
  if (!googleAuthEnabled) return null;
  return new OAuth2Client({ clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleCallbackUrl(req) });
}
async function accountFromRequest(req, reply) {
  const token = requestCookie(req, 'lightsync_account');
  const account = await accountStore.readSession(token);
  if (account) return account;
  const claims = verifyToken(token);
  if (claims?.role === 'account' && typeof claims.sub === 'string' && typeof claims.email === 'string') {
    const name = typeof claims.name === 'string' ? claims.name : '';
    const profile = { sub: claims.sub, email: claims.email, name, firstName: name.split(/\s+/)[0] || '' };
    // Keep current users signed in across the account-session format change.
    if (process.env.NODE_ENV === 'test') return profile;
    const replacement = await accountStore.createSession(profile);
    req.lightsyncAccountToken = replacement;
    reply?.header('Set-Cookie', sessionCookie('lightsync_account', replacement, SESSION_COOKIE_MAX_AGE, req));
    return profile;
  }
  return null;
}
function equalText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const joinUrl = (id, request) => {
  const host = String(request.headers.host || 'localhost');
  const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) || /^\[[a-f0-9:]+\](?::\d{1,5})?$/i.test(host) ? host : 'localhost';
  const base = configuredBase?.origin || `${request.protocol === 'https' ? 'https' : 'http'}://${safeHost}`;
  return `${base}/join/${id}`;
};
const roomState = (room) => ({ id: room.id, name: room.name, status: room.status, effect: room.effect, rate: room.rate, torchEnabled: room.torchEnabled, screenMode: room.screenMode, screenColor: room.screenColor, accentColor: room.accentColor, enhancedProtection: room.enhancedProtection, startedAt: room.startedAt, pausedAt: room.pausedAt, epoch: room.epoch, sequence: room.sequence, audience: room.audience.size, waiting: room.waiting.size, groups: room.groups.map((name, index) => ({ index, name, joined: [...room.audience].filter((ws) => ws.groupIndex === index).length })), syncTest: room.syncTest, marquee: room.marquee, showPlan: room.showPlan });
function savedRoomConfig(room) {
  return {
    effect: room.effect,
    rate: room.rate,
    enhancedProtection: room.enhancedProtection,
    screenColor: room.screenColor,
    accentColor: room.accentColor,
    groups: room.groups,
    marquee: room.marquee,
    showPlan: room.showPlan,
  };
}
function roomFromSavedConfig(id, name, ownerSub, savedShowId, config = {}) {
  const enhancedProtection = config.enhancedProtection !== false;
  const requestedEffect = typeof config.effect === 'string' && Object.hasOwn(TORCH_EFFECTS, config.effect) ? config.effect : 'solid';
  const requestedRate = typeof config.rate === 'number' && Number.isFinite(config.rate) ? config.rate : 1.2;
  const look = normalizeTorchSettings(requestedEffect, requestedRate, enhancedProtection);
  const groups = Array.isArray(config.groups) && config.groups.length >= 2 && config.groups.length <= 6 && config.groups.every((group) => typeof group === 'string' && group.trim().length > 0 && group.trim().length <= 24)
    ? config.groups.map((group) => group.trim()) : [];
  const colorsValid = typeof config.screenColor === 'string' && /^#[\da-f]{6}$/i.test(config.screenColor) && typeof config.accentColor === 'string' && /^#[\da-f]{6}$/i.test(config.accentColor);
  const planResult = normalizeShowPlan(config.showPlan, enhancedProtection);
  const showPlan = planResult.ok && (!planResult.plan || planResult.plan.cues.every((cue) => cue.group === null || cue.group < groups.length)) ? planResult.plan : null;
  return {
    id, instance: crypto.randomUUID(), name, ownerSub, savedShowId,
    status: 'idle', effect: look.effect, rate: look.rate, enhancedProtection,
    // Guests can participate as soon as the host starts the show. The output
    // remains dark while idle, and stop/blackout still force it off.
    torchEnabled: true, screenMode: false,
    screenColor: colorsValid ? config.screenColor.toLowerCase() : '#25c3e8',
    accentColor: colorsValid ? config.accentColor.toLowerCase() : '#a855f7',
    startedAt: 0, pausedAt: 0, epoch: 0, sequence: 0, lastCommandId: 0,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000, audience: new Set(), waiting: new Set(), operators: new Set(), clockProbes: new Map(),
    audienceIndex: 0, groups, syncTest: { active: false, completed: false, testId: 0, startedAt: 0 },
    marquee: typeof config.marquee === 'string' ? config.marquee.replace(/[<>]/g, '').trim().slice(0, 90) : '',
    showPlan,
  };
}
function saveRoomSnapshot(room) {
  if (!room.ownerSub || !room.savedShowId) return Promise.resolve();
  const ownerSub = room.ownerSub, savedShowId = room.savedShowId, name = room.name;
  const config = savedRoomConfig(room);
  room.saveQueue = (room.saveQueue || Promise.resolve()).catch(() => {}).then(() => accountStore.updateShow(ownerSub, savedShowId, name, config));
  return room.saveQueue;
}
const savedShowCommands = new Set(['effect', 'rate', 'protection', 'screen-colors', 'show-plan', 'groups', 'marquee']);
const send = (ws, data) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 1_048_576) { ws.close(1013, 'Slow client'); return; }
  ws.send(JSON.stringify(data));
};
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  const offsetWheelFrame = request.url.split('?')[0] === '/assets/offset-wheel.html';
  reply.header('X-Frame-Options', offsetWheelFrame ? 'SAMEORIGIN' : 'DENY');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('X-DNS-Prefetch-Control', 'off');
  const requestHost = String(request.headers.host || 'localhost');
  const safeRequestHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(requestHost) || /^\[[a-f0-9:]+\](?::\d{1,5})?$/i.test(requestHost) ? requestHost : 'localhost';
  const websocketHost = configuredBase?.host || safeRequestHost;
  const websocketProtocol = configuredBase?.protocol || (request.protocol === 'https' ? 'https:' : 'http:');
  const websocketSource = `${websocketProtocol === 'https:' ? 'wss' : 'ws'}://${websocketHost}`;
  reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${websocketSource}; media-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors ${offsetWheelFrame ? "'self'" : "'none'"}`);
  reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return payload;
});
function publish(room, type = 'state') {
  room.sequence++;
  const packet = { type, state: roomState(room) };
  for (const ws of room.audience) send(ws, packet);
  for (const ws of room.waiting) send(ws, packet);
  for (const ws of room.operators) send(ws, packet);
}
function publishPresence(room) {
  if (room.presenceTimer) return;
  room.presenceTimer = setTimeout(() => { room.presenceTimer = null; publish(room); }, 50);
  room.presenceTimer.unref();
}
function authenticate(req, reply) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const claims = verifyToken(token);
  if (!claims || claims.role !== 'operator' || !rooms.has(claims.room) || claims.instance !== rooms.get(claims.room).instance) {
    reply.code(401).send({ error: 'Valid room operator token required' }); return null;
  }
  return { claims, room: rooms.get(claims.room) };
}
const commandFields = Object.freeze({
  start: [], resume: [], 'sync-start': [], 'sync-stop': [], pause: [], stop: [], blackout: [], 'clear-blackout': [],
  effect: ['effect', 'rate'], rate: ['value'], protection: ['enabled', 'acknowledgedRisk'], torch: ['enabled'], 'screen-mode': ['enabled'],
  'screen-colors': ['screenColor', 'accentColor'], 'show-plan': ['plan'], groups: ['groups'], marquee: ['text'],
});
function validateCommand(message) {
  if (!message || Object.getPrototypeOf(message) !== Object.prototype || message.type !== 'command' || typeof message.command !== 'string' || !Object.hasOwn(commandFields, message.command)) return false;
  const allowed = new Set(['type', 'command', 'commandId', ...commandFields[message.command]]);
  if (Object.keys(message).some((key) => !allowed.has(key)) || !Number.isSafeInteger(message.commandId) || message.commandId < 1) return false;
  switch (message.command) {
    case 'effect': return typeof message.effect === 'string' && Object.hasOwn(TORCH_EFFECTS, message.effect) && (message.rate === undefined || (typeof message.rate === 'number' && Number.isFinite(message.rate) && message.rate >= 0 && message.rate <= 3));
    case 'rate': return typeof message.value === 'number' && Number.isFinite(message.value) && message.value >= 0.25 && message.value <= 3;
    case 'protection': return typeof message.enabled === 'boolean' && (message.acknowledgedRisk === undefined || typeof message.acknowledgedRisk === 'boolean');
    case 'torch': case 'screen-mode': return typeof message.enabled === 'boolean';
    case 'screen-colors': return typeof message.screenColor === 'string' && /^#[\da-f]{6}$/i.test(message.screenColor) && typeof message.accentColor === 'string' && /^#[\da-f]{6}$/i.test(message.accentColor);
    case 'show-plan': return message.plan === null || normalizeShowPlan(message.plan).ok;
    case 'groups': return Array.isArray(message.groups) && (message.groups.length === 0 || (message.groups.length >= 2 && message.groups.length <= 6 && message.groups.every((name) => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 24 && !/[\u0000-\u001f]/.test(name)))) && new Set(message.groups.map((name) => name.trim().toLocaleLowerCase())).size === message.groups.length;
    case 'marquee': return typeof message.text === 'string' && message.text.length <= 500;
    default: return true;
  }
}
function applyCommand(room, message) {
  const cmd = message.command;
  if (cmd === 'start' || cmd === 'resume') {
    if (room.status === 'blackout') return { error: 'Clear blackout before starting' };
    if (room.syncTest.active || !room.syncTest.completed) return { error: 'Complete the controller sync test before starting the show' };
    if (room.waiting.size) return { error: 'Wait for guests to confirm sync or leave before starting the show' };
    room.status = 'running'; room.startedAt = serverNow() + startLeadMs - (cmd === 'resume' ? room.pausedAt : 0); room.pausedAt = 0; room.epoch++;
  } else if (cmd === 'sync-start') {
    if (room.status === 'blackout') return { error: 'Clear blackout before starting the sync test' };
    room.syncTest = { active: true, completed: false, testId: room.syncTest.testId + 1, startedAt: serverNow() + startLeadMs };
  } else if (cmd === 'sync-stop') {
    if (!room.syncTest.active) return room.syncTest.completed ? { ok: true } : { error: 'The sync test is not active' };
    room.syncTest = { ...room.syncTest, active: false, completed: true };
  } else if (cmd === 'pause') {
    if (room.status !== 'running') return { error: 'Show is not running' };
    room.pausedAt = Math.max(0, serverNow() - room.startedAt); room.status = 'paused'; room.epoch++;
  } else if (cmd === 'stop') {
    room.status = 'idle'; room.startedAt = 0; room.pausedAt = 0; room.torchEnabled = false; room.syncTest = { ...room.syncTest, active: false, completed: false }; room.epoch++;
  } else if (cmd === 'blackout') {
    room.status = 'blackout'; room.startedAt = 0; room.pausedAt = 0; room.torchEnabled = false; room.syncTest = { ...room.syncTest, active: false, completed: false }; room.epoch++;
  } else if (cmd === 'clear-blackout') {
    if (room.status !== 'blackout') return { error: 'Blackout is not active' };
    room.status = 'idle'; room.epoch++;
  } else if (cmd === 'effect') {
    if (!TORCH_EFFECTS[message.effect]) return { error: 'Unsupported torch effect' };
    const normalized = normalizeTorchSettings(message.effect, message.rate ?? room.rate, room.enhancedProtection);
    room.effect = normalized.effect; room.rate = normalized.rate;
  } else if (cmd === 'rate') {
    const normalized = normalizeTorchSettings(room.effect, message.value, room.enhancedProtection);
    room.rate = normalized.rate;
  } else if (cmd === 'protection') {
    const enabled = message.enabled;
    if (!enabled && message.acknowledgedRisk !== true) return { error: 'Controller must acknowledge the torch warning before disabling enhanced protection' };
    room.enhancedProtection = enabled;
    room.rate = normalizeTorchSettings(room.effect, room.rate, enabled).rate;
    if (room.showPlan) room.showPlan = normalizeShowPlan(room.showPlan, enabled).plan;
  } else if (cmd === 'torch') {
    room.torchEnabled = message.enabled;
  } else if (cmd === 'screen-mode') {
    room.screenMode = message.enabled;
  } else if (cmd === 'screen-colors') {
    const screenColor = String(message.screenColor || ''), accentColor = String(message.accentColor || '');
    if (!/^#[\da-f]{6}$/i.test(screenColor) || !/^#[\da-f]{6}$/i.test(accentColor)) return { error: 'Screen colors must be six-digit hex values' };
    room.screenColor = screenColor.toLowerCase(); room.accentColor = accentColor.toLowerCase();
  } else if (cmd === 'show-plan') {
    // Live score edits replace only the bounded effect schedule. The room clock,
    // show epoch, and transport state remain unchanged for every audience phone.
    const result = normalizeShowPlan(message.plan, room.enhancedProtection);
    if (!result.ok) return { error: result.error };
    if (result.plan?.cues.some((cue) => cue.group !== null && cue.group >= room.groups.length)) return { error: 'A cue targets a section that is not configured for this room' };
    room.showPlan = result.plan;
  } else if (cmd === 'groups') {
    if (room.status === 'running' || room.audience.size || room.waiting.size) return { error: 'Set audience sections before guests join and before the show starts' };
    if (room.showPlan?.cues.some((cue) => cue.group !== null && cue.group >= message.groups.length)) return { error: 'Clear or update the cue sheet before changing its audience sections' };
    room.groups = message.groups.map((name) => name.trim());
  } else if (cmd === 'marquee') {
    if (typeof message.text !== 'string') return { error: 'Message must be text' };
    room.marquee = message.text.replace(/[<>]/g, '').trim().slice(0, 90);
  } else return { error: 'Unknown command' };
  publish(room, cmd === 'blackout' || cmd === 'stop' ? cmd : 'state');
  return { ok: true };
}

app.get('/health', async () => process.env.NODE_ENV === 'production'
  ? ({ ok: true, service: 'lightsync' })
  : ({ ok: true, service: 'lightsync', rooms: rooms.size, process: { rssBytes: process.memoryUsage().rss, cpuUserMicros: process.cpuUsage().user, cpuSystemMicros: process.cpuUsage().system, eventLoopDelayMeanMs: Number.isFinite(loopDelay.mean) ? loopDelay.mean / 1e6 : 0, eventLoopDelayMaxMs: loopDelay.max / 1e6 } }));
app.get('/favicon.svg', async (_req, reply) => reply.type('image/svg+xml').send(await fs.readFile(path.join(publicDir, 'favicon.svg'))));
app.get('/privacy', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); return reply.type('text/html; charset=utf-8').send(await fs.readFile(path.join(publicDir, 'privacy.html'))); });
app.get('/terms', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); return reply.type('text/html; charset=utf-8').send(await fs.readFile(path.join(publicDir, 'terms.html'))); });
app.get('/', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); return reply.type('text/html; charset=utf-8').send(await fs.readFile(path.join(publicDir, 'home.html'))); });
app.get('/host', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); return reply.type('text/html; charset=utf-8').send(await fs.readFile(path.join(publicDir, 'operator.html'))); });
app.get('/api/auth/me', async (req, reply) => {
  const user = googleAuthEnabled ? await accountFromRequest(req, reply) : null;
  if (user && !req.lightsyncAccountToken) reply.header('Set-Cookie', sessionCookie('lightsync_account', requestCookie(req, 'lightsync_account'), SESSION_COOKIE_MAX_AGE, req));
  return { enabled: googleAuthEnabled, user };
});
app.get('/auth/google', async (req, reply) => {
  if (!googleAuthEnabled) return reply.code(503).type('text/plain; charset=utf-8').send('Google sign-in is not configured');
  const rate = consumeRateLimit(googleAuthTimestamps, req.ip, 10, 10 * 60_000);
  if (!rate.allowed) { reply.header('Retry-After', String(rate.retryAfter)); return reply.code(429).type('text/plain; charset=utf-8').send('Too many sign-in attempts; try again shortly.'); }
  const client = googleOauthClient(req);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const stateToken = issueToken({ role: 'google_oauth', state, nonce, codeVerifier }, 10 * 60_000);
  const authorizationUrl = client.generateAuthUrl({
    response_type: 'code',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  reply.header('Set-Cookie', sessionCookie('lightsync_oauth_state', stateToken, 600, req));
  return reply.redirect(authorizationUrl);
});
app.get('/auth/google/callback', async (req, reply) => {
  const clearState = sessionCookie('lightsync_oauth_state', '', 0, req);
  const fail = () => reply.header('Set-Cookie', clearState).redirect('/host?auth=error');
  const query = req.query && typeof req.query === 'object' ? req.query : {};
  if (!googleAuthEnabled || typeof query.code !== 'string' || typeof query.state !== 'string') return fail();
  const stateClaims = verifyToken(requestCookie(req, 'lightsync_oauth_state'));
  if (!stateClaims || stateClaims.role !== 'google_oauth' || !equalText(stateClaims.state, query.state) || typeof stateClaims.nonce !== 'string' || typeof stateClaims.codeVerifier !== 'string') return fail();
  try {
    const client = googleOauthClient(req);
    const { tokens } = await client.getToken({ code: query.code, codeVerifier: stateClaims.codeVerifier });
    if (!tokens.id_token) return fail();
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: googleClientId });
    const profile = ticket.getPayload();
    const issuerValid = profile?.iss === 'https://accounts.google.com' || profile?.iss === 'accounts.google.com';
    if (!profile || !issuerValid || !equalText(profile.nonce, stateClaims.nonce) || typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string' || profile.email_verified !== true) return fail();
    const accountToken = await accountStore.createSession({
      sub: profile.sub,
      email: profile.email,
      name: profile.name,
      firstName: profile.given_name,
    });
    reply.header('Set-Cookie', [clearState, sessionCookie('lightsync_account', accountToken, SESSION_COOKIE_MAX_AGE, req)]);
    return reply.redirect('/host');
  } catch {
    req.log.warn('Google sign-in callback failed');
    return fail();
  }
});
app.post('/auth/logout', async (req, reply) => {
  if (!hasSameOrigin(req)) return reply.code(403).send({ error: 'Same-origin request required' });
  await accountStore.revokeSession(requestCookie(req, 'lightsync_account'));
  reply.header('Set-Cookie', sessionCookie('lightsync_account', '', 0, req));
  return reply.code(204).send();
});
app.get('/api/account/shows', async (req, reply) => {
  const account = await accountFromRequest(req, reply);
  if (!account) return reply.code(401).send({ error: 'Sign in to view your saved shows' });
  const savedShows = await accountStore.listShows(account.sub);
  return {
    persistence: accountStore.persistent ? 'database' : 'temporary',
    shows: savedShows.map((show) => {
      const activeRoom = [...rooms.values()].find((room) => room.savedShowId === show.id && room.ownerSub === account.sub && room.expiresAt > Date.now());
      return {
        id: show.id,
        name: show.name,
        createdAt: new Date(show.createdAt).toISOString(),
        updatedAt: new Date(show.updatedAt).toISOString(),
        activeRoom: activeRoom ? { code: activeRoom.id, status: activeRoom.status } : null,
      };
    }),
  };
});
app.post('/api/account/shows/:id/continue', async (req, reply) => {
  const account = await accountFromRequest(req, reply);
  if (!account) return reply.code(401).send({ error: 'Sign in to continue a saved show' });
  if (!hasSameOrigin(req)) return reply.code(403).send({ error: 'Same-origin request required' });
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(req.params.id)) return reply.code(404).send({ error: 'Saved show not found' });
  const saved = await accountStore.getShow(account.sub, req.params.id);
  if (!saved) return reply.code(404).send({ error: 'Saved show not found' });
  let room = [...rooms.values()].find((candidate) => candidate.savedShowId === saved.id && candidate.ownerSub === account.sub && candidate.expiresAt > Date.now());
  if (!room) {
    if (rooms.size >= maxRooms) return reply.code(503).send({ error: 'Room capacity reached' });
    let id;
    do { id = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(id));
    room = roomFromSavedConfig(id, saved.name, account.sub, saved.id, saved.config);
    rooms.set(id, room);
    await saveRoomSnapshot(room);
  }
  const token = issueToken({ role: 'operator', room: room.id, instance: room.instance });
  const url = joinUrl(room.id, req);
  const qr = await QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: '#07110f', light: '#ffffff' } });
  return { room: roomState(room), token, url, qr };
});
app.delete('/api/account/shows/:id', async (req, reply) => {
  const account = await accountFromRequest(req, reply);
  if (!account) return reply.code(401).send({ error: 'Sign in to delete a saved show' });
  if (!hasSameOrigin(req)) return reply.code(403).send({ error: 'Same-origin request required' });
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(req.params.id)) return reply.code(404).send({ error: 'Saved show not found' });
  const deleted = await accountStore.deleteShow(account.sub, req.params.id);
  if (!deleted) return reply.code(404).send({ error: 'Saved show not found' });
  for (const room of rooms.values()) if (room.ownerSub === account.sub && room.savedShowId === req.params.id) room.savedShowId = null;
  return { ok: true };
});
app.get('/join/:id', async (req, reply) => {
  reply.header('Cache-Control', 'no-store');
  const id = req.params.id;
  const room = rooms.get(id);
  if (!/^\d{6}$/.test(id) || !room || room.expiresAt <= Date.now()) {
    const rate = consumeRateLimit(roomLookupTimestamps, req.ip, roomLookupsPerMinute, 60_000);
    if (!rate.allowed) { reply.header('Retry-After', String(rate.retryAfter)); return reply.code(429).type('text/plain; charset=utf-8').send('Too many code checks; try again in a minute.'); }
    return reply.redirect(`/?join=unavailable&code=${encodeURIComponent(id)}#join-show`);
  }
  return reply.type('text/html; charset=utf-8').send(await fs.readFile(path.join(publicDir, 'audience.html')));
});
app.get('/assets/:file', async (req, reply) => {
  const allowed = new Set(['home.js', 'operator.js', 'operator-connection.js', 'audience.js', 'audience-immersive.js', 'controller-workspace.js', 'show-planner.js', 'music-playlist.js', 'keyframe-editor.js', 'custom-color-picker.js', 'effect-graph.js', 'effect-node-editor.js', 'lucide.js', 'safety.js', 'styles.css', 'offset-wheel.html', 'offset-wheel.css', 'offset-wheel.js', 'google-g-logo.png']);
  if (!allowed.has(req.params.file)) return reply.code(404).send({ error: 'Not found' });
  reply.header('Cache-Control', 'no-store');
  const mimeType = req.params.file.endsWith('.html') ? 'text/html; charset=utf-8' : req.params.file.endsWith('.css') ? 'text/css; charset=utf-8' : req.params.file.endsWith('.png') ? 'image/png' : 'text/javascript; charset=utf-8';
  return reply.type(mimeType).send(await fs.readFile(path.join(publicDir, req.params.file)));
});

app.post('/api/rooms', async (req, reply) => {
  const account = await accountFromRequest(req, reply);
  if (!account) return reply.code(401).send({ error: 'Sign in with Google before creating a show' });
  if (!hasSameOrigin(req)) return reply.code(403).send({ error: 'Same-origin request required' });
  const rate = consumeRateLimit(createTimestamps, req.ip, 6, 60_000);
  if (!rate.allowed) { reply.header('Retry-After', String(rate.retryAfter)); return reply.code(429).send({ error: 'Room creation limit reached; try again in a minute' }); }
  if (rooms.size >= maxRooms) return reply.code(503).send({ error: 'Room capacity reached' });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : '';
  if (!name) return reply.code(400).send({ error: 'Enter a show name' });
  let id;
  do { id = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(id));
  const room = roomFromSavedConfig(id, name, account.sub, null);
  let savedShowId;
  try {
    savedShowId = await accountStore.createShow(account.sub, name, savedRoomConfig(room));
  } catch (error) {
    req.log.error({ error: error.message }, 'Could not create saved show');
    return reply.code(503).send({ error: 'Show storage is unavailable right now. Try again shortly.' });
  }
  room.savedShowId = savedShowId;
  rooms.set(id, room);
  const token = issueToken({ role: 'operator', room: id, instance: room.instance });
  const url = joinUrl(id, req);
  const qr = await QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: '#07110f', light: '#ffffff' } });
  return { room: roomState(room), token, url, qr };
});
app.get('/api/rooms/:id', async (req, reply) => {
  const room = rooms.get(req.params.id);
  if (!/^\d{6}$/.test(req.params.id) || !room || room.expiresAt <= Date.now()) {
    const rate = consumeRateLimit(roomLookupTimestamps, req.ip, roomLookupsPerMinute, 60_000);
    if (!rate.allowed) { reply.header('Retry-After', String(rate.retryAfter)); return reply.code(429).send({ error: 'Too many code checks; try again in a minute' }); }
    return reply.code(404).send({ error: 'Show not found' });
  }
  return { room: { id: room.id, name: room.name } };
});
app.get('/api/operator/state', async (req, reply) => {
  const auth = authenticate(req, reply); if (!auth) return;
  return { state: roomState(auth.room) };
});
app.post('/api/operator/command', async (req, reply) => {
  const auth = authenticate(req, reply); if (!auth) return;
  if (!req.body || Object.getPrototypeOf(req.body) !== Object.prototype || !validateCommand({ type: 'command', ...req.body })) return reply.code(400).send({ error: 'Invalid command structure' });
  if (req.body.commandId <= auth.room.lastCommandId) return { ok: true, duplicate: true };
  if (!['blackout', 'stop'].includes(req.body.command)) {
    const rate = consumeRateLimit(operatorCommandTimestamps, auth.room.instance, operatorCommandsPerWindow, 10_000);
    if (!rate.allowed) { reply.header('Retry-After', String(rate.retryAfter)); return reply.code(429).send({ error: 'Operator command rate limit reached; try again shortly' }); }
  }
  auth.room.lastCommandId = req.body.commandId;
  const result = applyCommand(auth.room, req.body);
  if (result.error) return reply.code(400).send(result);
  if (savedShowCommands.has(req.body.command)) {
    try { await saveRoomSnapshot(auth.room); }
    catch (error) { req.log.error({ error: error.message }, 'Could not update saved show'); return reply.code(503).send({ error: 'The show changed, but its saved setup could not be updated. Check server storage and try again.' }); }
  }
  return result;
});
app.post('/api/operator/close', async (req, reply) => {
  const auth = authenticate(req, reply); if (!auth) return;
  const room = auth.room;
  room.status = 'idle'; room.torchEnabled = false; room.epoch++;
  publish(room, 'ended');
  for (const ws of [...room.audience, ...room.waiting, ...room.operators]) ws.close(1000, 'Show closed');
  rooms.delete(room.id);
  return { ok: true };
});

app.server.on('upgrade', (req, socket, head) => {
  const reject = (status, message) => socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return reject(400, 'Bad Request'); }
  if (url.pathname !== '/ws' || url.search || url.hash) return reject(404, 'Not Found');
  const origin = req.headers.origin;
  const trustedOrigin = configuredBase?.origin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host || ''}`;
  if (typeof origin !== 'string' || origin !== trustedOrigin) return reject(403, 'Forbidden');
  if (wss.clients.size >= maxWebSockets) return reject(503, 'Service Unavailable');
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const helloTimer = setTimeout(() => { if (!ws.role) ws.close(1008, 'Authentication timeout'); }, 5000);
  helloTimer.unref();
  const rateWindow = [];
  ws.on('message', (buffer, isBinary) => {
    if (buffer.length > 8192) return ws.close(1009, 'Message too large');
    if (isBinary) return ws.close(1003, 'Text messages required');
    let message; try { message = JSON.parse(buffer.toString()); } catch { return ws.close(1007, 'Invalid JSON'); }
    if (!message || Object.getPrototypeOf(message) !== Object.prototype || typeof message.type !== 'string') return ws.close(1008, 'Invalid message');
    const now = Date.now();
    while (rateWindow.length && now - rateWindow[0] > 10_000) rateWindow.shift();
    const emergency = message.type === 'command' && ['blackout', 'stop'].includes(message.command);
    if (rateWindow.length >= 200 && !(ws.role === 'operator' && emergency)) return ws.close(1008, 'Message rate exceeded');
    if (!(ws.role === 'operator' && emergency)) rateWindow.push(now);
    if (ws.role === 'operator' && (!ws.claims || ws.claims.exp <= now || !rooms.has(ws.room.id) || rooms.get(ws.room.id) !== ws.room)) return ws.close(1008, 'Operator session expired');
    if (message.type === 'sync' && Number.isFinite(message.clientSent)) {
      if (!ws.role || Object.keys(message).some((key) => !['type', 'clientSent'].includes(key)) || !Number.isFinite(message.clientSent) || message.clientSent < 0 || message.clientSent > Number.MAX_SAFE_INTEGER) return ws.close(1008, 'Invalid sync message');
      const serverReceived = serverNow(); send(ws, { type: 'sync', clientSent: message.clientSent, serverReceived, serverSent: serverNow() }); return;
    }
    if (message.type === 'controller-ping') {
      if (ws.role !== 'audience' || Object.keys(message).some((key) => !['type', 'probeId', 'clientSent'].includes(key)) || typeof message.probeId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(message.probeId) || !Number.isFinite(message.clientSent) || message.clientSent < 0 || message.clientSent > Number.MAX_SAFE_INTEGER) return ws.close(1008, 'Invalid controller ping');
      const room = ws.room, now = Date.now();
      for (const [id, probe] of room.clockProbes) if (probe.expiresAt <= now || probe.audience.readyState !== WebSocket.OPEN || probe.operator.readyState !== WebSocket.OPEN) room.clockProbes.delete(id);
      const operator = [...room.operators].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN && candidate.claims?.exp > now);
      if (!operator || room.clockProbes.size >= 32) { send(ws, { type: 'controller-pong', probeId: message.probeId, unavailable: true }); return; }
      room.clockProbes.set(message.probeId, { audience: ws, operator, clientSent: message.clientSent, expiresAt: now + 2500 });
      send(operator, { type: 'controller-ping', probeId: message.probeId }); return;
    }
    if (message.type === 'controller-pong') {
      if (ws.role !== 'operator' || Object.keys(message).some((key) => !['type', 'probeId', 'controllerReceived', 'controllerSent'].includes(key)) || typeof message.probeId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(message.probeId) || !Number.isFinite(message.controllerReceived) || !Number.isFinite(message.controllerSent) || message.controllerReceived < 0 || message.controllerSent < message.controllerReceived || message.controllerSent - message.controllerReceived > 1000 || message.controllerSent > Number.MAX_SAFE_INTEGER) return ws.close(1008, 'Invalid controller pong');
      const probe = ws.room.clockProbes.get(message.probeId);
      if (!probe) return;
      if (probe.operator !== ws) return;
      if (probe.expiresAt <= Date.now() || probe.audience.readyState !== WebSocket.OPEN) { ws.room.clockProbes.delete(message.probeId); return; }
      ws.room.clockProbes.delete(message.probeId);
      send(probe.audience, { type: 'controller-pong', probeId: message.probeId, clientSent: probe.clientSent, controllerReceived: message.controllerReceived, controllerSent: message.controllerSent }); return;
    }
    if (message.type === 'heartbeat') {
      if (ws.role !== 'operator' || Object.keys(message).length !== 1) return ws.close(1008, 'Invalid heartbeat');
      ws.room.lastOperatorHeartbeat = now; send(ws, { type: 'heartbeat', serverNow: serverNow() }); return;
    }
    if (!ws.role && message.type === 'hello') {
      clearTimeout(helloTimer);
      if (!['operator', 'audience'].includes(message.role) || typeof message.room !== 'string' || !/^\d{6}$/.test(message.room)) return ws.close(1008, 'Invalid hello');
      const helloFields = message.role === 'operator' ? ['type', 'role', 'room', 'token'] : ['type', 'role', 'room', 'reconnectToken', 'syncConfirmed'];
      if (Object.keys(message).some((key) => !helloFields.includes(key)) || (message.role === 'audience' && message.syncConfirmed !== undefined && typeof message.syncConfirmed !== 'boolean') || (message.role === 'audience' && message.reconnectToken !== undefined && (typeof message.reconnectToken !== 'string' || message.reconnectToken.length > 2048))) return ws.close(1008, 'Invalid hello');
      const room = rooms.get(String(message.room || ''));
      if (!room) return ws.close(1008, 'Unknown room');
      if (message.role === 'operator') {
        const claims = verifyToken(message.token);
        if (!claims || claims.role !== 'operator' || claims.room !== room.id || claims.instance !== room.instance) return ws.close(1008, 'Unauthorized');
        ws.role = 'operator'; ws.room = room; ws.claims = claims; room.lastOperatorHeartbeat = Date.now(); room.operators.add(ws);
      } else {
        if (room.audience.size + room.waiting.size >= maxAudience) { send(ws, { type: 'full' }); return ws.close(1008, 'Room full'); }
        ws.role = 'audience'; ws.room = room; ws.audienceSeed = crypto.randomInt(1, 0x7fffffff);
        const reconnectClaims = verifyToken(message.reconnectToken);
        const validReconnect = reconnectClaims?.role === 'audience' && reconnectClaims.room === room.id && reconnectClaims.instance === room.instance && typeof reconnectClaims.session === 'string';
      const confirmed = validReconnect && room.status !== 'blackout' && (room.syncTest.completed || room.status === 'running');
        if (confirmed) { ws.confirmed = true; ws.reconnectToken = message.reconnectToken; ws.audienceIndex = room.audienceIndex++; ws.groupIndex = Number.isSafeInteger(reconnectClaims.groupIndex) ? reconnectClaims.groupIndex : null; room.audience.add(ws); }
        else { ws.confirmed = false; room.waiting.add(ws); }
      }
      send(ws, { type: 'welcome', serverNow: serverNow(), audienceIndex: ws.audienceIndex ?? null, audienceSeed: ws.audienceSeed ?? null, groupIndex: ws.groupIndex ?? null, state: roomState(room) });
      publishPresence(room);
      return;
    }
    if (!ws.role) return ws.close(1008, 'Join first');
    if (ws.role === 'audience' && message.type === 'sync-request') {
      if (Object.keys(message).length !== 1 || ws.confirmed || !ws.room.waiting.has(ws)) return ws.close(1008, 'Invalid sync request');
      const operator = [...ws.room.operators].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN && candidate.claims?.exp > now);
      if (operator) send(operator, { type: 'sync-request' });
      else send(ws, { type: 'error', message: 'Waiting for the controller to connect before syncing.' });
      return;
    }
    if (Object.keys(message).some((key) => !['type', 'testId', 'command', 'commandId', 'effect', 'rate', 'value', 'enabled', 'acknowledgedRisk', 'screenColor', 'accentColor', 'text', 'plan', 'groups', 'groupIndex'].includes(key))) return ws.close(1008, 'Unexpected message field');
    if (ws.role === 'audience' && message.type === 'confirm-sync') {
      if (Object.keys(message).some((key) => !['type', 'testId', 'groupIndex'].includes(key)) || !Number.isSafeInteger(message.testId) || (message.groupIndex !== undefined && message.groupIndex !== null && (!Number.isSafeInteger(message.groupIndex) || message.groupIndex < 0 || message.groupIndex >= ws.room.groups.length)) || (ws.room.groups.length === 0 && message.groupIndex !== undefined && message.groupIndex !== null)) return ws.close(1008, 'Invalid sync confirmation');
      if (ws.confirmed) return send(ws, { type: 'joined', reconnectToken: ws.reconnectToken, groupIndex: ws.groupIndex ?? null, state: roomState(ws.room) });
      if (!ws.room.syncTest.active || message.testId !== ws.room.syncTest.testId) return send(ws, { type: 'error', message: 'Wait for the controller to start the sync test before confirming' });
      if (ws.room.groups.length && message.groupIndex === undefined) return send(ws, { type: 'error', message: 'Choose an audience section before confirming sync' });
      ws.room.waiting.delete(ws); ws.room.audience.add(ws); ws.confirmed = true; ws.audienceIndex = ws.room.audienceIndex++; ws.groupIndex = message.groupIndex ?? null;
      ws.reconnectToken = issueToken({ role: 'audience', room: ws.room.id, instance: ws.room.instance, session: crypto.randomUUID(), ...(ws.groupIndex === null ? {} : { groupIndex: ws.groupIndex }) }, Math.max(1, ws.room.expiresAt - Date.now()));
      if (ws.room.waiting.size === 0) ws.room.syncTest = { ...ws.room.syncTest, active: false, completed: true };
      send(ws, { type: 'joined', reconnectToken: ws.reconnectToken, groupIndex: ws.groupIndex ?? null, state: roomState(ws.room) }); publishPresence(ws.room); return;
    }
    if (ws.role === 'operator' && message.type === 'command') {
      if (!validateCommand(message)) return send(ws, { type: 'error', message: 'Invalid command structure', command: typeof message.command === 'string' ? message.command.slice(0, 32) : 'unknown', commandId: Number.isSafeInteger(message.commandId) ? message.commandId : null });
      if (message.commandId <= ws.room.lastCommandId) { send(ws, { type: 'ack', command: message.command, commandId: message.commandId, duplicate: true }); return; }
      if (!['blackout', 'stop'].includes(message.command)) {
        const rate = consumeRateLimit(operatorCommandTimestamps, ws.room.instance, operatorCommandsPerWindow, 10_000);
        if (!rate.allowed) { send(ws, { type: 'error', command: message.command, commandId: message.commandId, message: 'Operator command rate limit reached; try again shortly' }); return; }
      }
      ws.room.lastCommandId = message.commandId;
      const emergency = ['blackout', 'stop', 'sync-start', 'sync-stop', 'start', 'resume', 'pause', 'clear-blackout'].includes(message.command);
      if (emergency || !ws.lastCommandAt || Date.now() - ws.lastCommandAt > 45) {
        ws.lastCommandAt = Date.now();
        const result = applyCommand(ws.room, message);
        if (result.error) send(ws, { type: 'error', command: message.command, commandId: message.commandId, message: result.error });
        else if (savedShowCommands.has(message.command)) {
          saveRoomSnapshot(ws.room).then(
            () => send(ws, { type: 'ack', command: message.command, commandId: message.commandId }),
            (error) => { app.log.error({ error: error.message }, 'Could not update saved show'); send(ws, { type: 'error', command: message.command, commandId: message.commandId, message: 'The show changed, but its saved setup could not be updated. Check server storage and try again.' }); },
          );
        } else send(ws, { type: 'ack', command: message.command });
      } else send(ws, { type: 'error', command: message.command, commandId: message.commandId, message: 'Control update was rate limited; the latest value may not have applied' });
    } else return ws.close(1008, 'Unsupported message type');
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (ws.room && ws.role) {
      for (const [id, probe] of ws.room.clockProbes) if (probe.audience === ws || probe.operator === ws) ws.room.clockProbes.delete(id);
      if (ws.role === 'operator') ws.room.operators.delete(ws);
      else { ws.room.waiting.delete(ws); ws.room.audience.delete(ws); }
      publishPresence(ws.room);
    }
  });
});

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a whole number between 1 and 65535');
const host = process.env.HOST || '127.0.0.1';
const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (ws.lastPingAt && !ws.isAlive) { ws.terminate(); continue; }
    if (!ws.lastPingAt || now - ws.lastPingAt >= 20_000) { ws.isAlive = false; ws.lastPingAt = now; ws.ping(); }
    if (ws.role === 'operator' && ws.claims?.exp <= now) ws.close(1008, 'Operator session expired');
  }
  for (const room of rooms.values()) {
    if (room.status === 'running' && now - (room.lastOperatorHeartbeat || 0) > showLeaseMs) {
      room.status = 'paused'; room.pausedAt = Math.max(0, serverNow() - room.startedAt); room.startedAt = 0; room.torchEnabled = false; room.epoch++;
      publish(room, 'stop');
      continue;
    }
    if (room.status === 'running' && room.showPlan && serverNow() - room.startedAt - (room.showPlan.anchorMs || 0) >= room.showPlan.durationMs) {
      room.status = 'idle'; room.startedAt = 0; room.pausedAt = 0; room.torchEnabled = false; room.epoch++;
      publish(room, 'stop');
    }
  }
}, Math.min(1_000, Math.max(100, Math.floor(showLeaseMs / 4))));
heartbeatTimer.unref();
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) { if (room.expiresAt <= now) {
    room.status = 'idle'; room.torchEnabled = false; publish(room, 'ended');
    for (const ws of [...room.audience, ...room.waiting, ...room.operators]) ws.close(1000, 'Show expired');
    rooms.delete(id);
  } }
}, 60_000).unref();
await app.listen({ port, host });
