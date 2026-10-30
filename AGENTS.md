# CrowdSync project notes

- Node 20+, ES modules, Fastify HTTP, `ws` realtime transport, QRCode data URLs, vanilla browser clients.
- Keep room-scoped authorization enforced on the server. Never treat a room id as an operator credential.
- Keep emergency output shutdown authoritative and make audience clients stop torch tracks on room state changes and local opt-out.
- Preserve the conservative effect bounds in `src/safety.js` and mirror any new output rules in `public/audience.js`.
- Run `npm test` after changing server behavior, synchronization, authorization, torch, or safety logic.
- Rooms are in-memory and ephemeral in this version. Do not document persistence or real-device validation unless implemented and tested.
