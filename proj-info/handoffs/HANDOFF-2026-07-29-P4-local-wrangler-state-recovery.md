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
