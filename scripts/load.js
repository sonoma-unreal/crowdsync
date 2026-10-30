import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const scenarios = process.env.LOAD_CLIENTS ? process.env.LOAD_CLIENTS.split(',').map(Number) : [50, 100, 250, 500];
if (scenarios.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1000)) throw new Error('LOAD_CLIENTS must be a comma-separated list from 1 to 1000');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port;
}
async function waitReady(base, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`CrowdSync exited with code ${child.exitCode}`);
    try { const response = await fetch(`${base}/health`); if (response.ok) return; } catch { /* server starting */ }
    await delay(50);
  }
  throw new Error('Timed out waiting for the load-test server');
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(2));
}
function connect(base, room, token) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { Origin: base } });
  ws.waiters = []; ws.failures = [];
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    for (const waiter of [...ws.waiters]) if (waiter.test(msg)) { ws.waiters.splice(ws.waiters.indexOf(waiter), 1); waiter.resolve(msg); }
  });
  ws.once('open', () => ws.send(JSON.stringify(token ? { type: 'hello', role: 'operator', room, token } : { type: 'hello', role: 'audience', room })));
  ws.once('error', (error) => { ws.failures.push(error.message); });
  ws.waitFor = (test, timeout = 15000) => new Promise((resolve, reject) => {
    const waiter = { test, resolve, reject, timer: setTimeout(() => { ws.waiters.splice(ws.waiters.indexOf(waiter), 1); reject(new Error('WebSocket wait timed out')); }, timeout) };
    const done = waiter.resolve;
    waiter.resolve = (value) => { clearTimeout(waiter.timer); done(value); };
    ws.waiters.push(waiter);
  });
  return ws;
}
async function run(count) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MAX_AUDIENCE_PER_ROOM: '2000', PUBLIC_BASE_URL: base, NODE_ENV: 'test', LOG_LEVEL: 'error' }, stdio: 'ignore' });
  const clients = []; let operator;
  try {
    await waitReady(base, child);
    const serverStarted = performance.now();
    const baselineHealth = await (await fetch(`${base}/health`)).json();
    const createStart = performance.now();
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Load ${count}` }) });
    if (!response.ok) throw new Error(`Room creation failed: ${response.status}`);
    const { room, token } = await response.json();
    operator = connect(base, room.id, token); await operator.waitFor((m) => m.type === 'welcome');
    const connectStart = performance.now();
    const joined = [];
    for (let i = 0; i < count; i++) {
      const ws = connect(base, room.id); clients.push(ws);
      joined.push(ws.waitFor((m) => m.type === 'welcome').then(() => true, () => false));
    }
    const outcomes = await Promise.all(joined);
    const connectionBurstMs = performance.now() - connectStart;
    const successfulClients = clients.filter((_ws, i) => outcomes[i]);
    await delay(150);
    const success = outcomes.filter(Boolean).length;
    const marker = `load-${count}-${Date.now()}`;
    const cueTimes = Array(count).fill(null);
    successfulClients.forEach((ws, i) => ws.on('message', (raw) => { try { const m = JSON.parse(raw.toString()); if (m.state?.marquee === marker && cueTimes[i] === null) cueTimes[i] = performance.now(); } catch { /* malformed frame */ } }));
    const cueStart = performance.now();
    operator.send(JSON.stringify({ type: 'command', command: 'marquee', text: marker, commandId: 1 }));
    const cueDeadline = Date.now() + 15000;
    while (Date.now() < cueDeadline && cueTimes.slice(0, success).some((v) => v === null)) await delay(20);
    const cueLatency = cueTimes.slice(0, success).filter((v) => v !== null).map((v) => v - cueStart);
    const blackoutWaits = successfulClients.map((ws) => ws.waitFor((m) => m.type === 'blackout', 15000).then(() => performance.now() - blackoutStart, () => null));
    const blackoutStart = performance.now();
    operator.send(JSON.stringify({ type: 'command', command: 'blackout', commandId: 2 }));
    const blackout = await Promise.all(blackoutWaits);
    const health = await (await fetch(`${base}/health`)).json();
    const serverWallMs = performance.now() - serverStarted;
    const cpuUserMicros = health.process.cpuUserMicros - baselineHealth.process.cpuUserMicros;
    const cpuSystemMicros = health.process.cpuSystemMicros - baselineHealth.process.cpuSystemMicros;
    const result = {
      clientsRequested: count, clientsConnected: success, connectionFailures: count - success,
      roomAndClientSetupMs: Number((connectStart - createStart + connectionBurstMs).toFixed(2)),
      connectionBurstMs: Number(connectionBurstMs.toFixed(2)),
      cueFanout: { delivered: cueLatency.length, p50Ms: percentile(cueLatency, .5), p95Ms: percentile(cueLatency, .95), p99Ms: percentile(cueLatency, .99) },
      blackoutFanout: { delivered: blackout.filter((v) => v !== null).length, p95Ms: percentile(blackout.filter((v) => v !== null), .95) },
      server: { rssMiB: Number((health.process.rssBytes / 1024 / 1024).toFixed(2)), cpuUserMs: Number((cpuUserMicros / 1000).toFixed(2)), cpuSystemMs: Number((cpuSystemMicros / 1000).toFixed(2)), cpuPercentOneCore: Number((((cpuUserMicros + cpuSystemMicros) / (serverWallMs * 1000)) * 100).toFixed(2)), eventLoopDelayMeanMs: Number(health.process.eventLoopDelayMeanMs.toFixed(2)), eventLoopDelayMaxMs: Number(health.process.eventLoopDelayMaxMs.toFixed(2)) },
      methodology: 'localhost, one room, simultaneous WebSocket join burst, one state broadcast and emergency blackout; no TLS, proxy, Wi-Fi, upload, or mobile-browser load.'
    };
    console.log(JSON.stringify(result));
  } finally {
    for (const ws of [...clients, operator].filter(Boolean)) { try { ws.close(); } catch { /* already closed */ } }
    child.kill();
  }
}
for (const count of scenarios) await run(count);
