# HANDOFF-2026-07-29 — P4 Durable Object alarm race follow-up

## Evidence

The local one-human/three-bot browser run produced multiple blocked personal
projection reads (3–10 seconds and one 335-second read), followed by:

`SQLite alarm handler canceled with requestScheduledAlarm`

The same run showed a first restart request waiting several seconds before an
event-sequence conflict and a retry.  This identifies actor/request contention,
not a 0.8–1.34 second normal bot-think delay, as the cause of the apparent bot
long-think reports.

## Fix

- Removed the successful-human-action combination of background
  `waitUntil(reconcile)` and a competing direct `setAlarm`.  The Room now
  synchronously records the future bot task after Authority accepts the human
  action; the single persisted Durable Object alarm executes that task.
- Added the elapsed time of `chooseTableBotAction` to the private Room
  `bot.dispatch.executed` diagnostic.  This is diagnostic metadata only; no
  hand, seed, or strategy evaluation is exposed to clients.
- Rebalanced desktop table zones: central status is raised while the bottom
  public action, controls, and human hand move down together.

## Verification

- `backend`: Prettier, `typecheck`, `test:p4-01` (4), and `test:p3-08` (4)
  passed.
- `frontend`: Prettier check, typecheck, lint, full `test:run` (55), and
  production build passed.
- Browser validation remains required.  Check that bot tasks complete after
  their normal short delay and that `game-view` calls no longer queue for
  multi-second intervals.  If a long wait persists, collect the matching Room
  diagnostic entry and inspect `decisionDurationMs` before changing strategy.
