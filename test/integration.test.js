import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const TEST_SESSION_SECRET = 'integration-test-session-secret-0123456789';
process.env.SESSION_SECRET = TEST_SESSION_SECRET;

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port;
}
async function waitForServer(base, child) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode})`);
    try { const response = await fetch(`${base}/health`); if (response.ok) return; } catch { /* startup */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become ready');
}
function accountCookie(secret = TEST_SESSION_SECRET) {
  const body = Buffer.from(JSON.stringify({ role:'account', sub:'test-google-subject', email:'host@example.test', name:'Test Host', exp:Date.now()+60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `lightsync_account=${body}.${signature}`;
}
async function create(base, name, secret = TEST_SESSION_SECRET, origin = base) {
  const res = await fetch(`${base}/api/rooms`, { method:'POST', headers:{'content-type':'application/json',Origin:origin,Cookie:accountCookie(secret)}, body:JSON.stringify({name}) });
  const data = await res.json(); assert.equal(res.status, 200); return data;
}

test('Google account is required to create a room and sign-in is configurable', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_CALLBACK_URL:''},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const me=await fetch(`${base}/api/auth/me`);assert.deepEqual(await me.json(),{enabled:false,user:null});
  assert.equal((await fetch(`${base}/auth/google`,{redirect:'manual'})).status,503);
  const anonymous=await fetch(`${base}/api/rooms`,{method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify({name:'No account'})});assert.equal(anonymous.status,401);
  const wrongOrigin=await fetch(`${base}/api/rooms`,{method:'POST',headers:{'content-type':'application/json',Origin:'https://attacker.example',Cookie:accountCookie()},body:JSON.stringify({name:'Cross origin'})});assert.equal(wrongOrigin.status,403);
  const authenticated=await fetch(`${base}/api/auth/me`,{headers:{Cookie:accountCookie()}});assert.deepEqual(await authenticated.json(),{enabled:false,user:null});
});

test('Google OAuth start uses state, nonce, and PKCE with the configured Lightsync callback', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`,callback=`${base}/auth/google/callback`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,GOOGLE_CLIENT_ID:'lightsync-test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-client-secret',GOOGLE_CALLBACK_URL:callback,NODE_ENV:'test'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const start=await fetch(`${base}/auth/google`,{redirect:'manual'});assert.equal(start.status,302);
  const authorization=new URL(start.headers.get('location'));assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('client_id'),'lightsync-test.apps.googleusercontent.com');
  assert.equal(authorization.searchParams.get('redirect_uri'),callback);assert.equal(authorization.searchParams.get('response_type'),'code');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.ok(authorization.searchParams.get('code_challenge'));assert.ok(authorization.searchParams.get('nonce'));assert.ok(authorization.searchParams.get('state'));
  assert.deepEqual(new Set(authorization.searchParams.get('scope').split(' ')),new Set(['openid','email','profile']));
  assert.match(start.headers.get('set-cookie'),/HttpOnly/);assert.match(start.headers.get('set-cookie'),/SameSite=Lax/);
  const invalid=await fetch(`${base}/auth/google/callback?error=access_denied`,{redirect:'manual'});assert.equal(invalid.status,302);assert.equal(invalid.headers.get('location'),'/host?auth=error');
});
function connect(base, role, room, token, extra = {}) {
  const ws = new WebSocket(base.replace('http','ws') + '/ws', { headers: { Origin: base } });
  ws.__messages=[];ws.__waiters=[];ws.__closed=false;ws.on('close',code=>{ws.__closed=true;ws.__closeCode=code});
  ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString())}catch{return}const waiter=ws.__waiters.find(w=>w.predicate(msg));if(waiter){clearTimeout(waiter.timer);ws.__waiters.splice(ws.__waiters.indexOf(waiter),1);waiter.resolve(msg)}else ws.__messages.push(msg)});
  return new Promise((resolve,reject)=>{ws.once('error',reject);ws.once('open',()=>{ws.send(JSON.stringify({type:'hello',role,room,...(token?{token}:{}),...extra}));resolve(ws)});});
}
function resignToken(token, secret, exp) {
  const [body] = token.split('.'), claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  claims.exp = exp;
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${crypto.createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
function nextMessage(ws, predicate=()=>true, timeout=2500) {
  const index=ws.__messages.findIndex(predicate);if(index>=0)return Promise.resolve(ws.__messages.splice(index,1)[0]);
  return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>{ws.__waiters.splice(ws.__waiters.indexOf(waiter),1);reject(new Error(`timed out waiting for WebSocket message; queued=${JSON.stringify(ws.__messages)}`))},timeout)};ws.__waiters.push(waiter)});
}

