# Build log

## 2026-10-30 — Discrete detected-beat keyframes

- Replaced the generated music score's 16-beat continuous-BPM looks with individual transient-aligned beat keyframes. The beat timeline is compactly delta-encoded so a ten-minute score fits within the existing WebSocket message limit.
- Audience and preview render one light hit at each beat keyframe, alternate the selected screen colors per hit, and retain their existing local flash governors. Faster beats can be skipped by those device safeguards.

## 2026-10-30 — Reconnect loop and clock sample validation

- Removed an invalid comparison between the browser and server `performance.now()` clocks. Clock samples now validate the client timestamp's type and range without assuming both processes share a monotonic clock origin.
- Keep operator reconnect backoff escalating until the connection remains authenticated for 15 seconds, and log close codes/reasons so short-lived failures are diagnosable. Regression coverage now uses a client timestamp far from the server process clock.

## 2026-10-30 — Effect transitions and visualizer removal

- Fixed changing from Solid light to a pulsing effect: Solid uses a zero pulse rate, which is now accepted as an effect-transition input and normalized to the destination effect's safe minimum. The controller also falls back to its visible rate setting when the current effect has no pulse rate.
- Removed Spectrum visualizer from the live effect catalog, audience output, and current feature count. The earlier entry below records the historical addition.

## 2026-10-29 — Original Show desk and local cue designer

- Used the supplied Wildlights pages and screenshots as a product-workflow reference, then built an independent CrowdSync Show desk with a 96-phone simulated preview, a manual cue sheet, optional anonymous audience sections, and local saved light scores.
- Added browser-local audio decode, a heuristic tempo estimate and coarse loudness analysis, and beat-aligned cue generation capped at 24 cues and ten minutes. The audio file stays in the controller browser; the room receives only validated cue timing, effect, colors and optional section targets. Local audio playback schedules against the shared room clock.
- Audience clients resolve cues from the synchronized room state without per-frame network updates. The server validates plans and groups, applies current safety bounds, and automatically turns output off at score end. Existing torch limits remain authoritative and are also applied by the audience client.
- Included command name and sequence in rate-limit errors so the operator can identify the rejected action and roll back an optimistic cue-sheet update.
- Fixed stale cue-target selectors: when section names change, the operator rebuilds cue controls so new targets are immediately available.
- Updated feature, architecture, safety, reference and privacy documentation. Existing `npm test` run after the server and audience changes passed 19 tests; JavaScript syntax checks passed. No rendered browser QA, external-network trial, or physical-device verification was performed for this feature pass.

## 2026-10-28

- Workspace was empty apart from Git metadata; created a new independent CrowdSync project.
- Inspected the named source repository at commit `7855e8227b43276f6f8c1f0d3412250b001de951`; details and verified/incomplete inventory are in `REFERENCE_RESEARCH.md`.
- Also inspected the supplied `crowd-light-show-0_10_0.zip` in place. It is package version 0.10.0 with no Git SHA; its SHA-256 and additional findings are recorded in `REFERENCE_RESEARCH.md`. The archive was read-only reference material, not a source overlay or instruction file.
- Chose ephemeral in-memory room state for a reliable small deployable core. Operator credentials are HMAC-signed, room-bound bearer tokens. Production startup rejects a missing/weak secret.
- Implemented room/QR creation, room-local WebSocket presence and control, clock-offset sampling, client-side effect rendering, consent, optional explicit physical torch, safety clamps, blackout/stop, reconnect state delivery, and operator controls.
- Verification: `npm test` passes (7 tests) and `npm audit --omit=dev` reports zero vulnerabilities. Syntax checks pass for server, auth, safety, and browser scripts. Integration exercises health, operator/audience pages, favicon, two isolated rooms, QR/join URL generation, auth/config rejection, WebSocket clock samples, live state, late join, reconnect, message, blackout, stop, room close, and surviving second room. Browser verification in the local in-app browser created a room, rendered the QR/join link, passed consent, joined as an audience client, started, paused, resumed, delivered a crowd message, and observed synchronized status. The browser automation stalled opening the page's JavaScript blackout confirmation; the WebSocket integration blackout test passes. No physical camera or torch permission was requested.
- A first integration run found the emergency blackout command could be dropped by the ordinary 45 ms command coalescing. Stop/blackout now bypass that throttle; regression is covered by integration.
- During the first local browser run on port 3000, request logs included an existing `ngrok-free.dev` Host value. No tunnel was started or configured by this work; the CrowdSync process on port 3000 was stopped after noticing the forwarded requests. The later browser run used loopback port 3012. No CrowdSync server process remains running.
- Limits: audio, durable storage, advanced VJ integrations, container packaging, external HTTPS, and physical torch/device verification are not included.

