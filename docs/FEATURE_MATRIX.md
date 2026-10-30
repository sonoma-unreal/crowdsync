# Feature and verification matrix

| Capability | State | Evidence / boundary |
|---|---|---|
| Operator room creation and private room token | Implemented | Existing HTTP integration coverage |
| Join URL and QR generation | Implemented | Existing integration checks URL and PNG data URL |
| Home screen host/join paths and six-digit code | Implemented | Room code is also used in QR and join URL |
| Controller-started sync test | Implemented | Repeating beep/pulse; waiting guests adjust offset and confirm before joining |
| Audience consent and output selection | Implemented | Guests choose screen or torch in Settings; unavailable/denied torch can fall back to screen |
| Participant Settings tab | Implemented | Screen/Torch selection stays in settings |
| WebSocket room presence and synchronized clock | Implemented | Integration source covers challenge, confirmation, presence, and clock samples |
| 18 synchronized light patterns | Implemented | Includes steady solid light, rapid crowd sparkles, and a segmented screen visualizer; screen colors are controller-configurable |
| Controller screen override | Implemented | A room-wide switch forces screen output and the primary/accent palette on every guest device |
| Simulated crowd preview | Implemented | 96 locally simulated audience lights use the shared effect sampler and safety governor; preview is visual only |
| Manual timed light score | Implemented | Add, reorder and remove bounded cues, optionally targeting anonymous audience sections |
| Local music cue designer | Implemented | Controller browser decodes a local track, estimates tempo/loudness, and generates up to 24 beat-aligned cues for a score of up to 10 minutes |
| Local track playback | Implemented | Audio stays on the controller device and is scheduled against the room clock; no upload or server-side audio analysis |
| Saved light scores | Implemented | Up to 20 cue sheets saved in that controller browser's local storage; audio files are not saved |
| Anonymous audience sections | Implemented | Configure 2–6 sections before guests join; guests choose during sync and cues may target a section |
| Enhanced accessibility protection | Implemented | Defaults on; 1.5 flash/s cap; disabling requires controller acknowledgment |
| Fixed device-light governor | Implemented | Rolling second cap of 3 on-edges and 333 ms minimum gap; not configurable |
| Audience local off and emergency blackout | Implemented | Local output shutdown, room blackout bypasses ordinary command throttle |
| Audience message | Implemented | Bounded plain text; message does not affect the torch |
| Physical torch | Implemented, user-reported working | Browser/device support varies; this revision not physically verified |
| Production desk diagnostics | Implemented | Live connection status, best RTT, clock offset estimate, snapshot sequence, participant count, and bounded tab-local activity feed |
| Snapshot sequencing and duplicate command handling | Implemented | Monotonic room sequence; room-scoped operator command IDs reject replay across reconnects |
| Presence broadcast coalescing | Implemented | Join/leave snapshots are coalesced for 50 ms |
| WebSocket origin and protocol checks | Implemented | Exact origin allowlist, 5-second auth deadline, strict command fields, text-only payloads, 4 KiB cap |
| Controller session expiry and revocation | Implemented | HMAC role/room/instance/expiry checks; room closure and expiry close existing sockets |
| Reconnect replay defense | Implemented | Monotonic room-scoped command IDs persist in the controller tab session |
| Controller show lease | Implemented | A 30-second heartbeat lease pauses running output after controller loss |
| Browser security headers | Implemented | CSP, framing, MIME, referrer, resource and permissions policies; production HSTS |
| WebSocket resource bounds | Implemented | 5,000 connections, 200 messages per 10 seconds per socket, 1 MiB queued-output cap, ping/pong cleanup |
| Capacity harness | Implemented | `npm run load`; localhost WebSocket burst, cue fan-out, and blackout fan-out |
| Audience video capture or retention | Not implemented | No recording, upload, media storage, or review feature |
| Room close and expiration | Implemented | Room credentials end on close or 12-hour expiration |
| Uploaded audio, server-side audio processing, durable room persistence, OSC/MIDI | Not implemented | Audio selection/playback and saved scores are browser-local; room state remains ephemeral |
| Production HTTPS deployment | Documented, not exercised | Requires reverse proxy and external configuration |
| Real-device accessibility and torch behavior | Not verified | Requires testing on supported phone/browser combinations |

## Capacity harness

Run `npm run load` for the 50, 100, 250, and 500 client scenarios. Use `LOAD_CLIENTS=1000 npm run load` for the stretch scenario. The harness reports successful concurrent connections, connection burst duration, cue and blackout fan-out latency percentiles, server RSS and CPU time, and event-loop delay. It uses loopback only and does not include TLS, reverse proxy, venue Wi-Fi, packet loss, phone browsers, sustained show traffic, or media uploads. These measurements are local process results, not a production capacity guarantee.

Measured 2026-10-29 in one run on the current development machine after Phase 3 changes:

| Clients | Connected | Join burst | Cue fan-out p95 | Blackout p95 | Server RSS | CPU, one-core equivalent |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 50/50 | 24.29 ms | 2.24 ms | 2.28 ms | 70.67 MiB | 59.64% |
| 100 | 100/100 | 41.17 ms | 3.55 ms | 3.63 ms | 74.60 MiB | 40.39% |
| 250 | 250/250 | 99.68 ms | 7.43 ms | 7.63 ms | 78.14 MiB | 51.76% |
| 500 | 500/500 | 175.34 ms | 11.02 ms | 11.38 ms | 83.69 MiB | 54.17% |
| 1,000 | 1,000/1,000 | 369.82 ms | 20.57 ms | 21.36 ms | 91.58 MiB | 74.97% |

These are single-run values and vary between runs. The client and server both ran on loopback; no external network, TLS proxy or mobile devices were involved. The measured CPU percentage is the child server's CPU time divided by wall time (100% means one fully used logical core). Event-loop maximum delay ranged from 32.34 to 41.65 ms in the 50–500 run and was 41.48 ms in the 1,000-client run. Passing this synthetic harness does not establish production or venue-network capacity.
