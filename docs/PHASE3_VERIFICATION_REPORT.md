# LightSync Phase 3.1 — Security Verification Report

**Date:** 2026-10-29  
**Scope:** Local repository verification and the controller workflow update requested with the Wildlights reference. No deployment, publication, migration, DNS, tunnel, external service write, or public exposure was performed.

**Historical snapshot:** This report describes the Phase 3.1 verification state before the later Show desk cue-designer work. Its statements that songs, saved shows, groups, and cue timelines are unsupported are historical; see the current [feature matrix](FEATURE_MATRIX.md) and [architecture](ARCHITECTURE.md) for the present implementation.

## Verdict

**SUITABLE FOR FURTHER CONTROLLED TESTING.** The current automated suite, dependency audit, syntax checks, local HTTP smoke check, selector audit, and loopback load scenarios pass. This is not a production readiness or device compatibility verdict. Browser execution under CSP, slow-consumer behavior, several replay/stop interleavings, production proxy controls, and physical phone output remain unverified.

## Scope and architecture checked

LightSync is a single Node.js ES module process. Fastify serves static vanilla-JavaScript pages and JSON endpoints; `ws` carries controller commands, audience presence and sync state. QRCode produces join links. Rooms, tokens' associated room instances, audience sockets, operator sockets, rate timestamps, counters and controller leases are process-local and ephemeral. There is no database, account system, multi-process coordination, or media storage. The process binds to loopback by default.

Controller API calls use an HMAC bearer token scoped to the operator role, room ID, room instance and expiry. Controller WebSockets authenticate in their first `hello`. Audience clients use a public six-digit room locator to enter the waiting set. Only a valid confirmation during an active sync test grants confirmed membership and a signed audience reconnect token; that token is scoped to the same room instance, expires with the room and cannot authorize controller actions. The old `syncConfirmed` hello field is accepted only as an inert boolean and cannot grant membership. The code and regression test confirm this behavior.

Room state is authoritative on the server. Snapshots carry a monotonic sequence; operator commands carry room-scoped increasing IDs. There is no cue timeline or delayed cue queue in this release. Stop and blackout turn off room torch output, cancel sync, advance the room epoch and publish immediately. The audience client also requests local torch-off on stop/blackout, pause, leave, room end, hidden-page suspension and local opt-out. Synthetic tests cannot establish how a browser or a physical torch responds.

Torch access uses `getUserMedia` to acquire a video track because browser torch control is exposed there. Runtime code checks torch capability and applies the torch constraint; it does not render, sample, record, upload or store frames. Screen output does not request camera permission. FanCam functionality is absent from runtime code.

## Verification matrix