test('HTTP and WebSocket room lifecycle, timing, reconnect, and authorization', async (t) => {
  const port=await freePort(), base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test'},stdio:'ignore'});
  t.after(()=>child.kill());
  await waitForServer(base,child);
  const health=await (await fetch(`${base}/health`)).json(); assert.equal(health.ok,true);assert.ok(health.process.rssBytes>0);assert.ok(Number.isFinite(health.process.eventLoopDelayMeanMs));
  const securityHeaders=await fetch(base);assert.equal(securityHeaders.headers.get('x-content-type-options'),'nosniff');assert.equal(securityHeaders.headers.get('x-frame-options'),'DENY');assert.equal(securityHeaders.headers.get('cross-origin-opener-policy'),'same-origin');assert.equal(securityHeaders.headers.get('cache-control'),'no-store');assert.match(securityHeaders.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(securityHeaders.headers.get('content-security-policy'),/style-src 'self' https:\/\/fonts\.googleapis\.com/);assert.match(securityHeaders.headers.get('content-security-policy'),/font-src 'self' https:\/\/fonts\.gstatic\.com/);assert.doesNotMatch(securityHeaders.headers.get('content-security-policy'),/unsafe-inline/);assert.equal(securityHeaders.headers.get('access-control-allow-origin'),null);
  const home=await fetch(base);assert.equal(home.status,200);const homeHtml=await home.text();assert.match(homeHtml,/home-hero/);assert.match(homeHtml,/Host a show/);assert.match(homeHtml,/Six-digit show code/);assert.match(homeHtml,/theme-toggle/);assert.match(homeHtml,/How it works/);
  const hostPage=await fetch(`${base}/host`);assert.equal(hostPage.status,200);const hostHtml=await hostPage.text();assert.match(hostHtml,/Start sync test/);assert.match(hostHtml,/type="module" src="\/assets\/operator\.js(?:\?[^\"]*)?"/);assert.doesNotMatch(hostHtml,/fancam/i);
  const reconnectModule=await fetch(`${base}/assets/operator-connection.js`);assert.equal(reconnectModule.status,200);assert.match(reconnectModule.headers.get('content-type'),/javascript/);assert.match(await reconnectModule.text(),/classifyOperatorDisconnect/);
  const safetyModule=await fetch(`${base}/assets/safety.js`);assert.equal(safetyModule.status,200);assert.match(await safetyModule.text(),/export function sampleTorch/);
  const homeModule=await fetch(`${base}/assets/home.js`);assert.equal(homeModule.status,200);assert.match(await homeModule.text(),/setTheme/);
  const styles=await fetch(`${base}/assets/styles.css`);assert.equal(styles.status,200);const stylesText=await styles.text();assert.match(stylesText,/operator-page\[data-ambient=running\]/);assert.match(stylesText,/home-page\[data-theme=light\]/);assert.match(stylesText,/home-primary-action[^}]*border-radius:0/);
  const icon=await fetch(`${base}/favicon.svg`);assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image\/svg\+xml/);for(const asset of ['keyframe-editor.js','lucide.js'])assert.equal((await fetch(`${base}/assets/${asset}`)).status,200);
  for(const path of ['/.git/config','/.env','/src/server.js','/assets/server.js','/assets/operator.js.map'])assert.equal((await fetch(`${base}${path}`)).status,404);
  const roomA=await create(base,'Pep rally'),roomB=await create(base,'Senior night');
  assert.match(roomA.room.id,/^\d{6}$/);assert.match(roomA.url,/\/join\/\d{6}$/);assert.match(roomA.qr,/^data:image\/png;base64,/);
  const joinPage=await fetch(roomA.url);assert.equal(joinPage.status,200);const joinHtml=await joinPage.text();assert.match(joinHtml,/Photosensitivity notice/);assert.doesNotMatch(joinHtml,/fancam/i);
  const unauthorized=await fetch(`${base}/api/operator/state`);assert.equal(unauthorized.status,401);assert.equal((await fetch(`${base}/api/operator/fancam/clips`)).status,404);assert.equal((await fetch(`${base}/api/fancam/submit`)).status,404);
  const getRoom=await fetch(`${base}/api/rooms/${roomA.room.id}`);assert.equal((await getRoom.json()).room.name,'Pep rally');
  let audience=await connect(base,'audience',roomA.room.id);
  const welcome=await nextMessage(audience,m=>m.type==='welcome');assert.equal(welcome.state.name,'Pep rally');assert.equal('participantToken' in welcome,false);
  const beforeAudienceAttacks=(await (await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${roomA.token}`}})).json()).state;
  const audienceAttacks=[['start'],['resume'],['sync-start'],['sync-stop'],['pause'],['stop'],['blackout'],['clear-blackout'],['effect',{effect:'solid',rate:.5}],['rate',{value:.5}],['protection',{enabled:false,acknowledgedRisk:true}],['torch',{enabled:true}],['screen-mode',{enabled:true}],['screen-colors',{screenColor:'#ff0000',accentColor:'#00ff00'}],['marquee',{text:'<img src=x onerror=alert(1)>'}]];
  for(const [command,payload={}] of audienceAttacks){const guest=await connect(base,'audience',roomA.room.id);await nextMessage(guest,m=>m.type==='welcome');guest.send(JSON.stringify({type:'command',command,commandId:1,...payload}));assert.equal((await once(guest,'close'))[0],1008)}
  const afterAudienceAttacks=(await (await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${roomA.token}`}})).json()).state;assert.equal(afterAudienceAttacks.status,beforeAudienceAttacks.status);assert.equal(afterAudienceAttacks.effect,beforeAudienceAttacks.effect);assert.equal(afterAudienceAttacks.torchEnabled,beforeAudienceAttacks.torchEnabled);
  assert.equal((await fetch(`${base}/api/operator/command`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'blackout',commandId:1})})).status,401);
  assert.equal((await fetch(`${base}/api/operator/close`,{method:'POST'})).status,401);assert.equal((await fetch(`${base}/api/rooms/${roomA.room.id}`)).status,200);
  audience.send(JSON.stringify({type:'sync',clientSent:123456789.5}));
  const sync=await nextMessage(audience,m=>m.type==='sync');assert.equal(sync.clientSent,123456789.5);assert.ok(sync.serverSent>=sync.serverReceived);
  const unauthSync = new WebSocket(base.replace('http','ws') + '/ws', { headers: { Origin: 'https://evil.example' } });
  const originResponse=await new Promise((resolve) => { unauthSync.once('error', resolve); unauthSync.once('unexpected-response', (_req, response) => resolve(response)); });assert.equal(originResponse.statusCode,403);
  const unjoined = new WebSocket(base.replace('http','ws') + '/ws', { headers: { Origin: base } });
  await once(unjoined, 'open');unjoined.send(JSON.stringify({ type: 'sync', clientSent: performance.now() }));
  const unjoinedClose = await once(unjoined, 'close');assert.equal(unjoinedClose[0], 1008);
  const binary = new WebSocket(base.replace('http','ws') + '/ws', { headers: { Origin: base } });await once(binary,'open');binary.send(Buffer.from([1,2,3]));assert.equal((await once(binary,'close'))[0],1003);
  const malformed = new WebSocket(base.replace('http','ws') + '/ws', { headers: { Origin: base } });await once(malformed,'open');malformed.send('{');assert.equal((await once(malformed,'close'))[0],1007);
  const oversized = new WebSocket(base.replace('http','ws') + '/ws', { headers: { Origin: base } });await once(oversized,'open');oversized.send('x'.repeat(8193));assert.equal((await once(oversized,'close'))[0],1009);
  const flood = await connect(base,'audience',roomA.room.id);await nextMessage(flood,m=>m.type==='welcome');for(let i=0;i<201;i++)flood.send(JSON.stringify({type:'sync',clientSent:performance.now()}));assert.equal((await once(flood,'close'))[0],1008);
  const invalidCommand = await fetch(`${base}/api/operator/command`, { method: 'POST', headers: { Authorization: `Bearer ${roomA.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'torch', enabled: 'false' }) });assert.equal(invalidCommand.status,400);
  const operator=await connect(base,'operator',roomA.room.id,roomA.token);
  const stateWithGuest=await nextMessage(operator,m=>m.state?.waiting===1);assert.equal(stateWithGuest.state.id,roomA.room.id);
  operator.send(JSON.stringify({type:'command',command:'torch',enabled:'false',commandId:10}));const rejectedCommand=await nextMessage(operator,m=>m.type==='error'&&m.message==='Invalid command structure');assert.equal(rejectedCommand.command,'torch');assert.equal(rejectedCommand.commandId,10);
  const initialSequence=stateWithGuest.state.sequence;assert.ok(Number.isSafeInteger(initialSequence));
  operator.send(JSON.stringify({type:'command',command:'effect',effect:'twinkle',commandId:11}));
  const effectState=await nextMessage(operator,m=>m.state?.effect==='twinkle');assert.ok(effectState.state.sequence>initialSequence);
  operator.send(JSON.stringify({type:'command',command:'effect',effect:'beacon',commandId:11}));
  const duplicate=await nextMessage(operator,m=>m.type==='ack'&&m.commandId===11);assert.equal(duplicate.duplicate,true);
  const operatorReconnect=await connect(base,'operator',roomA.room.id,roomA.token);await nextMessage(operatorReconnect,m=>m.type==='welcome');operatorReconnect.send(JSON.stringify({type:'command',command:'effect',effect:'beacon',commandId:11}));const replay=await nextMessage(operatorReconnect,m=>m.type==='ack'&&m.commandId===11);assert.equal(replay.duplicate,true);operatorReconnect.close();
  await new Promise(resolve=>setTimeout(resolve,60));let uiCommandId=12;for(const [command,payload] of [['rate',{value:.7}],['protection',{enabled:true}],['torch',{enabled:true}],['torch',{enabled:false}],['screen-mode',{enabled:true}],['screen-colors',{screenColor:'#ff315a',accentColor:'#ffd21f'}],['screen-mode',{enabled:false}],['marquee',{text:'UI contract'}]]){operator.send(JSON.stringify({type:'command',command,commandId:uiCommandId++,...payload}));await nextMessage(operator,m=>m.type==='ack'&&m.command===command);await new Promise(resolve=>setTimeout(resolve,60))}
  assert.equal((await (await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${roomA.token}`}})).json()).state.effect,'twinkle');
  operator.send(JSON.stringify({type:'command',command:'effect',effect:'solid',commandId:20}));
  const solidState=await nextMessage(operator,m=>m.state?.effect==='solid');assert.equal(solidState.state.rate,0);
  await new Promise((resolve)=>setTimeout(resolve,60));
  operator.send(JSON.stringify({type:'command',command:'effect',effect:'pulse',rate:0,commandId:21}));
  const pulseState=await nextMessage(operator,m=>m.state?.effect==='pulse');assert.equal(pulseState.state.rate,0.25);
  operator.send(JSON.stringify({type:'command',command:'sync-start',commandId:22}));
  const testStarted=await nextMessage(audience,m=>m.state?.syncTest?.active);assert.equal(testStarted.state.syncTest.testId,1);
  await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-start');
  audience.send(JSON.stringify({type:'confirm-sync',testId:1}));
  const joined=await nextMessage(audience,m=>m.type==='joined');assert.equal(joined.state.audience,1);assert.equal(typeof joined.reconnectToken,'string');
  await nextMessage(operator,m=>m.state?.audience===1&&m.state?.waiting===0);
  await new Promise((resolve)=>setTimeout(resolve,60));
  operator.send(JSON.stringify({type:'command',command:'sync-stop',commandId:23}));
  await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-stop');
  await new Promise((resolve)=>setTimeout(resolve,60));
  operator.send(JSON.stringify({type:'command',command:'start',commandId:24}));
  const started=await nextMessage(audience,m=>m.state?.status==='running');assert.ok(started.state.startedAt>0);
  await new Promise((resolve)=>setTimeout(resolve,60));
  const livePlan={durationMs:15_000,cues:[{at:0,effect:'pulse',rate:1,screenColor:'#ff315a',accentColor:'#ffd21f',group:null}]};
  operator.send(JSON.stringify({type:'command',command:'show-plan',plan:livePlan,commandId:25}));
  const livePlanState=await nextMessage(audience,m=>m.state?.showPlan?.cues?.[0]?.screenColor==='#ff315a');
  assert.equal(livePlanState.state.status,'running');assert.equal(livePlanState.state.startedAt,started.state.startedAt);assert.equal(livePlanState.state.epoch,started.state.epoch);
  await nextMessage(operator,m=>m.type==='ack'&&m.command==='show-plan');
  await new Promise(resolve=>setTimeout(resolve,60));
  operator.send(JSON.stringify({type:'command',command:'marquee',text:'GO TEAM!',commandId:26}));
  await nextMessage(operator,m=>m.type==='ack'&&m.command==='marquee');
  const messageState=await nextMessage(audience,m=>m.state?.marquee==='GO TEAM!');assert.equal(messageState.state.marquee,'GO TEAM!');
  audience.close();if(!audience.__closed)await once(audience,'close');
  audience=await connect(base,'audience',roomA.room.id,undefined,{reconnectToken:joined.reconnectToken});const reconnected=await nextMessage(audience,m=>m.type==='welcome');
  assert.equal(reconnected.state.status,'running');assert.equal(reconnected.state.marquee,'GO TEAM!');assert.equal(typeof reconnected.audienceIndex,'number');assert.equal(reconnected.state.waiting,0);
  const late=await connect(base,'audience',roomA.room.id);const lateState=await nextMessage(late,m=>m.type==='welcome');assert.equal(lateState.state.status,'running');
  operator.send(JSON.stringify({type:'command',command:'blackout',commandId:27}));
  const dark=await nextMessage(audience,m=>m.type==='blackout');assert.equal(dark.state.status,'blackout');
  const otherOperator=await connect(base,'operator',roomB.room.id,roomA.token);
  if(!otherOperator.__closed)await once(otherOperator,'close');assert.equal(otherOperator.__closed,true);
  const cross=await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${roomA.token}`}});assert.equal((await cross.json()).state.id,roomA.room.id);
  operator.send(JSON.stringify({type:'command',command:'stop',commandId:28}));
  const ended=await nextMessage(audience,m=>m.type==='stop');assert.equal(ended.state.status,'idle');
  const operatorRevoked=once(operator,'close');const closedRoom=await fetch(`${base}/api/operator/close`,{method:'POST',headers:{Authorization:`Bearer ${roomA.token}`}});assert.equal(closedRoom.status,200);assert.equal((await operatorRevoked)[0],1000);
  assert.equal((await fetch(`${base}/api/rooms/${roomA.room.id}`)).status,404);
  const staleAudience=await connect(base,'audience',roomA.room.id,undefined,{reconnectToken:joined.reconnectToken});if(!staleAudience.__closed)await once(staleAudience,'close');assert.equal(staleAudience.__closeCode,1008);
  const roomBState=await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${roomB.token}`}});assert.equal((await roomBState.json()).state.id,roomB.room.id);
  for(const ws of [audience,late,operator])ws.close();
});

