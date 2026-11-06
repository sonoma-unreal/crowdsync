# LightSync

LightSync is an independently implemented, self-hostable synchronized audience light show. The home screen separates hosting from joining. A controller creates a room and shares its six-digit code, join URL, or QR code; guests complete a controller-started sync test before joining. The controller can run one of 17 synchronized patterns or build a timed, beat-aligned light score from a local audio file. Guests can use their torch or screen.

## Requirements

- Node.js 20 or newer
- npm
- HTTPS for camera permission and physical torch access on devices other than localhost

## Run locally (Windows PowerShell)

```powershell
cd "C:\Users\Hecto\OneDrive\Documents\ChatGPT\Project Crowdsync"
Copy-Item .env.example .env
npm install
$env:PORT = "3000"
$env:HOST = "0.0.0.0"
$env:PUBLIC_BASE_URL = "http://localhost:3000"
npm start
```

Open [http://localhost:3000](http://localhost:3000) and choose Host a show or Join a show. Keep the operator tab open; its credential is bound to that room and stored only in that tab's session storage. For guests on the same Wi-Fi, set `PUBLIC_BASE_URL` to the computer's LAN URL (for example `http://192.168.1.20:3000`) before starting and allow inbound access through the local firewall. Torch permission generally requires HTTPS (or localhost); torch support varies by browser and phone. If torch control is missing or permission is denied, the guest can use synchronized screen light instead.

`npm start` reads `.env` automatically. Production deployments must set `NODE_ENV=production`, configure a unique random `SESSION_SECRET` of at least 32 characters, and set an HTTPS `PUBLIC_BASE_URL`. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. Terminate TLS at a trusted HTTPS reverse proxy and forward WebSocket upgrades to LightSync. Do not expose the operator link publicly. The service binds to loopback by default.

Hosting requires Google sign-in. Set the server-only `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` variables in Render (never use a `PUBLIC_` prefix for the secret). Register `https://crowdsync-lights.onrender.com/auth/google/callback` as an **Authorized redirect URI** on the Google OAuth web client, and set Render's `PUBLIC_BASE_URL` to `https://crowdsync-lights.onrender.com`. `GOOGLE_CALLBACK_URL` may be left blank; LightSync derives it from `PUBLIC_BASE_URL`. For local development, add `http://localhost:3000/auth/google/callback` as another authorized redirect URI and set `PUBLIC_BASE_URL=http://localhost:3000`. Add your Google account under the OAuth consent screen's test users while the app is in Testing. There is no separate sign-up step: verified Google sign-in creates a persistent HttpOnly account session that remains valid until sign-out, with the session token stored hashed in PostgreSQL. Configure server-only `DATABASE_URL` to enable durable account sessions and saved show setups. Without it, the app uses temporary in-memory account storage and identifies that limitation in the host dashboard. Active room codes and audience connections remain in memory and expire after 12 hours or a process restart; reopening a saved show after a restart creates a new room and code, with output off.

Supported environment controls are `HOST`, `PORT`, `PUBLIC_BASE_URL`, `SESSION_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `LOG_LEVEL`, `MAX_ROOMS` (default 100; maximum 1000), `MAX_AUDIENCE_PER_ROOM` (default 2000; maximum 10000), `MAX_WEBSOCKET_CONNECTIONS` (default 5000; maximum 20000), `SHOW_CONTROL_LEASE_MS` (default 30000; maximum 120000), `ROOM_LOOKUPS_PER_MINUTE` (default 300; maximum 60000), and `OPERATOR_COMMANDS_PER_10_SECONDS` (default 200; maximum 2000). Production rejects debug and trace log levels. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md), [docs/SAFETY.md](docs/SAFETY.md), and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Deploying on Render

LightSync is a Node web service, not a static site: its Fastify process serves the browser app and handles the `/ws` WebSocket endpoint. The repository includes [`render.yaml`](render.yaml) for a Render Blueprint deployment. Push the repository to GitHub, choose **New → Blueprint** in Render, and connect the repository containing `render.yaml`. The Blueprint configures `npm ci`, `npm start`, `/health`, the public Render URL, a generated signing secret, and the public network bind address.

The Blueprint uses Render's Free web service and does not provision a database. To keep account sessions and saved show setups through deploys and restarts, create a PostgreSQL database separately and add its connection string as the private `DATABASE_URL` environment variable on the web service. Without that variable, account and saved-show storage is temporary; the host dashboard says so. Render's Free web services can sleep after idle periods and cold-start; active rooms remain in process memory and are discarded by sleeps, restarts, or deploys. Saved show setups survive only when PostgreSQL is configured; reopening one creates a fresh room and join code. See [Render's free-service limits](https://render.com/docs/free), [Render PostgreSQL docs](https://render.com/docs/postgresql), and [WebSocket guidance](https://render.com/docs/websocket).

Do not commit `.env`, credentials, or generated session secrets. The `.gitignore` excludes `.env*` except `.env.example`, `node_modules`, logs, and local attachment material.

## Commands and checks

```powershell
npm install
npm test
npm run load
npm start
```

`GET /health` returns readiness. In non-production it also exposes local process/room diagnostics; production health output is minimal. The home screen is `/`, the host console is `/host`, and audience pages use `/join/{six-digit-code}`. Rooms and their connections live in server memory, close when the operator ends the session, and expire after 12 hours. They are removed when the process exits. Operator tokens are bearer credentials scoped to their room.

## Safety and capabilities

- A photosensitivity notice and explicit consent checkbox precede participation. Each guest chooses torch or screen output in Settings, and the controller can force screen output for everyone. Screen effects use the controller's primary/accent colors; the torch stays white.
- Each show must complete the controller-started repeating beep/flash sync test before it can start. Guests enter the six-digit code, accept the notice, choose torch or screen output, adjust their local offset, and confirm before becoming joined participants. The test completes when all current waiters confirm, or the controller can finish it manually. Late arrivals use another controller-started sync test.
- The controller can split the audience into two to six anonymous sections before anyone joins. Guests choose a section during sync; cue sheets can target a section or everyone. LightSync stores no participant names or section answers beyond the active room.
- A local track can be decoded in the controller browser. Audio transients become editable discrete beat keyframes. Each beat can have its own effect and screen color; the room receives compact timing and style maps rather than a continuous BPM pulse. Track audio and metadata stay on that device. Per-device flash safeguards still apply, so rapid beats can be skipped. Saved light scores are stored in that browser and do not include audio files.
- New rooms start with enhanced accessibility protection on. It caps each flashing pattern at 1.5 device-light pulses per second, accounting for multi-pulse patterns. Disabling it requires the controller to acknowledge the warning shown in the console.
- A fixed safeguard remains active in either mode: at most three torch on-edges in any rolling second, with a minimum 333 ms gap. It cannot be disabled from the controller.
- The physical torch is binary and cannot be dimmed or colored by the browser. Guests choose Screen or Torch in Settings; the controller can force all guests to screens. The controller's primary/accent palette colors screen effects. The torch track is never displayed or recorded, and the application does not capture or store audience video.
- Pause, stop, blackout, leaving, backgrounding, disconnect, and room end request torch off. Guests also have a local off control.
- There is no audience identity, microphone request, audio upload, analytics, or tracking. Room state is ephemeral.

These safeguards are engineering controls, not a medical guarantee. Torch hardware, browser scheduling, and individual sensitivity vary. See [docs/SAFETY.md](docs/SAFETY.md) for the controller warning and limits.

## Architecture and limitations

Fastify serves the home, operator, and audience clients and validates room operations. A `ws` channel carries room presence, sync tests, clock samples, and authoritative state changes. Snapshots carry monotonic sequence numbers; room-scoped command IDs prevent replay across reconnects, and presence fan-out is coalesced. WebSocket upgrades enforce the configured origin and connection/message limits. Signed HMAC tokens bind operators to a six-digit room and room instance. The same torch effect sampler and device-side governor are in `src/safety.js` and loaded by the audience browser.

Active room state is intentionally ephemeral; saved show setup and account sessions use PostgreSQL when `DATABASE_URL` is configured. Saved setup contains show names, effects, colors, audience sections, and cue data, but not the controller's audio file. LightSync does not record or retain audience video. Audio analysis and controller playback are local to the browser; there is no audio upload, external-DJ microphone tracking, multi-operator sharing, OSC/WebMIDI, Docker, or TLS termination. Put the app behind an HTTPS reverse proxy for an event. `PUBLIC_BASE_URL` must match the external origin so QR codes work on guest phones.

The operator’s RTT and browser-to-room clock alignment use recurring low-latency samples; the monotonic offset may be large because the browser and server timers start at different origins. These estimates do not certify device synchronization. `npm run load` exercises local WebSocket joins and state/blackout fan-out; use `LOAD_CLIENTS=1000 npm run load` for the stretch scenario. This is not a venue-network or production capacity guarantee; see [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md). Physical phone torch compatibility has not been tested here.

## Real-device verification boundary

The user reports that torch control works in their environment; this revision has not been independently verified on physical phones. Verify on supported Android Chrome HTTPS: consent and join, effects, audience torch activation, controller protection warning, pause, stop, blackout, leaving, permission denial, and browser background/resume. Verify unsupported device behavior too. The controller preview is a simulation, not proof of physical device output.

## Engineering reference

Design research for the supplied Crowd Light Show app and archive is in [docs/REFERENCE_RESEARCH.md](docs/REFERENCE_RESEARCH.md). LightSync's code and visual identity were independently written; no source code or assets were copied.