| Control / claim | Source evidence | Test evidence | Result | Remaining gap |
|---|---|---|---|---|
| Operator token signature, expiry, role and room scope | `src/auth.js`; `authenticate()` and WS `hello` in `src/server.js` | `test/auth.test.js`; integration checks unauthenticated routes, second-room isolation, wrong-role credential and active-socket expiry | **VERIFIED** for exercised paths | Missing-token, malformed-token, expiry and open-socket expiry have coverage, but no fuzzing of claim shapes or timing analysis |
| Session revocation on room close | `/api/operator/close` deletes room and closes all room sockets | Integration test asserts operator socket close and stale audience token rejection after close | **VERIFIED** for room close | No separate operator logout or in-room token rotation; session bearer remains usable until room close/expiry |
| Audience cannot execute privileged actions | WS role gate and command allowlist in `src/server.js` | Integration test submits all 15 current privileged commands from audience sockets, expects close 1008, then checks authoritative status/effect/torch state unchanged | **VERIFIED** for tested command list | Does not prove resistance to future commands unless the list and regression test are updated together |
| Forged sync-confirmed reconnect state | Audience admission and reconnect-token checks in `src/server.js`; token storage in `public/audience.js` | New `client cannot forge sync-confirmed reconnect state` integration test: forged boolean waits; valid active-test confirmation reconnects; audience token fails as operator and in another room | **VERIFIED AFTER FIX** | A valid bearer can be replayed more than once in its own room; there is no participant identity or single-use session rotation |
| Pre-auth state/sync access and WebSocket origin | Upgrade origin check, five-second hello deadline, authenticated sync checks in `src/server.js` | Integration test rejects a hostile origin (403), unauthenticated sync (1008), binary, malformed and oversized frames | **PARTIALLY VERIFIED** | Missing `Origin`, unknown message types/fields and silent unauthenticated timeout are not each asserted by a dedicated test |
| WebSocket payload, message rate and connection bounds | `maxPayload: 4096`, 4 KiB recheck, text-only frames, 200 messages/10 sec/socket, configured global cap, 1 MiB `bufferedAmount` close, ping/pong cleanup | Integration suite covers binary/invalid JSON/oversize/flood/global cap | **PARTIALLY VERIFIED** | Slow-consumer queue closure, reconnect storm, unauthenticated timeout, process resilience under cap and fairness for shared-IP crowds not exercised |
| Command schema and numeric/color ranges | `validateCommand()`, `normalizeTorchSettings()` in `src/server.js` and `src/safety.js` | Tests reject a coerced boolean and verify safety normalization/rolling governor; code inspection covers six-digit hex and finite ranges | **PARTIALLY VERIFIED** | Dedicated HTTP/WS cases for unknown fields/types, invalid colors, `Infinity`, negative values and all out-of-range fields are incomplete. JSON cannot encode `NaN`/`Infinity` as numeric literals |
| Replay protection and authoritative ordering | Room `lastCommandId`, snapshot `sequence`, operator client counter in `sessionStorage` | Integration test replays an old command ID after a second WS connection and observes duplicate acknowledgement without applying it | **PARTIALLY VERIFIED** | Old-generation delayed cues, queued commands after revocation, stale commands across room restart and arbitrary message ordering are not tested; this implementation has no scheduled cue queue |
| Emergency stop, blackout and controller-loss lease | `applyCommand()` safety branches, WS immediate send, lease timer in `src/server.js`; audience shutdown in `public/audience.js`; governor in `src/safety.js` | Integration verifies blackout/stop state and lease pauses show/output-off; safety tests check emergency off bypass | **PARTIALLY VERIFIED** | No deterministic clock; no blackout-vs-queued-command interleaving, post-blackout delayed message, controller disconnect/reconnect race, or actual browser/torch response measurement |
| Sync flow and normal audience flow | Sync test gate and signed reconnect token in `src/server.js`; audience UI in `public/audience.js` | Integration covers valid confirmation, running, late audience waiting, reconnect snapshot and start requirements | **VERIFIED** for covered state flow | Human confirmation is a client assertion; an automated client can send `confirm-sync` during the active test without physically aligning to the beep |
| HTTP authorization, body handling and error disclosure | Operator API bearer check, Fastify `bodyLimit: 16 KiB`, fixed asset allowlist, path-only request logger | Integration checks unauthenticated state/command/close, room isolation, headers and invalid command | **PARTIALLY VERIFIED** | Wrong-method/content-type, body-limit boundaries, stack/path/secret disclosure cases and all malformed HTTP schemas lack dedicated coverage |
| CSP and HTTP security headers | `onSend` hook in `src/server.js`; production HSTS branch | Integration asserts headers and no `unsafe-inline`; local smoke check returned 200 for `/host`, `/assets/styles.css`, `/assets/operator.js`, `/health`, all with the CSP header | **PARTIALLY VERIFIED** | No browser run under CSP. Script execution, WebSocket connect-src, style application and mobile layout are not confirmed in Chrome |
| Cookies, CSRF and HTTPS/WSS | No cookies; controller bearer sent in `Authorization`; production config requires HTTPS `PUBLIC_BASE_URL` | Config tests reject weak secret and non-HTTPS origin | **PARTIALLY VERIFIED / N/A** | CSRF defenses are not applicable to the current bearer-header model; TLS termination, forwarding and direct-origin restrictions are deployment concerns and were not tested |
| XSS and unsafe DOM output | `public/operator.js` creates effect buttons from static `EFFECTS`; user text is placed with `textContent`; server strips angle brackets from marquee | Integration sends an HTML-looking marquee string; page security headers tested | **PARTIALLY VERIFIED** | No real browser execution/XSS harness. Static inspection is not proof of all future rendering paths |
| FanCam/media privacy | `public/audience.js`, `src/server.js`, `package.json`, HTML, routes and configuration searched; `getUserMedia` is only in torch path | Integration checks FanCam UI absent and former routes 404; repository search found FanCam mentions only in historical docs/tests/reference notes | **VERIFIED ABSENT FROM RUNTIME** | Historical project notes and tests intentionally retain removal history. Torch permission UI may use browser “camera” wording on some devices |
| Dependency/configuration integrity | `package.json`, `.env.example`, `.gitignore`, `src/auth.js` | `npm audit`; config tests; secret-pattern search | **VERIFIED FOR CHECKED REPOSITORY STATE** | `npm audit` is not an application security assessment. No external secret scanner was installed; `.env` contents were not read |
| Synthetic capacity and cue receipt | `scripts/load.js` opens concurrent loopback WS clients in one room; authenticates operator and sends audience `hello` | Staged `npm run load` and 1,000-client run; clients measured receipt of cue and blackout state | **PARTIALLY VERIFIED** | Audience clients remain in the waiting set (no sync confirmation/reconnect token); single burst/state/blackout only, no TLS/proxy/Wi-Fi/mobile browser/long soak |
| Controller desk redesign and reconnect UX | `public/operator.html`, `public/operator.js`, `public/operator-connection.js`, `public/styles.css` | 115 `#id` selector references checked against operator HTML (none missing); route tests, helper tests and syntax pass | **PARTIALLY VERIFIED** | No rendered browser QA or touch/viewport checks. Wildlights inspiration adapted to current features; songs, saved shows and groups remain unsupported |
| Exact public origin behind a tunnel/proxy | `PUBLIC_BASE_URL` takes precedence over request Host when validating WebSocket `Origin` in `src/server.js` | Synthetic reverse-proxy integration test accepts only the explicitly configured public origin; client test checks page origin against the room join URL | **VERIFIED** for explicit origin configuration | The local `.env` remains set to localhost; a tunnel hostname must be set before starting the server if the host page is opened through that tunnel |