test('audience auto-sync probes relay only through their room controller', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const roomA=await create(base,'Controller clock A'),roomB=await create(base,'Controller clock B');
  const operatorA=await connect(base,'operator',roomA.room.id,roomA.token),operatorAActive=await connect(base,'operator',roomA.room.id,roomA.token),operatorB=await connect(base,'operator',roomB.room.id,roomB.token),audience=await connect(base,'audience',roomA.room.id);
  await Promise.all([nextMessage(operatorA,m=>m.type==='welcome'),nextMessage(operatorAActive,m=>m.type==='welcome'),nextMessage(operatorB,m=>m.type==='welcome'),nextMessage(audience,m=>m.type==='welcome')]);
  const probeId=crypto.randomUUID(),clientSent=performance.now();
  audience.send(JSON.stringify({type:'controller-ping',probeId,clientSent}));
  await nextMessage(operatorAActive,m=>m.type==='controller-ping'&&m.probeId===probeId);
  operatorA.send(JSON.stringify({type:'controller-pong',probeId,controllerReceived:15,controllerSent:16}));
  operatorB.send(JSON.stringify({type:'controller-pong',probeId,controllerReceived:10,controllerSent:11}));
  operatorAActive.send(JSON.stringify({type:'controller-pong',probeId,controllerReceived:20,controllerSent:21}));
  const result=await nextMessage(audience,m=>m.type==='controller-pong'&&m.probeId===probeId);
  assert.equal(result.clientSent,clientSent);assert.equal(result.controllerReceived,20);assert.equal(result.controllerSent,21);assert.equal(result.unavailable,undefined);
  for(const ws of [operatorA,operatorAActive,operatorB,audience])ws.close();
});

