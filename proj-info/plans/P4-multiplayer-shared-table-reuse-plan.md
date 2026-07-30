# P4 multiplayer shared table reuse

## Goal

Replace duplicated multiplayer table presentation and interaction with the validated shared table contract, while preserving P3 room, WebSocket, Authority, reconnect, takeover, and personal-projection boundaries.

## Status

- **in progress**: `16a62e2` was merged as `b744f25 P4 - integrate P3 multiplayer baseline` after user approval. The active multiplayer table now renders through `MultiplayerTable` and `useMultiplayerTableAdapter` with the shared table contract.
- **P4 lifecycle diagnosis / phase 1 complete**: only local `P3_TEST_MODE` observability and a fixed-seed one-human/three-bot fixture were added. No scheduler, takeover, command, restart, or UI behavior has been changed yet.

## Audit findings

- `MultiplayerApp.tsx` currently renders textual seats and hand cards, and play always submits `game.hand[0]`.
- `seat-projection.ts` duplicates display-position mapping already supplied by `createDisplayPositions`.
- There is no current multiplayer projection for legal actions, public action history, highest play, hint, arrangement, or pending-command completion.

## Next step after approval

1. Preserve `LegacyGameView` until a separate proof-of-no-reference change is requested.
2. Complete automated frontend and P3 backend verification.
3. Pause for the required four-client manual acceptance.

## Progress log

- 2026-07-30: aligned the shared table presentation baseline. Solo now shows
  the human identity below the hand and no longer renders a separate bot
  thinking line; multiplayer side-seat public actions are offset inward so
  they do not crowd seat names or card counts.

- 2026-07-30: entering single-player from the home screen now always starts a
  new match and replaces any prior local save. Direct in-table resume behavior
  remains available for the single-player storage boundary.

- 2026-07-30: removed the south-seat assumption from authoritative tribute
  handling. The actual human seat now receives its own required tribute/return
  choices; replay records that seat so worker restoration preserves the same
  flow. Completed exchange summaries include the returned card, and double
  tribute resumes with the larger tribute giver as leader.

- 2026-07-30: after the final third pass clears an active trick, both the
  single-player table and multiplayer personal projections retain the public
  play plus all three pass markers for 900 ms before clearing the table and
  enabling the next leader. This is presentation-only: turn resolution,
  event persistence, Authority state, and bot scheduling remain unchanged.

- 2026-07-30: added a top-level home screen and explicit single/multiplayer
  exits. Multiplayer table exit is deliberately local presentation only: it
  returns to the room lobby and suppresses stale realtime projections until
  the player selects “继续游戏”, which reloads the same personal Authority
  projection. From the lobby, host exit invokes authoritative room closure;
  non-host exit releases only that subject's presence and socket. Room close
  broadcasts `roomClosed`, closes realtime sockets, cancels Room alarms/tasks,
  erases Room/Authority/Realtime local persistence, and returns all connected
  clients home. See ADR-0034 and the 2026-07-30 handoff.

- 2026-07-28: added `useMultiplayerTableAdapter` and `MultiplayerTable`; active rendering uses `TableView`, `SeatView`, `HandView`, `ActionControls`, and `PublicActions`.
- 2026-07-28: `seat-projection` now delegates to `createDisplayPositions`; targeted UI suite is 14/14 and adapter suite is 3/3.
- 2026-07-28: frontend format, lint, typecheck, build, and targeted suites pass. One full-suite run hit the pre-existing reconnect-test race (`connect` observed twice); an immediate isolated rerun passed 14/14. Backend typecheck plus P3-05, P3-06, and P3-08 all pass.
- 2026-07-28: one-human/three-bot diagnosis started without code changes. Confirmed: `Room.reconcile()` can execute multiple empty-seat bot commands in one reconciliation (`steps < SEATS.length`) with no think delay. The human action route forwards submitted card IDs unchanged to Authority; Authority uses `getSelectedPlayActions(...)[0]`, whose returned actions retain the submitted entity IDs. Remaining symptoms require per-command/turn-generation telemetry around Room reconciliation, presence takeover, and ACK completion before a root-cause claim.
- 2026-07-28: phase-1 diagnostic fixture added in `backend/test/p4-01-single-human-bot-lifecycle.local.test.mjs`. Fixed seed label `fixture-c` yields a legal south `99` pair. The private test-only trace proves `submittedCardIds === appliedCardIds` for `p4-01-human-99`; therefore this path does not replace `99` with `KK`. It also records east, north and west bot commands with identical `scheduledAt` and `executedAt`, proving the current one-call multi-bot loop. `turnGeneration` in this phase is a derived diagnostic key (`gameId:eventSequence:currentSeat`), not yet a persisted scheduling token.
- 2026-07-28: diagnostics are persisted only in local Durable Object SQLite and exposed solely when `P3_TEST_MODE=true` through test endpoints. They include room/game IDs, derived generation, current actor, mode/controller subject, command and expected sequence, submitted/applied entity IDs, Authority sequence, takeover deadline, bot scheduling/execution timestamps, and restart ACK/rejection. They never include seed text, cookies, invite codes, full hands, or `cardsById`.
- 2026-07-28 verification: backend typecheck; `test:p4-01` (1/1); `test:p3-08` (4/4); `test:p3-11` (6/6, 215 s); frontend `format:check`; targeted Prettier; and `git diff --check` passed. A root `npm run format:check` command is unavailable because the workspace root intentionally has no scripts.
- 2026-07-28: active-trick display correction is recorded separately in `P4-02-current-trick-public-projection.md`. Authority now supplies only current-trick public card faces via `publicActions`; the shared table shows each seat's actual play or pass and distinguishes the leader from the current highest play.
- 2026-07-28: Room reconciliation now persists one bot task scoped to
  `gameId:eventSequence:currentSeat`. A reconciliation executes at most one due
  task, then schedules the next bot only after Authority has produced its next
  event. The task uses the existing short `botThinkDelayMs` cadence, not the
  human 30-second takeover deadline; stale tasks are cleared on accepted human
  commands and restart acknowledgements.
- 2026-07-28: Authority ACKs now include accepted command ID, applied event
  sequence and applied entity card IDs. The owner is no longer exempt from
  `expectedEventSequence`; the multiplayer client clears pending on every
  resolved request and refuses to present mismatched applied IDs as success.
- 2026-07-28: browser diagnosis of a south leading `♦7` proved the action
  button was disabled before its click handler because the Authority-projected
  `legalActions` candidate catalogue did not contain that physical selection.
  The shared multiplayer adapter now forwards any non-empty current selection
  unchanged to Authority, which remains the sole legality decision point.
  Browser Network evidence: `POST /actions` carried the selected 7 ID and the
  200 ACK returned the identical `appliedCardIds`; both restart routes also
  produced 200 ACKs and refreshed the new projection.