## Reproduced defect and fix

Before the fix, an audience WebSocket could send `hello` with `syncConfirmed: true` and receive an audience index without ever completing the controller's active sync test. The regression test was first run against that behavior and observed an assigned index (`0`) where the expected waiting-state value was `null`.

The server now requires a valid signed audience reconnect token to restore confirmed membership. It issues one only after a valid `confirm-sync` during an active test. The old boolean is not an authorization claim. The regression test now proves forged confirmation stays in the waiting set, a legitimate confirmed guest can reconnect, audience credentials cannot authenticate as an operator, and the credential cannot cross room instances.

## Reconnect issue reproduced from the supplied screenshot

The six-digit room shown in the screenshot was checked against the local server without mutating it. `GET /health` reported `rooms: 0`; `GET /api/rooms/217408` returned **404**. Because rooms are in-memory only, this room no longer existed and could not be restored by reconnecting. The client then received an authorization/unknown-room close (1008), stopped retrying, but still displayed **RECONNECTING** and left both **End show** and **Start a new show** visible. That was a client state-reporting bug layered over the lost room.

The operator client now waits for a server `welcome` before reporting **CONNECTED** or enabling control commands. Expired/unknown rooms and intentional room closure become a clear terminal **ROOM UNAVAILABLE** state; the stale End show/Blackout controls are hidden and the Start a new show action is available. Transient disconnects continue retrying with capped exponential backoff and jitter. Socket identity checks ignore stale events from superseded connections. Unit tests cover terminal versus retryable close codes, retry backoff bounds/jitter, and stale socket identity. The current local room cannot be recovered; a new room is required.

## Ngrok 403 diagnosis

The supplied ngrok inspector and npm transcript reveal a second, independent cause of repeated reconnect attempts. The inspector showed `Host` and `Origin` both equal to `https://swoosh-applause-stretch.ngrok-free.dev`, while the local `.env` has `PUBLIC_BASE_URL=http://localhost:3000`. Because the server intentionally compares the browser `Origin` to the configured public origin, it returns **403** for the WebSocket upgrade even though the HTML, JavaScript and room-creation HTTP requests succeed. The npm transcript itself shows `npm test` passing, `npm install` up to date with no vulnerabilities, assets returning 200 and room creation returning 200; it does not show a Node/npm failure.

The server's strict origin check remains in place. The controller now compares the current page origin with the join-link origin before attempting the WebSocket; on mismatch it explains that `PUBLIC_BASE_URL` must equal the current page origin, the server must be restarted, and a new room must be created. A synthetic integration test verifies that an explicitly configured proxy origin succeeds and a different origin still receives 403. The local `.env` was not changed and no tunnel was created or managed.

## Current operator UI update

The host console now has **Audience → Show → Live** steps inspired by the supplied Wildlights screenshots. Audience shows the six-digit code/QR and sync readiness; Show contains a 96-device local visual mock, 18 effects, six color presets, custom screen colors and six energy choices mapped to the existing safety-capped rate slider; Live contains start/pause/stop, room-wide screen mode, enhanced protection, messaging and activity. Blackout stays in the top bar. The preview is explicitly labeled simulated and does not imply audience telemetry. The follow-up also corrected connection-state display and reconnect behavior.