test('controller lease pauses the running show and turns output off', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test',SHOW_CONTROL_LEASE_MS:'1000'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const created=await create(base,'Lease check'),operator=await connect(base,'operator',created.room.id,created.token);await nextMessage(operator,m=>m.type==='welcome');
  operator.send(JSON.stringify({type:'command',command:'sync-start',commandId:1}));await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-start');
  operator.send(JSON.stringify({type:'command',command:'sync-stop',commandId:2}));await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-stop');
  operator.send(JSON.stringify({type:'command',command:'start',commandId:3}));await nextMessage(operator,m=>m.state?.status==='running');
  const paused=await nextMessage(operator,m=>m.type==='stop'&&m.state?.status==='paused',3000);assert.equal(paused.state.torchEnabled,false);assert.equal(paused.state.epoch,2);
  operator.close();
});

test('production security headers and health diagnostics are constrained', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:'https://lightsync.example',SESSION_SECRET:'test-secret-for-production-config-1234567890',NODE_ENV:'production'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const response=await fetch(`${base}/health`),health=await response.json();assert.equal(health.ok,true);assert.equal('process' in health,false);assert.equal('rooms' in health,false);assert.match(response.headers.get('strict-transport-security'),/max-age=31536000/);
  const operatorAsset=await fetch(`${base}/assets/operator.js`);assert.equal(operatorAsset.headers.get('cache-control'),'no-store');
  const operatorPage=await fetch(`${base}/host`);assert.equal(operatorPage.headers.get('cache-control'),'no-store');
});

