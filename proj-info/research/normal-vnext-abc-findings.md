# normal-vNext A/B/C findings

- `normal-v1` remains in `normal-bot.ts`; table profile `normal` continues to use it unchanged.
- `normal-vNext` consumes only `BotView` and rule-provided complete legal actions. It does not generate, validate, or mutate actions.
- Phase-A structure costs: pair 240; triple 600; straight 800; consecutive pairs 900; steel plate 1000; bomb 100000. Ordinary follow-play accepts only damage below 600; direct finish and enemy 1–2-card block are exceptions.
- Three-with-pair is a defined exception to generic total-cost ordering: first choose the lowest legal main triple, then choose the lowest-resource attached pair.
- B must stay light and deterministic; it must not call FollowUpPlanner, PostActionHandEvaluator, ActionScorer, or expert candidate budgets.
- C can use existing `simulation.ts` and `strategy/simulation-metrics.ts` only after confirming the path does not invoke P2.5 gated benchmarks and keeps the bot on BotView.
