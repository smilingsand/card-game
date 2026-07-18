# normal-vNext A/B/C execution plan

## Goal and stop conditions

Work only on `codex/guandan-reference-strategy-research`. Do not change normal-v1, expert, the rules engine, P2.5 ADR/P2.5-16, or the default profile. Stop before the next phase if legality, partnership, joker-over-low-single, bomb-split, unexplained-differential, or protected-file checks fail.

## Phases

| Phase | Status | Exit gate |
| --- | --- | --- |
| A: response structure damage | complete | 52 focused tests, typecheck, lint, build, protected-file check passed |
| B: lightweight structure/resource/contest | blocked | Focused strategy checks pass; full App suite has a repeatable timeout in an existing interaction test |
| C: stable ordering, self-play metrics, diagnostic Preview | pending (not started) | Do not start until B has a clean full test result |
| Commits and final report | pending | Separate A/B/C/Preview-document commits and final evidence recorded |

## Invariants

- normal-vNext consumes only `BotView` and rule-provided `legalActions`.
- It does not call FollowUpPlanner, PostActionHandEvaluator, ActionScorer, or expert depth budgets.
- C only standardizes rules demonstrated by A/B; it does not add a new strategic model.

## Blocking evidence

- B focused strategy suite: 20 normal-vNext cases passed; normal-v1 (3) and table-controller (11) passed in the combined run.
- Typecheck and lint passed.
- The combined run and a separate full `App.test.tsx` run both timed out at `App > 提示和出牌仍通过规则入口提交` after five seconds. The isolated test passed in 1.33 seconds, so the evidence points to suite-load/test-scheduling instability, not a vNext action regression. It still prevents declaring B's full gate clean.