test('client cannot forge sync-confirmed reconnect state', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const created=await create(base,'Sync admission'),operator=await connect(base,'operator',created.room.id,created.token);await nextMessage(operator,m=>m.type==='welcome');
  operator.send(JSON.stringify({type:'command',command:'sync-start',commandId:1}));await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-start');
  operator.send(JSON.stringify({type:'command',command:'sync-stop',commandId:2}));await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-stop');
  operator.send(JSON.stringify({type:'command',command:'start',commandId:3}));await nextMessage(operator,m=>m.state?.status==='running');
  const forged=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Origin:base}});forged.__messages=[];forged.__waiters=[];forged.on('message',raw=>{const message=JSON.parse(raw.toString());forged.__messages.push(message);for(const waiter of forged.__waiters){if(waiter.predicate(message)){forged.__waiters.splice(forged.__waiters.indexOf(waiter),1);waiter.resolve(message);break}}});
  await once(forged,'open');forged.send(JSON.stringify({type:'hello',role:'audience',room:created.room.id,syncConfirmed:true}));
  const welcome=await nextMessage(forged,m=>m.type==='welcome');assert.equal(welcome.audienceIndex,null);assert.equal(welcome.state.audience,0);assert.equal(welcome.state.waiting,1);forged.close();await once(forged,'close');
  operator.send(JSON.stringify({type:'command',command:'sync-start',commandId:4}));await nextMessage(operator,m=>m.type==='ack'&&m.command==='sync-start');
  const guest=await connect(base,'audience',created.room.id);await nextMessage(guest,m=>m.type==='welcome');guest.send(JSON.stringify({type:'confirm-sync',testId:2}));const joined=await nextMessage(guest,m=>m.type==='joined');assert.equal(typeof joined.reconnectToken,'string');guest.close();await once(guest,'close');
  const reconnect=await connect(base,'audience',created.room.id,undefined,{reconnectToken:joined.reconnectToken});const admitted=await nextMessage(reconnect,m=>m.type==='welcome');assert.equal(typeof admitted.audienceIndex,'number');reconnect.close();await once(reconnect,'close');
  const audienceAsOperator=await connect(base,'operator',created.room.id,joined.reconnectToken);assert.equal((await once(audienceAsOperator,'close'))[0],1008);
  const second=await create(base,'Different room'),secondOperator=await connect(base,'operator',second.room.id,second.token);await nextMessage(secondOperator,m=>m.type==='welcome');
  for(const [command,commandId] of [['sync-start',1],['sync-stop',2],['start',3]]){secondOperator.send(JSON.stringify({type:'command',command,commandId}));await nextMessage(secondOperator,m=>m.type==='ack'&&m.command===command)}
  const crossRoom=await connect(base,'audience',second.room.id,undefined,{reconnectToken:joined.reconnectToken}),crossWelcome=await nextMessage(crossRoom,m=>m.type==='welcome');assert.equal(crossWelcome.audienceIndex,null);assert.equal(crossWelcome.state.audience,0);assert.equal(crossWelcome.state.waiting,1);crossRoom.close();secondOperator.close();operator.close();
});