No song player, saved-show timeline, audience grouping/questions, test-phone pairing, or actual audience grid telemetry was added because the current backend does not implement those systems. The six energy levels only select values within the existing current rate ceiling; they do not raise the torch safety limit.

## Exact commands and results

All commands were run from `C:\Users\Hecto\OneDrive\Documents\ChatGPT\Project Crowdsync` in PowerShell.

### Baseline and final automated suite

```powershell
npm test
```

At the start of the reconnect follow-up the suite had **14 passed, 0 failed**. After the first reconnect fix it had **17 passed**; after the ngrok-origin diagnosis and regression checks the final run was **19 passed, 0 failed** (6.14 s). Added coverage checks terminal/transient close handling, capped jittered backoff, stale socket identity, page/join-link origin comparison, and exact configured proxy-origin enforcement. This suite does not execute browser DOM behavior.

### Dependency audit

```powershell
npm audit
```

Result: **found 0 vulnerabilities**.

### Syntax

```powershell
$files=@('src\server.js','src\auth.js','public\operator.js','public\operator-connection.js','public\audience.js','public\safety.js','test\integration.test.js','test\auth.test.js','test\operator-connection.test.js','scripts\load.js'); foreach($file in $files){ node --check $file; if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE } }; 'All syntax checks passed.'
```

Result: all ten checked JavaScript files passed `node --check`.

### Operator DOM selector audit

```powershell
@'
const fs=require('node:fs');
const html=fs.readFileSync('public/operator.html','utf8');
const js=fs.readFileSync('public/operator.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const refs=[...js.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(id=>!ids.has(id)))];
console.log(`Operator DOM selectors checked: ${refs.length}; missing IDs: ${missing.join(', ')||'none'}`);
if(missing.length)process.exitCode=1;
'@ | node
```

Result: **115 selector references checked; none missing.** This is a static consistency check, not a browser test.

### Local staged load

```powershell
npm run load
$env:LOAD_CLIENTS='1000'; npm run load; Remove-Item Env:\LOAD_CLIENTS
```

Each row is one run on loopback, one ephemeral room, a simultaneous WebSocket join burst, one state cue and blackout. The harness measures client receipt times, not only server queueing. The clients only perform the public audience `hello`; they stay in the waiting set because the load harness does not run the sync-confirm/reconnect flow.

| Clients | Connected | Join burst | Cue p50 / p95 / p99 | Blackout p95 | RSS MiB | CPU one-core % | Event loop max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 50/50 | 24.09 ms | 2.09 / 2.64 / 2.69 | 1.74 ms | 70.85 | 23.47 | 30.95 |
| 100 | 100/100 | 42.45 ms | 2.36 / 3.48 / 3.58 | 2.90 ms | 74.05 | 35.65 | 35.16 |
| 250 | 250/250 | 104.22 ms | 4.14 / 6.82 / 7.05 | 5.73 ms | 77.57 | 38.05 | 38.73 |
| 500 | 500/500 | 175.14 ms | 6.49 / 10.97 / 11.37 | 10.02 ms | 84.03 | 73.26 | 33.98 |
| 1,000 | 1,000/1,000 | 382.11 ms | 11.29 / 19.63 / 20.47 | 19.19 ms | 91.29 | 69.18 | 39.06 |

All 1,000 clients connected and received both measured room broadcasts. This is a single local diagnostic per size; it is not a capacity guarantee. The harness does not measure sustained show traffic, CPU/memory under a soak, packet loss, TLS, proxy behavior, real phone browsers, or torch response.

### Local HTTP/CSP smoke check

```powershell
npm start
```

Then this PowerShell smoke check requested `/host`, `/assets/styles.css`, `/assets/operator.js`, and `/health`:

```powershell
$paths=@('/host','/assets/styles.css','/assets/operator.js','/health'); foreach($path in $paths){ $response=Invoke-WebRequest -Uri ('http://127.0.0.1:3000'+$path) -Method Get -UseBasicParsing; [pscustomobject]@{Path=$path;Status=$response.StatusCode;Type=$response.Headers['Content-Type'];CSP=$response.Headers['Content-Security-Policy'];Bytes=$response.RawContentLength} }; $missing=(Invoke-WebRequest -Uri 'http://127.0.0.1:3000/assets/operator-desk.css' -UseBasicParsing -ErrorAction SilentlyContinue); if($missing){'unexpected extra css route status '+$missing.StatusCode} else {'No separate desk CSS route (styles are served through existing stylesheet).'}
```

The four expected paths returned **200**; their content types were HTML, CSS, JavaScript and JSON respectively, and each included the configured CSP. The separate stylesheet probe returned **404**, as expected because the redesign uses the already allowlisted shared stylesheet. The local server was stopped with Ctrl+C afterward; no process was left running.

