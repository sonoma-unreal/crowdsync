# Architecture

## Runtime

```text
Operator browser ─┐            ┌─ Audience browser (local synchronized cue loop)
                  ├─ HTTP + WS ┤
                  │            │
              Fastify / in-memory room state ─── PostgreSQL account + saved show records
```

The Node process owns room state and issues a room-bound HMAC operator token. Each room has a six-digit join code. Guests first enter a waiting set using the public six-digit room locator; the controller starts a repeating sync test with an audio beep and preview pulse. Guests choose torch or screen output, adjust a local timing offset, and confirm before entering the audience set. After confirmation, the server issues a signed, room-instance-bound reconnect token that expires with the room; it grants no controller authority. The sync test completes automatically when every currently waiting guest confirms; the controller can also finish it manually. The show cannot start while the test is active or guests are still waiting. Late arrivals repeat this process, including during a running show. `/assets/safety.js` is shared by server tests and the browser effect loop.

Every authoritative snapshot carries a monotonically increasing in-room sequence number. Clients ignore older snapshots, and operator commands carry monotonically increasing room-scoped IDs so duplicate or stale commands are acknowledged without being applied again, including after a controller WebSocket reconnect. The controller keeps its command counter in tab-scoped session storage. Reconnection authenticates again and receives the current snapshot; clients do not replay a cue history. Clock offset is estimated from the best round-trip sample and shown in the operator desk; it is a diagnostic estimate, not a guarantee of device-to-device timing. Join/leave presence snapshots coalesce for 50 ms to avoid one full-room broadcast for every arrival. Safety commands are applied synchronously and broadcast immediately.

Audience devices can use a physical torch or synchronized full-screen color output. Guests choose their output in Settings; the controller can force all connected and waiting devices to screen output and set a primary/accent palette. Torch activation follows a direct tap and camera permission; when torch capability is absent or permission fails, screen output is available without camera access. The torch video track is never displayed or read. Each device's on/off requests pass through a local rolling-window governor.

The Show workspace decodes a controller-selected audio file locally, estimates tempo and audio transients, then creates discrete beat keyframes over at most ten minutes. Keyframe offsets are quantized and compactly encoded to fit the room message limit. The browser keeps the decoded track and audio playback local. The room receives the beat map, a compact style-index map, a bounded style table, and optional section targets. Each beat can select its own effect and screen color. Audience devices evaluate each keyframe against the shared event clock; no per-frame network messages are sent. The local device governor still caps rapid pulses. The 96-device controller preview uses the same sampler and governor. The node-flow editor renders an overview and virtualizes its per-beat inspector list. Up to 20 named light scores can be saved in that browser's local storage; they do not contain audio files. Separately, signed-in hosts can save show names and bounded visual setup (effect, rate, colors, sections, messages, and cue plans) to PostgreSQL through `DATABASE_URL`. Audio files, live audience connections, active room codes, and transport state are not stored. Reopening a saved setup after its room has expired creates a new room with output off.

Google account sessions use random opaque HttpOnly cookies. PostgreSQL stores only a SHA-256 hash of each token; logout deletes the matching session row. Sessions do not expire server-side and remain valid until revoked by sign-out. A long-lived browser cookie is used so the host stays signed in across browser restarts. With no `DATABASE_URL`, sessions and saved show setups fall back to process memory and are temporary; the host dashboard labels this state.

An operator may configure two to six anonymous audience section labels before guests join. Guests choose a section as part of sync confirmation. The server keeps only the label set and current per-section counts; signed audience reconnect tokens preserve the selected section for that room. A cue may target one section or everyone. Section choices contain no names or identity fields.

## State lifecycle

- Idle: torch output is off; effects are prepared.
- Running: one of 17 synchronized light patterns or a bounded timed cue score may run after the sync test is complete and the operator enables output. A score ends at its declared duration and turns output off. Solid light holds continuously within its cue; patterned output still follows the local flash governor, including across cue changes. Guests always have a local off control.
- Paused: the phone track is stopped and torch output is requested off; resume continues from the paused effect position. Guests enable their torch again.
- Blackout: output is disabled immediately, any sync test is canceled, and emergency commands bypass normal command throttling. `Clear blackout` returns the room to idle and requires a fresh sync test.
- Stop: returns to idle and disables room-wide torch output.
- Close / 12-hour expiry / process exit: room state and audience connections end and clients disconnect. Room state is not persisted. LightSync does not record or retain audience video.

## Security and privacy

- Operator tokens are signed with a configurable secret and scoped to one room. Production startup requires a 32-character secret and HTTPS `PUBLIC_BASE_URL`.
- WebSocket upgrades require the exact configured origin, use a five-second authentication deadline, reject binary messages, cap payloads at 8 KiB and disable compression. Connections, queued output, per-socket message rates, idle sockets and controller lease are bounded.
- Operator actions require server-validated controller role, room instance and token expiry. Audience joins use the room id and carry no administrative authority; their sockets cannot send operator commands.
- WebSocket command schemas strictly constrain command names, fields, types, effect names, rate values, colors and message text. Room-scoped command IDs reject duplicate and stale actions across reconnects.
- A controller heartbeat every ten seconds maintains a 30-second running-show lease. If it expires, the server pauses the show, disables light output, increments the room epoch and broadcasts the stop state (checked at most one second later). WebSocket ping/pong runs every 20 seconds.
- HTTP responses set a same-origin CSP, framing, MIME, referrer, resource and permissions policies; production also sets HSTS. Public health output is reduced in production.
- No name, precise location, contacts, cookies, analytics, or audience video are collected or retained. Torch permission is used only for flashlight control; the camera track is not displayed or read.
- Bind to loopback for local use. For events, use a trusted HTTPS reverse proxy, set `PUBLIC_BASE_URL`, preserve WebSocket upgrades, and keep operator credentials private.

## Known limits

One process only; no SQLite, clustered broadcast, durable room recovery, uploaded audio, external-DJ microphone tracking, external OSC/MIDI, or TLS termination is included. Music analysis and score storage are browser-local, and the server does not keep room state after the process exits. Physical torch compatibility varies by device/browser and has not been tested on a phone in this environment. The design reference inventory is in [REFERENCE_RESEARCH.md](REFERENCE_RESEARCH.md).
