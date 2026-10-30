# CrowdSync Phase 3 Security Handoff

Prepared 2026-10-29 after the repository inspection, security changes, regression suite, dependency audit and synthetic local load runs. This report records code and test evidence; it does not claim certification, production readiness, deployment, or real-device validation.

**Historical snapshot:** This handoff predates the later Show desk cue-designer work. Current feature status is documented in [FEATURE_MATRIX.md](FEATURE_MATRIX.md) and current runtime design in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Architecture and threat model

CrowdSync runs as one Node.js 20+ ES-module process. Fastify serves static pages and JSON APIs, `ws` handles room messaging, and QRCode creates join QR images. Browser clients are vanilla JavaScript. Room state, audience connections, controller sessions, rate-limit timestamps and command counters live in process memory. There is no database, persistent room store, multi-process coordination, account system, or media storage. Rooms close on operator action, expire after 12 hours, and disappear on process exit.

The primary trust boundary is between the Node server and untrusted browsers. The controller bearer token is scoped by HMAC claims to the operator role, room id, room instance and expiry. Controller HTTP routes authenticate every request. Controller WebSockets authenticate in the first `hello`; audience clients initially use the six-digit public room locator and receive only the audience-visible state. A guest that confirms an active sync test receives a signed audience reconnect token, scoped to the current room instance and remaining room lifetime, so a reconnect can restore confirmed membership. The room code alone does not restore confirmed membership; the legacy client `syncConfirmed` flag is not trusted. Audience command messages are rejected. Strict WebSocket command allowlists, room-scoped monotonic command IDs and server-owned state control privileged changes. The server does not accept client-supplied authority or cue code.

Trust boundaries also include the browser security origin, the configured reverse proxy in a production deployment, and supported phone torch APIs. Screen output needs no camera permission. Torch access uses a camera video track only to set the torch constraint; the application does not display, inspect, record, upload or store video frames. The FanCam feature has been removed.

## 2. Prioritized findings and status

| Severity | Finding and code evidence | Fix / regression evidence | Status |
|---|---|---|---|
| High | WebSocket upgrades did not validate `Origin`, and unauthenticated sockets could request clock sync before `hello` (`src/server.js`). | Exact configured-origin check before upgrade; clock sync now requires authenticated role; 403 origin and pre-auth sync rejection covered by integration test. | FIXED AND TESTED |
| High | A controller token's expiry was not rechecked on an already-open socket; command duplicate IDs were scoped only to one connection. | Recheck token expiry on heartbeat/ping; room-scoped command IDs persist in tab session storage and are checked across reconnects; token-expiry unit check and replay-after-reconnect integration check pass. Room close also invalidates open sockets. | FIXED AND TESTED |
| High | No bounded show-control lease existed if the controller disappeared during an active show. | Controller heartbeat every 10 seconds; default 30-second lease pauses the show, disables torch output, advances the epoch and broadcasts state. General stop/blackout still bypass command throttling. A short-lease integration test checks pause and output-off behavior. | FIXED AND TESTED — lease behavior is tested in-process; browser background timing and real network failures remain unverified. |
| High | Persistent WebSockets lacked connection, outbound-queue, liveness and message-rate bounds. | Default maximum 5,000 sockets, 4 KiB messages, 200 messages per 10-second socket window, 1 MiB outbound queue cap, 20-second ping/pong cleanup, 5-second `hello` deadline and disabled per-message compression. Binary, oversized and flood behavior is exercised. | FIXED BUT NOT FULLY VERIFIED — individual protocol guards are tested; soak, slow-client, multi-room contention and connection-cap tests remain outstanding. |
| Medium | Controller command fields were weakly validated and booleans were coerced; unknown effects/fields could pass into permissive paths. | Strict command allowlist and typed/ranged values for effect, rate, colors and message; monotonic IDs required; audience command injection, invalid HTTP command and existing effect behavior are tested. | FIXED AND TESTED |
| Medium | Browser responses lacked explicit CSP/framing/MIME/referrer policies; production health exposed process diagnostics. | Same-origin CSP and security headers added; production health response is minimal; production HSTS and hidden diagnostics are integration-tested. User-controlled text uses `textContent`; the only generated `innerHTML` in the controller builds buttons from static effect constants. | FIXED BUT NOT FULLY VERIFIED — headers are tested by HTTP integration; controller/audience pages have not been browser-tested under the CSP in this pass. |
| Medium | Development signing used a fixed public fallback key. | Development uses a random process-local key; production continues to require a 32-character `SESSION_SECRET` and HTTPS `PUBLIC_BASE_URL`. Production configuration startup tests pass. | FIXED AND TESTED |
| Medium | `.env` ignore coverage did not include named environment variants such as `.env.production`. | `.gitignore` now ignores `.env*` while allowing `.env.example`; the sample contains blank secret placeholder and bounded setting defaults. | FIXED BUT NOT FULLY VERIFIED — repository status confirms local `.env` remains ignored; no external secret scanner is installed. |
| Medium | A stale FanCam token cleanup line remained in the audience client after feature removal. | Removed the orphaned client cleanup. Active source has no FanCam UI, protocol, routes, storage, capture, upload or review feature; integration checks pages/routes. | FIXED AND TESTED |
| Low | No database or user-controlled file path exists in the current project. | Static assets use a fixed allowlist; rooms are ephemeral. No database was added. | NOT APPLICABLE |
| Medium | Six-digit join codes and host creation remain publicly accessible by design; audience connections are not per-IP limited because many guests may share a school/event NAT. | Existing room capacity and six-creations-per-IP-per-minute controls remain. Public code is a locator, not an access credential. | UNRESOLVED — provider/network rate controls and a public-event abuse model are needed before exposure. |
| High | Controller bearer token is stored in tab-scoped `sessionStorage`; same-origin script compromise can use it. No separate logout or in-room token rotation flow exists. | Room close/expiry revokes the current room token and open sockets; token is never placed in URLs or request logs. | UNRESOLVED — account/session redesign is outside this focused change. |
| High | Production TLS termination, reverse-proxy behavior, direct-origin restriction, WAF configuration and provider limits are not present in this repository. | Production configuration requires HTTPS public origin; proxy requirements are documented. | UNRESOLVED — deployment configuration must be reviewed and exercised separately. |

