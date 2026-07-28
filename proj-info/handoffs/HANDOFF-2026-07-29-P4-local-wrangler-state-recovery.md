# HANDOFF-2026-07-29 — P4 local Wrangler state recovery

## Symptom

A browser run showed multi-second delays before gameplay began:

- session issue: about 3.8 seconds;
- room create/view/ready: about 3.8–8.7 seconds;
- start: `503 authority_unavailable` after about 5.4 seconds.

Because session issuance does not involve Room, Authority game state, or
normal-vNext, this was not a bot or table lifecycle regression.

## Recovery performed with user approval

1. Ran `npm.cmd run p4:stop` and verified ports 5173 and 8788 were free.
2. Moved the local-only `backend/.wrangler/state` (214 files, about 58 MB) to
   the ignored recoverable backup:
   `temp/p4-wrangler-state-backup-20260729-010856`.
3. Started a new `npm.cmd run p4:dev` environment.

The backup contains only local test Durable Object SQLite state, such as
anonymous sessions and rooms; it is not source code and is not committed.

## Fresh-state smoke evidence

- session: 201 in 990 ms;
- room create: 201 in 355 ms;
- ready: 200 in 361 ms;
- start: 200 in 603 ms;
- authenticated personal `game-view`: 200 in 209 ms with the viewer's 27-card
  hand.

The fresh environment remains running for browser acceptance.  If this symptom
recurs, stop the local environment first and preserve/move the state directory
before deleting it so the state can be investigated.

## Follow-up: 2026-07-29 local busy-loop diagnosis

The slow/disconnected symptom recurred after an earlier recovery.  It was
reproduced even for `GET /health`, so it was not caused by Room, Authority,
bot strategy, or the frontend click path.

Evidence from the affected local runtime:

- the non-listening Wrangler runtime consumed about 4.0 CPU seconds during a
  five-second idle sample;
- `GET /health` took about 10.7 seconds;
- after stopping the runtime and moving its state to the ignored recoverable
  backup `temp/p4-wrangler-state-backup-20260729-015113`, a fresh state had
  zero CPU growth across a three-second idle sample and `/health` returned in
  67 ms.

The recovery command is now responsible for terminating both recorded process
trees and port listeners, and it verifies that ports 5173 and 8788 are free.
It treats an already-exited recorded PID as a harmless race, but reports a
real `taskkill` failure.  The multiplayer lobby also disables a create/join/
ready/start operation while its prior HTTP operation is pending, preventing a
slow local backend from generating a second anonymous session or room.

Fresh P4 smoke after this second recovery:

- session: 201 in 1012 ms;
- room create: 201 in 618 ms;
- ready: 200 in 375 ms;
- start: 200 in 711 ms;
- personal `game-view`: 200 in 509 ms.

For a clean manual run, use `npm.cmd run p4:stop`, then `npm.cmd run p4:dev`
from the repository root.  Do not separately run `wrangler dev` or `vite`;
doing so can leave an independent `workerd` tree and reintroduce SQLite/state
contention.  If the idle CPU or `/health` delay recurs, stop first and archive
the local-only state again before investigating it.

## Follow-up: bot alarm lifecycle diagnosis

A local one-human/three-bot game showed that a bot could remain pending far
past its normal 0.8--1.34 second think delay. The persisted `bot_tasks` row
was overdue, while the Room Durable Object's next alarm had been replaced by
the 30-second human heartbeat.

Two scheduling defects were corrected:

1. `DurableObjectStorage.setAlarm()` is asynchronous. The Room now awaits it;
   a detached call can be cancelled by Miniflare when its request finishes.
2. When `Room.alarm()` retries a transient Authority failure, scheduling now
   preserves the current persisted bot task even when a `TurnStatus` is not
   available. The retry is bounded to one second, preventing a zero-delay
   alarm spin loop while ensuring it cannot degrade to the human heartbeat.

`backend/test/p4-01-single-human-bot-lifecycle.local.test.mjs` contains a
production-timer regression test: an opening bot task must advance the
authority event sequence without another HTTP request waking the room. It
passed together with backend typecheck on 2026-07-29.

## Follow-up: local Wrangler 4.114.0 recovery

Wrangler 4.113.0 continued to exhibit an unhealthy local runtime after active
websocket/alarm traffic: `POST /ready` took 11.8 seconds, room projection reads
took 15--19 seconds, and the logs contained `SQLite alarm overdue`. Requests
were accepted (200/201), but queued long enough to appear unresponsive.

With user approval, the workspace Wrangler dependency was upgraded to 4.114.0
and the previous local-only state was moved to the recoverable ignored backup
`temp/p4-wrangler-state-backup-20260729-0245`.

Fresh browser verification with the upgraded runtime:

- health: 92 ms client-side (8 ms in Worker log);
- room creation: 644 ms;
- ready: 264 ms;
- start: 1.086 s;
- subsequent personal projections: 39--143 ms.

`tools/start-p3-local.ps1` now writes backend stdout/stderr to ignored
`temp/p4-backend-dev.log` and `temp/p4-backend-dev.err.log`, so future local
request status and timing can be inspected without relying on a hidden process
console.

### Rollback of 4.114.0

The 4.114.0 performance smoke was successful, but a later real browser
`POST /start` caused Wrangler's own ProxyWorker to terminate. The client
received non-JSON text (`Error: internal error...`) and disconnected; Wrangler
recorded only an internal reference rather than a project stack trace. The
registry offered no later patch release, so the dependency was returned to
4.113.0. Do not use 4.114.0 for this local Durable Object workflow until a
Wrangler release fixes that ProxyWorker crash.

## Follow-up: shared table desktop spacing

The shared table CSS was adjusted from the P4 multiplayer screenshot without
changing table data, rules, or multiplayer callbacks:

- desktop table height increased to reserve a larger human-hand lower half;
- top public actions move upward and pass text cannot wrap vertically;
- centre status moves below the top public-action area;
- east/west public actions appear inside the table, beside their card-count
  badges rather than beneath them;
- the human hand, identity and count move down below the controls, while the
  hand-help copy aligns to the hand-area left edge.

The responsive grid explicitly returns side public actions to normal flow at
720px and below.

### Follow-up: annotated desktop spacing refinement

The next annotated desktop review identified two remaining alignment issues.
The shared CSS now aligns the public pass word to the top edge of the
equivalent public-card area, rather than to its bottom edge. The human hand
area is lowered independently of the action controls; the controls move down
slightly and the hand, player identity and count move further down. The hand
arrangement help now uses the same centred maximum width as the hand area, so
its left edge tracks the hand instead of the full table edge. This remains a
desktop-only presentation adjustment and does not change game state,
multiplayer callbacks, bot scheduling or responsive behaviour.
