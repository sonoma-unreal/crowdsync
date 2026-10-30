# Troubleshooting

## `npm start` fails

- Check `node --version` is 20 or newer and run `npm install` in the project directory.
- If the port is occupied, change `PORT` in `.env` or the current PowerShell session.
- In production, a missing/short `SESSION_SECRET` or non-HTTPS `PUBLIC_BASE_URL` intentionally prevents startup. Generate a fresh secret as shown in the README and set the public HTTPS origin.
- `MAX_ROOMS` must be 1–1000 and `MAX_AUDIENCE_PER_ROOM` must be 1–10000.
- `MAX_WEBSOCKET_CONNECTIONS` must be 1–20000. `SHOW_CONTROL_LEASE_MS` must be 1–120000; if controller heartbeats stop for this duration during a running show, the server pauses output.

## QR points to the wrong address

Set `PUBLIC_BASE_URL` to the exact origin audience phones can reach before starting the server and before creating a room. For a LAN test, use the host computer's private Wi-Fi address and allow the chosen port through the local firewall. For an event, use the HTTPS reverse-proxy origin and forward WebSocket upgrades.

## Phones cannot connect

Confirm the audience URL opens in the phone browser, the room has not expired, and the proxy/firewall permits WebSocket connections. A room disappears on server restart, so create a new show and QR after restarting CrowdSync.

## Operator room is unavailable

The operator tab can restore its session metadata, but rooms themselves live only in server memory. If CrowdSync was restarted or the room expired, reconnecting cannot restore that room; the desk marks it unavailable and offers **Start a new show**. Create a new room and share its new QR/code. For a temporary network drop while the server still has the room, the desk retries automatically.

## Ngrok WebSocket requests return 403

The browser's `Origin` must exactly equal the configured `PUBLIC_BASE_URL` origin. If the page is opened through an HTTPS tunnel while `.env` still says `http://localhost:3000`, the HTTP page may load but the WebSocket upgrade is rejected by design. Set `PUBLIC_BASE_URL` to the exact current HTTPS origin shown by the tunnel before starting CrowdSync. In PowerShell, set `$env:PUBLIC_BASE_URL='https://<current-tunnel-host>'` before `npm start`. Tunnel hostnames can change between sessions. Restarting CrowdSync discards in-memory rooms; after restart, create a new show and QR code.

## Torch control is unavailable

Physical torch requires a browser/device that exposes the camera torch constraint and normally requires HTTPS (except localhost). Choose Torch flash in Settings and accept the browser permission prompt. If permission is denied or the capability is missing, CrowdSync can switch to screen output. Screen mode needs no camera permission and uses the controller's chosen colors; screen effects follow the same update ceiling.