No tested control is claimed as “fully secure.” The work used [OWASP ASVS 5.0.0](https://asvs.owasp.org/) and the [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) as references; it does not claim ASVS certification or a completed ASVS level.

## 3. Implemented changes

- WebSocket origin enforcement before upgrade; room role and token checks before any sync/state response; five-second authentication timeout.
- Explicit text-only WebSocket protocol with strict command/type/field checks, 4 KiB payload cap, socket and per-socket message limits, disabled compression, queued-send bounds, and ping/pong liveness cleanup.
- HMAC key no longer falls back to a predictable constant in development. Operator expiry is rechecked on active connections.
- Room-scoped command IDs reject duplicates and stale/replayed commands even after a controller reconnect. The controller persists its counter only in tab-scoped session storage.
- Controller heartbeat lease stops active output after the configured connection-loss window; emergency stop/blackout remain prioritized.
- Response security headers and production-minimal health endpoint; URL query strings are omitted from request logs.
- `.env*` ignore coverage, placeholder configuration for WebSocket/lease limits, privacy/architecture/feature docs, and this handoff updated.
- FanCam residual cleanup removed from the audience client. No FanCam code, media data, capture or upload path was added.

## 4. Verification and exact commands

Fresh baseline before source changes:

```powershell
npm test
```

Result: **8 passed, 0 failed**.

Final regression suite:

```powershell
npm test
```

Result: **11 passed, 0 failed**. Coverage includes signed/tampered/expired tokens, production configuration and headers, HTTP room lifecycle, room isolation, rejected origins, unauthenticated sync rejection, audience operator-command rejection, invalid command fields, malformed/binary/oversized messages, message flood limits, reconnect sync, controller replay after reconnect, controller-lease pause, open controller socket revocation on room close, FanCam route/UI absence and effect safety bounds.

Dependency audit:

```powershell
npm audit
```

Result: **0 vulnerabilities reported**.

Syntax checks completed successfully:

```powershell
$files=@('src\server.js','src\auth.js','public\operator.js','public\audience.js','test\integration.test.js','test\auth.test.js','scripts\load.js'); foreach($file in $files){ node --check $file; if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE } }
```

## 5. Synthetic local load results

Commands:

```powershell
npm run load
$env:LOAD_CLIENTS='1000'; npm run load
```

The harness ran one loopback server/client process pair per scenario. It measured a simultaneous audience connection burst, one state cue fan-out and emergency blackout fan-out. It did not include TLS, reverse proxy, venue Wi-Fi, packet loss, mobile browsers, sustained traffic or external devices. These are single-run diagnostics, not capacity guarantees.

| Clients | Connected | Join burst | Cue p50 / p95 / p99 | Blackout p95 | RSS | CPU, one-core equivalent | Event-loop max |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 50/50 | 24.29 ms | 1.64 / 2.24 / 2.28 ms | 2.56 ms | 70.67 MiB | 59.64% | 39.12 ms |
| 100 | 100/100 | 41.17 ms | 2.41 / 3.55 / 3.63 ms | 3.28 ms | 74.60 MiB | 40.39% | 32.34 ms |
| 250 | 250/250 | 99.68 ms | 4.89 / 7.43 / 7.63 ms | 10.69 ms | 78.14 MiB | 51.76% | 41.65 ms |
| 500 | 500/500 | 175.34 ms | 6.42 / 11.02 / 11.38 ms | 10.11 ms | 83.69 MiB | 54.17% | 39.85 ms |
| 1,000 | 1,000/1,000 | 369.82 ms | 11.33 / 20.57 / 21.36 ms | 20.17 ms | 91.58 MiB | 74.97% | 41.48 ms |

## 6. Privacy and FanCam verification

FanCam is absent from runtime source and dependencies: no enrollment/invitation UI, capture flow, camera frame use, participant-token protocol, media upload/review routes, or storage configuration remains. `public/audience.js` no longer contains the old FanCam-token cleanup. The integration test checks there is no FanCam UI in host/audience HTML and the former HTTP paths return 404. Documentation and the regression test still mention the product name to record its removal.

Torch operation still asks for browser camera permission on capable devices because the torch API is exposed through a video track. Code inspection confirms it only queries torch capability and applies the torch constraint. This review did not perform physical-device validation.

## 7. Cloudflare readiness (no migration performed)

The current Node/Fastify `ws` endpoint can sit behind a Cloudflare proxy that forwards HTTP Upgrade/WebSocket traffic. Cloudflare’s current documentation says proxied WebSockets are supported; it also notes that WAF evaluation covers the initial upgrade request, not messages on an established socket ([WebSockets](https://developers.cloudflare.com/network/websockets/)). CrowdSync therefore retains origin validation, role checks, message schemas, limits and rate guards inside the application.

An actual deployment would need HTTPS at the edge and secure WSS to the public hostname, `PUBLIC_BASE_URL` set to that exact HTTPS origin, and verified forwarding of WebSocket upgrades. The origin should be firewalled to Cloudflare and trusted management sources or otherwise authenticated so direct connections cannot bypass the proxy controls ([Protect your origin server](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)). These settings are not configured or tested here. Suitable edge HTTP limits include room creation and join/API request rates; the provider cannot replace in-app WebSocket message authorization or rate limits.

## 8. Workspace state and unfinished work

The Git repository has no commits yet and is on branch `master`; project files are untracked, so normal tracked-file diffs cannot establish a pre-Phase-3 baseline. The Phase 3 edits are present in the working tree and were not committed. No files were reset, discarded or overwritten outside the planned project documentation/code updates. Local `.env`, `node_modules` and `.reference-crowd-light-show/` remain ignored. The image attachment directory remains untracked and was not modified. No server, test, audit or load process was left running by the completed commands.

Files updated in this Phase 3 pass: `.gitignore`, `.env.example`, `README.md`, `docs/ARCHITECTURE.md`, `docs/FEATURE_MATRIX.md`, `docs/PHASE3_HANDOFF.md`, `docs/SECURITY_PRIVACY.md`, `docs/TROUBLESHOOTING.md`, `public/audience.js`, `public/operator.js`, `scripts/load.js`, `src/auth.js`, `src/server.js`, `test/auth.test.js`, and `test/integration.test.js`. No package dependencies or lockfile were changed. All other paths shown by `git status` were already untracked project files or user-provided attachments; the local `.env` is ignored.

Remaining before any external testing: browser verification of CSP and controller/audience behavior; a lease-expiry test under disconnect/reconnect timing; connection-cap and slow-client tests; production reverse-proxy/TLS/origin controls; review of token handling and public room-code abuse; and physical torch/accessibility validation on supported phones. No deploy, publication, migration, DNS or tunnel change was made.

## 9. Release-readiness verdict

**Ready for further controlled testing; not yet ready for external testing.** Core WebSocket controls, command authorization/validation, session expiry behavior, header presence, existing sync/reconnect tests, dependency audit and synthetic load runs have evidence. Production network controls, browser behavior under CSP, longer-running resilience, token lifecycle improvements and real-device behavior remain unverified or unresolved.
