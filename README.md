# CrowdSync

CrowdSync is an independently implemented, self-hostable synchronized audience light show. The home screen separates hosting from joining. A controller creates a room and shares its six-digit code, join URL, or QR code; guests complete a controller-started sync test before joining. The controller can run one of 17 synchronized patterns or build a timed, beat-aligned light score from a local audio file. Guests can use their torch or screen.

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

`npm start` reads `.env` automatically. Production deployments must set `NODE_ENV=production`, configure a unique random `SESSION_SECRET` of at least 32 characters, and set an HTTPS `PUBLIC_BASE_URL`. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. Terminate TLS at a trusted HTTPS reverse proxy and forward WebSocket upgrades to CrowdSync. Do not expose the operator link publicly. The service binds to loopback by default.

Supported environment controls are `HOST`, `PORT`, `PUBLIC_BASE_URL`, `SESSION_SECRET`, `LOG_LEVEL`, `MAX_ROOMS` (default 100; maximum 1000), `MAX_AUDIENCE_PER_ROOM` (default 2000; maximum 10000), `MAX_WEBSOCKET_CONNECTIONS` (default 5000; maximum 20000), and `SHOW_CONTROL_LEASE_MS` (default 30000; maximum 120000). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md), [docs/SAFETY.md](docs/SAFETY.md), and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Deploying on Render

CrowdSync is a Node web service, not a static site: its Fastify process serves the browser app and handles the `/ws` WebSocket endpoint. The repository includes [`render.yaml`](render.yaml) for a Render Blueprint deployment. Push the repository to GitHub, choose **New → Blueprint** in Render, and connect the repository containing `render.yaml`. The Blueprint configures `npm ci`, `npm start`, `/health`, the public Render URL, a generated signing secret, and the public network bind address.

The Blueprint uses Render's Free web service. It is suitable for demos and development, not a show that needs guaranteed availability. Free services can sleep after idle periods and cold-start on the next request; CrowdSync keeps rooms only in process memory, so sleeping, restarts, and deploys discard active rooms. Create a new room after a restart and test the public HTTPS page and WebSocket before inviting guests. See [Render's free-service limits](https://render.com/docs/free) and [WebSocket guidance](https://render.com/docs/websocket).

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
- The controller can split the audience into two to six anonymous sections before anyone joins. Guests choose a section during sync; cue sheets can target a section or everyone. CrowdSync stores no participant names or section answers beyond the active room.
- A local track can be decoded in the controller browser. Audio transients become editable discrete beat keyframes. Each beat can have its own effect and screen color; the room receives compact timing and style maps rather than a continuous BPM pulse. Track audio and metadata stay on that device. Per-device flash safeguards still apply, so rapid beats can be skipped. Saved light scores are stored in that browser and do not include audio files.
- New rooms start with enhanced accessibility protection on. It caps each flashing pattern at 1.5 device-light pulses per second, accounting for multi-pulse patterns. Disabling it requires the controller to acknowledge the warning shown in the console.
- A fixed safeguard remains active in either mode: at most three torch on-edges in any rolling second, with a minimum 333 ms gap. It cannot be disabled from the controller.
- The physical torch is binary and cannot be dimmed or colored by the browser. Guests choose Screen or Torch in Settings; the controller can force all guests to screens. The controller's primary/accent palette colors screen effects. The torch track is never displayed or recorded, and the application does not capture or store audience video.
- Pause, stop, blackout, leaving, backgrounding, disconnect, and room end request torch off. Guests also have a local off control.
- There is no audience identity, microphone request, audio upload, analytics, or tracking. Room state is ephemeral.

These safeguards are engineering controls, not a medical guarantee. Torch hardware, browser scheduling, and individual sensitivity vary. See [docs/SAFETY.md](docs/SAFETY.md) for the controller warning and limits.

## Architecture and limitations

Fastify serves the home, operator, and audience clients and validates room operations. A `ws` channel carries room presence, sync tests, clock samples, and authoritative state changes. Snapshots carry monotonic sequence numbers; room-scoped command IDs prevent replay across reconnects, and presence fan-out is coalesced. WebSocket upgrades enforce the configured origin and connection/message limits. Signed HMAC tokens bind operators to a six-digit room and room instance. The same torch effect sampler and device-side governor are in `src/safety.js` and loaded by the audience browser.

Room state is intentionally ephemeral; there is no SQLite persistence or room recovery. CrowdSync does not record or retain audience video. Audio analysis and controller playback are local to the browser; there is no audio upload, external-DJ microphone tracking, user login, multi-operator sharing, OSC/WebMIDI, Docker, or TLS termination. Put the app behind an HTTPS reverse proxy for an event. `PUBLIC_BASE_URL` must match the external origin so QR codes work on guest phones.

The operator’s RTT and browser-to-room clock alignment use recurring low-latency samples; the monotonic offset may be large because the browser and server timers start at different origins. These estimates do not certify device synchronization. `npm run load` exercises local WebSocket joins and state/blackout fan-out; use `LOAD_CLIENTS=1000 npm run load` for the stretch scenario. This is not a venue-network or production capacity guarantee; see [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md). Physical phone torch compatibility has not been tested here.

## Real-device verification boundary

The user reports that torch control works in their environment; this revision has not been independently verified on physical phones. Verify on supported Android Chrome HTTPS: consent and join, effects, audience torch activation, controller protection warning, pause, stop, blackout, leaving, permission denial, and browser background/resume. Verify unsupported device behavior too. The controller preview is a simulation, not proof of physical device output.

## Engineering reference

Design research for the supplied Crowd Light Show app and archive is in [docs/REFERENCE_RESEARCH.md](docs/REFERENCE_RESEARCH.md). CrowdSync's code and visual identity were independently written; no source code or assets were copied.
