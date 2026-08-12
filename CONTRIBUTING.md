# Contributing to the Guandan Bot Strategy

Thanks for your interest in improving the project.

The game engine, legal-action generation, card-type recognition and comparison rules are already largely implemented. The area where contributions are most welcome is **playing strategy**.

The current strategic target is deliberately practical:

> Build a bot that plays approximately like a reasonable ordinary human Guandan player and avoids obvious strategic mistakes.

A perfect solver is not required.

## 1. What We Are Looking For

Useful contributions include:

- better hand-state evaluation;
- candidate-action scoring;
- lead-play decisions;
- follow-play decisions;
- control-card management;
- bomb usage;
- heart-level-card / wildcard decisions;
- partnership strategy;
- public opponent-threat evaluation;
- endgame decisions;
- benchmark hands and regression scenarios;
- simulation and strategy-comparison tools;
- lightweight search or look-ahead methods.

Both **code contributions and strategy-design proposals** are welcome.

If you understand Guandan strategy but do not want to implement the code, opening an issue with concrete hand examples and reasoning is useful.

## 2. Strategy Design Principle

Please avoid solving individual problems only by adding increasingly specific special-case rules.

Where possible, strategy improvements should answer questions such as:

- What is the shape of the current hand?
- How many reasonably playable turns may remain?
- Which cards are liabilities?
- Which cards are control resources?
- What structures should be preserved?
- What does this candidate action improve?
- What future opportunities does this action sacrifice?
- Is the opponent close to finishing?
- Is the partner close to finishing?
- Is preserving a resource more valuable than improving the route to going out?

The long-term goal is a strategy that evaluates the **consequence of a play**, rather than merely recognising that the play is legal.

## 3. Hidden Information

Strategy code must not use information that a real player would not know.

Do not inspect:

- opponents' hidden hands;
- future undealt information;
- internal state that exposes hidden cards.

Strategy decisions should be based on:

- the bot's own hand;
- legal actions;
- public plays;
- public remaining-card counts;
- partnership;
- current trick / table state;
- other legitimately public information.

## 4. Legal Actions

Strategy code should select from the legal actions supplied by the game engine.

Do not duplicate card legality or comparison rules inside strategy code unless there is a clear architectural reason.

A strategy improvement must never trade game correctness for stronger play.

Expected:

- legal-action rate: 100%;
- no invalid cards;
- no impossible combinations;
- no mutation of hidden game state.

## 5. Determinism

Unless an experiment explicitly investigates stochastic play, strategy changes should preferably remain deterministic.

The same:

- hand;
- table state;
- public information;
- legal actions

should produce the same decision.

This makes strategy regression testing and seed-based comparisons much easier.

## 6. How to Propose a Strategy Improvement

Please include at least one concrete example.

A useful issue or pull request contains:

**Situation**

- level rank;
- bot hand;
- current trick or lead situation;
- relevant remaining-card counts;
- partner / opponent position.

**Current behaviour**

What does the bot currently play?

**Expected behaviour**

What would a reasonable human player probably play?

**Reasoning**

Why?

For example:

- preserves control;
- avoids wasting a wildcard;
- reduces difficult singles;
- improves the remaining hand;
- creates a two-turn finish;
- avoids spending the highest bomb unnecessarily;
- blocks an opponent who is close to going out.

## 7. Tests

Strategy changes should preferably add one or more deterministic regression scenarios.

A good strategy test demonstrates:

1. the relevant legal candidates exist;
2. the old behaviour is undesirable;
3. the proposed behaviour is reasonable;
4. the selected action remains legal;
5. the decision is deterministic.

Avoid creating a test that only passes because the exact test hand was hard-coded into the strategy.

## 8. Evaluating Strategy Changes

A useful evaluation hierarchy is:

1. **Fixed hand scenarios** — does the strategy solve the intended problem?
2. **Regression tests** — did existing behaviour break?
3. **Human review** — does the play look reasonable?
4. **Seed-based simulation** — are there stability or performance regressions?
5. **Larger statistical comparisons** — useful later, but not required for every contribution.

Win rate alone is not sufficient evidence for a small strategy change.

A strategy can win a small simulation sample while still making obviously poor decisions.

## 9. Keep Changes Focused

Please try to keep strategy pull requests focused.

Avoid combining a strategy change with unrelated changes to:

- UI;
- networking;
- multiplayer authority;
- game rules;
- deployment;
- large refactors.

A small, explainable strategy improvement with good test cases is easier to review than a complete rewrite.

## 10. Alternative Strategy Approaches Are Welcome

The project is open to approaches beyond the existing heuristic strategy.

Examples include:

- hand-value functions;
- opportunity-cost models;
- limited-depth look-ahead;
- rule-based expert systems;
- Monte Carlo approaches;
- opponent-model approximations based only on public information;
- reinforcement-learning experiments;
- hybrid heuristic/search approaches.

Please keep computational cost in mind. A strategy that is slightly stronger but requires extremely expensive search may not be suitable as the default bot.

## 11. Pull Request Checklist

Before submitting a strategy PR:

- [ ] The action selected is always legal.
- [ ] No opponent hidden cards are used.
- [ ] The change addresses a clearly described strategy problem.
- [ ] At least one concrete hand scenario demonstrates the improvement.
- [ ] Existing strategy regression tests still pass.
- [ ] The result is deterministic unless randomness is explicitly part of the experiment.
- [ ] Performance remains suitable for interactive play.
- [ ] The PR explains the strategic reasoning, not only the code change.

Thanks for helping improve the Guandan bot.
