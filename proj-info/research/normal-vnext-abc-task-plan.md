# normal-vNext A/B/C execution plan

## Goal and stop conditions

Work only on `codex/guandan-reference-strategy-research`. Do not change normal-v1, expert, the rules engine, P2.5 ADR/P2.5-16, or the default profile. Stop before the next phase if legality, partnership, joker-over-low-single, bomb-split, unexplained-differential, or protected-file checks fail.

## Phases

| Phase | Status | Exit gate |
| --- | --- | --- |
| A: response structure damage | complete | 52 focused tests, typecheck, lint, build, protected-file check passed |
| B: lightweight structure/resource/contest | complete | App cleanup fix plus full validation passed; no strategy behavior changed by the fix |
| C: stable ordering, self-play metrics, diagnostic Preview | complete | C1/C2 contracts, C3 offline replay reports, and Preview diagnostics validated |
| Commits and final report | complete | C1/C2, CLI, and Preview/document commits recorded; awaiting human Preview acceptance |

## Invariants

- normal-vNext consumes only `BotView` and rule-provided `legalActions`.
- It does not call FollowUpPlanner, PostActionHandEvaluator, ActionScorer, or expert depth budgets.
- C only standardizes rules demonstrated by A/B; it does not add a new strategic model.

## Blocking evidence

- B focused strategy suite: 20 normal-vNext cases passed; normal-v1 (3) and table-controller (11) passed in the combined run.
- Typecheck and lint passed.
- A/B-predecessor baseline `e7ff3be` completed full App tests in about 12.2 seconds. After A/B, the full suite twice timed out at `App > 提示和出牌仍通过规则入口提交`, while the isolated test passed in 1.33 seconds.
- Root cause: the newly added Preview test mounts introduced another asynchronous App effect/timer lifecycle. The suite relied on implicit React Testing Library cleanup, so pending work could survive into later tests. An explicit `afterEach(cleanup)` in `App.test.tsx` restores test isolation without changing production behavior or assertion strength.
- Post-fix full App runs: 20/20 passed three consecutive times (3.95s, 3.95s, 3.90s test time); the target case took 1.19s, 1.16s, 1.14s. Typecheck, lint, normal-vNext (20), normal-v1 (3), and table-controller (11) all passed.

## C completion evidence

- C1/C2: `2f3f493`; 21 normal-vNext contract cases plus one fixed-BotView metric case passed.
- C3 offline CLI: `b16fa82`; complete legal candidates and rule validation are used for every action. Compare mode with seeds 0,1 completed and wrote JSON, Markdown, compact replay, and anomaly fixtures under `temp/`.
- Preview diagnostics are read-only and use the same selected normal-vNext action; no profile default or selector ordering changed.
- Final checks: typecheck and lint passed; focused normal-vNext/metrics/normal-v1/table-controller/App suite passed 56 tests; `App.test.tsx` passed three consecutive times (20 tests each).
- Next state: manual Preview acceptance only; do not merge to main before that acceptance.