## 2026-10-28 — Torch-only controller and patterns

- Replaced screen-color effects and controls with torch-only output; audience screens stay dark, and device torch permission remains an explicit local action.
- Added 15 synchronized torch patterns, a shared time-based sampler, and a browser-side governor. New rooms enable enhanced accessibility protection by default (up to 1.5 flashes/s); the controller must acknowledge a warning to turn it off. The hard 3-flash/s rolling-second cap remains in both modes.
- Added torch simulation preview, effect grid, rate control, local torch off handling, capability/permission messaging, and dark audience UI. Torch hardware remains binary; no dimming claim is made.
- Updated safety and architecture documentation and migrated the existing safety unit tests to the torch sampler/governor API. The supplied screenshots informed the control layout and effect selection; no branding or source code was copied.
- Validation status for this change: tests were not run in this pass; no real-device verification was performed. The user reports torch works in their environment.
- Added an audience screen-light fallback for missing torch capability, unavailable camera APIs, or denied torch permission. Screen output is a synchronized full-page white pulse and passes through the same device-side rate governor. Guests can also choose it directly in sync without requesting camera access.
- Moved audience FanCam enrollment and output selection to a new Settings tab; invitations remain explicit modal choices. Refined mobile spacing, tab navigation, screen fallback contrast, accessibility copy, and operator labels.
- Follow-up bug audit found the old unsupported-torch path prevented those phones from confirming sync at all; the fallback now unlocks sync confirmation. Verified the local controller/join flow through consent, sync, screen selection, confirmation, and Settings using an isolated temporary room. Existing 14-test suite and JavaScript syntax checks pass. Physical iPhone/Safari torch fallback still needs real-device verification.
- Fixed a FanCam UI race: the direct invitation message was immediately followed by a room-state broadcast, and rendering that unrelated state cleared the invitation because the guest still held the previous enrollment snapshot. Invitation state now persists across show updates, accepted invites use the extended expiry, and explicit decline/finish/expiry clears it. Removed legacy fixed positioning that made the FanCam settings card overlap the output settings; added compact Lucide-style inline SVG icons and shorter labels. Browser smoke test verified invitation display, acceptance, recording controls, and persistence across a later show-state update.
- Added a host/join home screen, six-digit join codes, and a required sync lifecycle. Waiting guests do not count as joined until confirming the active controller test; the sync ends when all current waiters confirm or when the controller ends it. The server blocks show start until sync is finished and the waiting set is empty. The sync pulse is one per second and remains subject to the phone-side governor. Blackout/stop cancel an active sync test.
- Updated the integration coverage source for the six-digit code, waiting membership, sync start/confirmation/finish, and show-start gating. Tests were not run in this pass.

## 2026-10-28 — Color screens, visualizer, and mobile settings

- Added Solid light (continuous while the cue is active), Rapid sparkles, and Spectrum visualizer to the synchronized effect set. Spectrum renders segmented colored bars on screen devices and a governed pulse pattern on torches.
- Added guest Settings switches for Screen and Torch flash. Added a controller override that forces all connected and waiting guests to screen output, with primary and accent color controls. The controller preview reflects the selected output and palette.
- Tightened the audience layout for narrow and short viewports: settings stay within the space above the fixed show controls, cards scroll when needed, and labels and controls wrap or compact on small screens.
- Fixed FanCam expiry recovery: expired invitations use a short retry cooldown, server state refreshes on expiry and cooldown completion, and each room coalesces FanCam transition refreshes into one timer.
- Kept sparkles' screen-color alternation within the selected effect cycle and made every cue wait until its synchronized start timestamp before illuminating. This prevents extra unsynchronized color changes and early light during the controller's start lead-in.
- Updated feature, safety, troubleshooting, and usage documentation. `npm test` passes (14 tests); syntax checks pass for the audience, operator, and server scripts. Physical-device verification was not run in this pass.
- Removed the optional FanCam feature after a privacy review. Audience and controller recording/review UI, WebSocket and HTTP routes, token flows, server pool and media storage, configuration variables, styles, and feature-specific tests were deleted. The default `data/fancam` directory was empty when checked and has been removed. Earlier FanCam entries above are retained as project history. `npm test` passes (8 tests), including checks for absent camera UI, routes, and participant tokens; syntax checks pass for the changed scripts.

- Added per-beat effect/color styles with a node-flow editor and virtualized keyframe list. Clock alignment now uses recurring low-latency samples and explains its browser-to-room monotonic offset. WebSocket payload bound raised to 8 KiB for validated bounded beat-style data.
