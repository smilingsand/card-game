# P4 handoff — local runtime recovery and shared table layout

## Scope and current branch

- Branch: `codex/p3-11-singleplayer-table-modularization`
- Latest expected commit after this handoff: `P4 - recover local runtime errors`
- P4 is still in progress. Do not mark multiplayer as accepted without the
  deferred browser manual validation.

## Completed in this session

1. Refined the shared desktop table spacing in commit `e143877`:
   public pass text aligns with public-card top edges; human controls and hand
   regions are separated and lowered; hand-help aligns to the hand region.
2. Diagnosed the local multiplayer lobby/start failure. It was not a room,
   action, WebSocket, Authority, bot, or table-rendering defect. A stale local
   Durable Object SQLite/WAL state caused Miniflare request stalls and 503s.
3. Archived (not deleted) that state at
   `temp/p4-wrangler-state-backup-20260729-0413` after stopping all P4
   processes. The normal development state was then recreated from scratch.
4. Hardened `frontend/src/multiplayer/client.ts`: non-JSON HTTP failures now
   become bounded, readable errors such as `http_503: Your worker ...`, rather
   than a misleading JSON parser `Unexpected token` exception.

## Runtime evidence

With the old state, logs showed:

- `POST /v1/session` 7.5--9.1 seconds;
- `POST /v1/rooms` 503 after 8.8--10.8 seconds;
- `/health` 22.294 seconds.

With fresh state, the same code and Wrangler 4.113.0 produced:

- `/health` 200 in 69 ms in the isolated probe;
- standard P4 start `/health` 200 in 367 ms;
- room creation 201 in 607 ms.

The local `InspectorProxyWorker` remains visible in Wrangler debug logs, but
it was not sufficient to explain the failure: an isolated fresh state was
healthy with the same runtime. Do not re-upgrade to Wrangler 4.114.0: that
version previously crashed its ProxyWorker during real `/start` traffic.

## Local operation

From repository root:

```powershell
npm.cmd run p4:dev
```

Then browse `http://127.0.0.1:5173`. The script owns both process trees.
Use `Ctrl+C` in its foreground terminal for normal shutdown; if that terminal
was forcibly closed, use `npm.cmd run p4:stop` from another terminal.

Runtime logs are ignored files:

- `temp/p4-backend-dev.log`
- `temp/p4-backend-dev.err.log`

If lobby/session/room actions again take more than a few seconds, first stop
P4 and inspect those logs. Preserve the current `backend/.wrangler/state` by
moving it to a timestamped `temp/p4-wrangler-state-backup-*` directory before
creating fresh state; do not delete state blindly.

## Deferred manual validation

The user will not test further today. The next session should first verify:

1. Enter multiplayer: no transient reconnect/error notice after fresh start.
2. Create room, prepare, and start: each completes promptly and reaches the
   table; no non-JSON parser error.
3. The six annotated desktop table layout requirements from the latest
   screenshot, especially pass/card top alignment and human hand/help
   placement.
4. Existing P4 action lifecycle scenarios after a fresh room is created.

Do not restore the archived state during validation. If the healthy fresh
runtime later stalls, capture the relevant `p4-backend-dev.log` timing lines,
room ID, and first failing request before changing backend logic.
