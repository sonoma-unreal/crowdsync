# Reference research: `AndriiShramko/crowd-light-show`

Inspected repository: <https://github.com/AndriiShramko/crowd-light-show>  
Commit: `7855e8227b43276f6f8c1f0d3412250b001de951`  
Reference license: Apache-2.0 (verified in its `LICENSE`, `NOTICE`, and `package.json`).  
CrowdSync provenance: independently authored code and UI; no source/assets copied.

Additional supplied source archive: `C:\Users\Hecto\Downloads\crowd-light-show-0_10_0.zip` (package identifies itself as `0.10.0`; the archive contains no `.git` metadata, so a commit SHA cannot be established). SHA-256: `2B02E13100EAE388F4F37D0198DD4F1A7B551C2A399EB2D5C5E7D423E99EA20A`. The archive was inspected in place without extracting over the workspace. It is an earlier source snapshot and is treated as supplemental reference material; the current GitHub checkout remains the canonical reference revision.

## Files and behavior reviewed

- `README.md`, `package.json`, `LICENSE`, `NOTICE`, `config.env.example`, `Dockerfile`, and `docker-compose.yml`: Node 20+, Fastify, `ws`, better-sqlite3, qrcode; deployment and product feature claims.
- `src/server.js`: Fastify routes, upload limits, operator role check, room-scoped console token claims, join URL/QR behavior, WebSocket hello/sync/operator command protocol, heartbeat and room cleanup.
- `src/config.js`, `src/auth.js`: startup configuration, scrypt password verification, HMAC signed/expiring session tokens. The reference contains a conspicuous `changeme-dev` fallback when credentials are omitted; CrowdSync does not use a known operator password.
- `src/show.js`: per-room run state, epoch invalidation, scheduled starts, pause/resume/seek semantics, audience membership broadcasts, manual and palette state, and blackout/stop behavior.
- `src/compiler.js`, `src/presets.js`, `src/fx.js`: fixed-rate cue resampling, red color desaturation, flash-rate gates, brightness slew, parameter validation, and independent effect/channel behavior.
- `src/db.js`, `src/audio.js`: SQLite schema and WAL, track metadata, WAV parsing and FFmpeg decoding, RMS envelope analysis and beat estimation. Upload path couples content sniffing, bounded files, decode and retention controls in server routes.
- `public/audience.html`, `public/audience.js`, `public/clocksync.js`, `public/presets.js`: warning/consent, locally evaluated effects, screen/torch distinction, minimum-RTT clock offset estimate and resync behavior, local governor and torch teardown.
- `public/operator.html`, `public/operator.js`: operator dashboard, transport, presets, join code, manual controls and room state.
- `test/safety.test.mjs`, `test/sync_harness.mjs`, plus test inventory: the safety suite attempts >3 flashes/s, saturated-red patterns, ramp limits, and audio-derived output; the synchronization harness measures clock-offset spread among browser clients and explicitly says same-host tests are not physical/network validation.
- `tools/vj-bridge/README.md`, `bridge.mjs`, `osc.mjs`: local OSC/UDP adapter forwards validated API commands outbound and keeps inbound ports off the show server.
- Supplied v0.10.0 ZIP `package.json`, `README.md`, `src/config.js`, `src/auth.js`, `src/compiler.js`, and `test/safety.test.mjs`: confirms the earlier release already had the same core Node/Fastify/SQLite/QR/FFmpeg stack and timeline governor. The v0.10 docs describe whole-timeline local playback, optional Android torch, upload/playlist transport, and per-show T0 alignment. The package scripts offer focused safety and sync suites. Its safety test references three WAV fixtures that are not present in the supplied ZIP listing; `scripts/make_fixtures.mjs` is included to generate them. No `.git` directory or source commit SHA is included in the archive.
- A protocol comparison found a concrete authorization lesson: the v0.10 WebSocket operator hello branch verified that a signed token existed but did not check its role before adding that connection to the main operator set. The later inspected HEAD explicitly checks `role === 'operator'` and rejects room-console tokens. CrowdSync checks both role and exact room claim on its operator WebSocket handshake.

## Feature inventory

| Area | Verified in source/tests | Documented or incomplete boundary |
|---|---|---|
| Rooms and access | Main room plus ephemeral room objects; signed room-claim console tokens; WebSocket role checks | Room creation limits/expiry are in-memory and single-process, not durable multi-node rooms |
| Join / QR | Room join URLs and generated QR routes | Camera torch depends on browser/hardware and secure-context support |
| Synchronization | Monotonic server clock, NTP-like low-RTT offset, local timeline evaluation, pause/resume/seek epochs | Automated same-host harness does not establish arbitrary-device frame accuracy |
| Safety | Server timeline compiler, client rendering backstop, torch gate, ≤3 flashes/s policy, red-color clamp, ramp rule; dedicated test source | Policy is an engineering safeguard, not a guarantee for every sensitivity |
| Media | SQLite track records, upload and content checks, WAV native parser, FFmpeg decode, envelope compiler | Device playback/rights/resource behavior remains conditional on feature flags and environment |
| Control | Live presets, screen and torch channels, manual VJ values, palette lock, FX, marquee, mute, transport | Server validation required for all control paths; UI alone is not authorization |
| VJ | OSC bridge maps local UDP to outbound authenticated API calls | Optional integration; increases the attack surface on the operator machine |
| Hosting | Docker and reverse proxy guidance; configuration and cleanup code | Requires strong deployment configuration, secure TLS and appropriate limits |

## Architecture choices applied to CrowdSync

CrowdSync retained useful product outcomes: a clear Audience/Show/Live operator workflow, a synchronized crowd preview, reusable light scores, optional anonymous sections, local deterministic playback, and compact safety-bounded controls. Its implementation is independent: one Fastify process with ephemeral rooms, `ws`, QR URLs, vanilla clients and a deterministic sampler/governor for phone torches or screen fallback. A controller-local cue designer analyzes track energy and estimates tempo in the browser, then sends only a bounded effect schedule to the room; the audio itself stays local. CrowdSync does not implement uploaded playlists, server-side audio decoding, durable show storage, external DJ microphone tracking, or the reference's OSC bridge.
