# HANDOFF-2026-07-29 — P4 multiplayer round lifecycle follow-up

## Implemented

- `Room.reconcile()` now enters the existing Authority `next-round` path when a
  bot completes a round.  Previously that post-bot branch only scheduled an
  inert reconciliation against a completed game, leaving the completed table
  on screen.
- Host restart commands retry once only after an explicit
  `event_sequence_conflict`: the client refreshes its own authority projection
  and submits a new command with the latest sequence.  Other errors remain
  visible to the user.
- The shared table layout reserves separate vertical zones: top-seat public
  actions, central status, bottom-seat public actions, action controls, and
  the human hand.  This gives the human half of the table the extra space that
  its hand requires.
- `p4:stop` no longer reads `Win32_Process` through WMI.  It uses only the
  fixed local development port owners (5173 and 8788) and `taskkill /T`; this
  works in a normal Windows user session where WMI process inspection is
  denied.  A permissions error is reported rather than treated as success.

## Explicit non-changes

- `guandan-core` and its `normal-vNext` policy were not changed.  Multiplayer
  bots continue to call the same core `chooseTableBotAction` strategy used by
  the Authority, with no client-side bot scheduler.
- A connected human still has no move timeout.  Bot thinking remains a
  separate short Authority task created immediately after the preceding
  authority action.

## Verification

- `frontend`: `format:check`, `typecheck`, `lint`, `test:run` (55 tests), and
  production `build` passed.  The restricted tool environment required an
  elevated build only to write Vite's ignored `.vite-temp` configuration file.
- `backend`: `typecheck` and `test:p4-01` (4 tests) passed.  The first P4-01
  attempt hit a transient local Miniflare `bad port`; an immediate rerun passed
  all four tests.
- `git diff --check` must still be run immediately before commit.

## Required manual acceptance

1. Run `npm.cmd run p4:dev` from the repository root, then open the printed
   Vite URL.
2. Complete a one-human/three-bot round where a bot is the last finisher; the
   next round must be dealt automatically in the same room.
3. Confirm host `重开本局` and `重新开赛` work while bots are advancing the
   event sequence.
4. Confirm the top play, centre status, bottom public action, controls, and
   human hand do not overlap at desktop width.
5. Stop the foreground `p4:dev` terminal with Ctrl+C.  If it was forcibly
   closed, run `npm.cmd run p4:stop` in another terminal.