test('public room lookups and HTTP operator commands have bounded rates', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test',ROOM_LOOKUPS_PER_MINUTE:'2',OPERATOR_COMMANDS_PER_10_SECONDS:'1'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const created=await create(base,'Rate limit check');
  assert.equal((await fetch(`${base}/join/${created.room.id}`)).status,200);
  assert.equal((await fetch(`${base}/api/rooms/${created.room.id}`)).status,200);
  assert.equal((await fetch(`${base}/api/rooms/not-a-code`)).status,404);
  assert.equal((await fetch(`${base}/join/not-a-code`,{redirect:'manual'})).status,302);
  const limitedLookup=await fetch(`${base}/api/rooms/not-a-code`);assert.equal(limitedLookup.status,429);assert.ok(Number(limitedLookup.headers.get('retry-after'))>=1);
  const command=(commandId,kind='marquee')=>fetch(`${base}/api/operator/command`,{method:'POST',headers:{Authorization:`Bearer ${created.token}`,'content-type':'application/json'},body:JSON.stringify(kind==='marquee'?{command:kind,commandId,text:'hi'}:{command:kind,commandId})});
  assert.equal((await command(1)).status,200);
  const limitedCommand=await command(2);assert.equal(limitedCommand.status,429);assert.ok(Number(limitedCommand.headers.get('retry-after'))>=1);
  assert.equal((await command(2,'blackout')).status,200);
  const operator=await connect(base,'operator',created.room.id,created.token);await nextMessage(operator,m=>m.type==='welcome');
  operator.send(JSON.stringify({type:'command',command:'marquee',text:'too fast',commandId:3}));
  const websocketLimited=await nextMessage(operator,m=>m.type==='error'&&m.commandId===3);assert.match(websocketLimited.message,/rate limit/);
  operator.send(JSON.stringify({type:'command',command:'blackout',commandId:3}));assert.equal((await nextMessage(operator,m=>m.type==='ack'&&m.command==='blackout')).command,'blackout');operator.close();
});

