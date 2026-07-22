# normal-vNext A/B/C progress

## 2026-07-19

- Started Phase A on `codex/guandan-reference-strategy-research`.
- Added the red test for `777` versus independent `8`; it originally selected `7`, confirming the split-cost defect.
- Implemented response cost: rank + structure damage + control resource + wildcard opportunity.
- Added A fixed cases for: prefer independent `8`; ordinary pass with only `777`; one-card enemy endgame may split `777`; do not split a bomb, steel plate, or consecutive pairs for an ordinary single.
- `normal-vnext-bot.test.ts`: 18/18 passed.
- Error: first TDD skill read used an incorrect user-directory path. Resolved by reading `D:\AI-Brain\.cc-switch\skills\tdd\SKILL.md`.
- Error: the original three-with-pair test accidentally formed an intact steel plate and, after changing that fixture, exposed incorrect ordering where a larger main triple won because its kicker was cheaper. Resolved by ordering three-with-pair candidates by main triple first, then kicker resource cost.
- Next: run the complete Phase-A verification gate, isolate protected files, then commit A before beginning B.