### Repository searches

```powershell
rg -ni "fancam|MediaRecorder|getUserMedia|getDisplayMedia|camera|video|microphone|upload|record|clip|sessionStorage|localStorage|token|secret|password|api[_-]?key|BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY" . --glob '!node_modules/**' --glob '!.git/**' --glob '!package-lock.json' --glob '!*.png' --glob '!*.jpg'
```

Result: runtime source includes only the torch `getUserMedia` camera-track path; no media capture/upload/recording/storage path or FanCam route was found. FanCam and media terms remain in historical `docs/BUILD_LOG.md`, reference research, security docs and regression checks. `.env.example` contains a blank `SESSION_SECRET` placeholder and test source contains synthetic secrets; no production secret value was identified in the searched project files. In the later tunnel diagnosis, only local `.env` values for `PUBLIC_BASE_URL`, `HOST` and `PORT` were read; `SESSION_SECRET` was not inspected or copied.

## Outstanding issues, ranked

### High

- **Production edge is unverified.** HTTPS/WSS termination, proxy upgrade forwarding, Host/Origin consistency, direct-origin restriction, WAF/rate controls and provider limits are not configured or tested in this repository.
- **Bearer token lifecycle is limited.** Operator and audience tokens live in tab `sessionStorage`; same-origin script compromise can use them. Operator tokens lack a separate logout/rotation control. Audience reconnect tokens are reusable within their room until expiry and have no participant identity or single-use rotation.
- **Emergency propagation is not physically verified.** Server state fan-out is tested, but browser scheduling, hidden-tab behavior, torch-off timing and phone-specific torch constraints are not.

### Medium

- Slow-consumer and reconnect-storm tests are absent. The implementation closes clients above a 1 MiB queued-send threshold, but the branch is not exercised by a test.
- Emergency blackout versus queued command, delayed old-generation cue, controller revocation with a queued command, and reconnect after blackout were not tested. No scheduled cue queue exists today, so several requested delayed-cue cases are not applicable to current behavior.
- Browser execution under CSP, full DOM/XSS behavior and responsive/touch layout were not tested. The earlier computer-use safety check could not confidently determine the Windows browser URL and blocked UI automation; no alternate browser UI automation was attempted.
- Room creation and six-digit codes are public by design; room creation is limited per source IP and room capacity is bounded. A large crowd sharing one public IP is not audience-rate-limited. Abuse behavior under a public-event traffic pattern is untested.
- The browser's `confirm-sync` message proves only that a client sent the confirmation; the server cannot verify a person's physical timing or attention.

### Low / not applicable

- Database outage and SQL injection are **not applicable**: this version has no database.
- Cookie flags and cookie-based CSRF are **not applicable**: sessions use bearer Authorization headers and no cookies are used.
- Media retention, FanCam orphaned media packages and upload paths are **not applicable to active runtime code**; historical documentation intentionally retains context.

## Working tree and unfinished checks

The repository has no commits and `git status` reports the project files as untracked. Therefore tracked-file `git diff` cannot show a before/after patch; all existing files and user attachments were preserved. This pass changed the operator desk in `public/operator.html`, `public/operator.js`, `public/operator-connection.js`, and `public/styles.css`; added `test/operator-connection.test.js`; expanded `test/integration.test.js` to check module delivery and exact proxy-origin enforcement; documented origin configuration in `.env.example` and `docs/TROUBLESHOOTING.md`; corrected audience reconnect-token documentation in `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`, and `docs/PHASE3_HANDOFF.md`; and added this report. The local `.env` and `.codex-remote-attachments/` were not modified. Port 3000 is not listening; no server/load/audit process remains running.

Not completed in this verification pass: browser/CSP interaction; slow-consumer and reconnect-storm tests; missing-origin, unknown-message and full command-range test cases; full emergency ordering matrix; production proxy/TLS/origin review; physical phone/screen/torch checks. The exact-origin behavior was tested locally with a synthetic hostname, not through the user's live ngrok tunnel. No test result above should be read as evidence for these cases.

## Recommended next action

Run the existing 19-test suite first, then complete a controlled browser check of the operator and audience journeys under CSP: use the intended page origin, create a new room, run and finish sync, join/reconnect, change effect/palette/output, start/pause/resume/stop, and blackout. Follow with bounded slow-consumer/reconnect-storm and emergency-ordering regression tests. Do not expose the service publicly until deployment controls and real-device safety behavior have been separately reviewed.