test('WebSocket connection cap rejects excess local connections', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test',MAX_WEBSOCKET_CONNECTIONS:'1'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const first=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Origin:base}});await once(first,'open');
  const rejected=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Origin:base}});
  const status=await new Promise((resolve)=>{rejected.once('unexpected-response',(_req,response)=>resolve(response.statusCode));rejected.once('error',()=>resolve(0))});assert.equal(status,503);
  first.close();await once(first,'close');
});

test('operator token expiry closes an already-connected WebSocket', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`,secret='phase3-verification-test-secret-0123456789';
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:base,NODE_ENV:'test',SESSION_SECRET:secret},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const created=await create(base,'Expiring operator',secret),expiresAt=Date.now()+1500,token=resignToken(created.token,secret,expiresAt);
  const operator=await connect(base,'operator',created.room.id,token);await nextMessage(operator,m=>m.type==='welcome');
  assert.equal((await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${token}`}})).status,200);
  const closeCode=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('expired operator socket remained open')),3500);operator.once('close',code=>{clearTimeout(timer);resolve(code)})});assert.equal(closeCode,1008);
  assert.equal((await fetch(`${base}/api/operator/state`,{headers:{Authorization:`Bearer ${token}`}})).status,401);
});

test('configured public origin accepts its exact reverse-proxy WebSocket origin only', async (t) => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`,publicOrigin='https://show.example.test';
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_BASE_URL:publicOrigin,NODE_ENV:'test'},stdio:'ignore'});
  t.after(()=>child.kill());await waitForServer(base,child);
  const created=await create(base,'Proxy origin',TEST_SESSION_SECRET,publicOrigin);assert.ok(created.url.startsWith(`${publicOrigin}/join/`));
  const accepted=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Origin:publicOrigin}});
  const welcome=new Promise((resolve,reject)=>{accepted.once('error',reject);accepted.on('message',raw=>{const message=JSON.parse(raw.toString());if(message.type==='welcome')resolve(message)})});
  await once(accepted,'open');accepted.send(JSON.stringify({type:'hello',role:'operator',room:created.room.id,token:created.token}));
  assert.equal((await welcome).state.id,created.room.id);const acceptedClosed=once(accepted,'close');accepted.close();await acceptedClosed;
  const rejected=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Origin:'https://other.example.test'}});
  const status=await new Promise((resolve)=>{rejected.once('unexpected-response',(_request,response)=>resolve(response.statusCode));rejected.once('error',()=>resolve(0))});assert.equal(status,403);
});
