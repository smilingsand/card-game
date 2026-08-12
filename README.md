# Double-Deck Poker Game Platform

[中文版 README](README_cn.md)

A double-deck poker game platform built with TypeScript, React, and Cloudflare Worker architecture. The currently completed game is **Guandan**, with a local single-player mode and a multiplayer room mode available in the local development environment.

## Features

- Deterministic Guandan game core with double-deck rules, hand-type recognition, legal-action validation, and card comparison;
- Single-player mode: 1 human player vs 3 bots;
- Multiplayer mode: create, join, and manage rooms with 1–4 human players; empty seats are filled by bots;
- Real-time multiplayer synchronization;
- Temporary bot takeover after disconnection and seamless continuation after reconnection;
- Browser-based game table with basic mobile support.

Guandan rules, scoring conventions, and local variants differ between regions. Please refer to reliable external rule references when necessary.

## Single-Player and Multiplayer Modes

| Mode          | Use Case                          | How to Start                                            | Current Deployment                                                           |
| ------------- | --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Single-player | 1 human + 3 bots                  | Use the Vercel deployment or start the frontend locally | Publicly deployed on Vercel                                                  |
| Multiplayer   | 1–4 humans; bots fill empty seats | Start both the local frontend and authoritative backend | Local development only; not yet deployed to public Cloudflare infrastructure |

The public Vercel deployment currently provides **single-player only**. Multiplayer is implemented in the repository, but it requires the local Wrangler/Miniflare backend and cannot currently be created or joined through the public Vercel site.

## Bot Strategy Status

All bots used in actual gameplay currently use `normal-vNext`.

The bot chooses from legal actions based on:

- its own hand;
- public cards already played;
- remaining-card counts for each seat;
- current table/trick state;
- the legal actions supplied by the rules engine.

It does **not** inspect hidden cards in other players' hands.

The current strategy is still a relatively basic heuristic strategy. It can handle common follow-play decisions, some structure protection, partner pass behaviour, and some endgame blocking, but it has not yet reached the level of a mature human Guandan player.

Typical remaining weaknesses include:

- evaluating a move locally without sufficiently considering the quality of the remaining hand;
- poor opportunity-cost decisions;
- spending strong control cards too early;
- using a valuable heart level card as a wildcard for a low-value combination;
- using a very strong bomb when a cheaper alternative would be sufficient;
- leading powerful structures too early without considering their future control value;
- protecting weak structures at the cost of more valuable cards;
- choosing technically legal but strategically unnatural plays.

## 🤖 Bot Strategy Contributions Welcome

The game engine and rule system are now sufficiently mature that the main open challenge is **playing strategy**.

The goal is not necessarily to build a perfect or tournament-level Guandan AI. A very useful contribution would simply move the bot toward the level of a **reasonable ordinary human player** and reduce obvious strategic mistakes.

Useful strategy improvements may include:

- hand-state evaluation;
- candidate-action scoring;
- opportunity-cost models;
- lead-play strategy;
- follow-play strategy;
- control-card management;
- heart-level-card / wildcard usage;
- bomb management;
- partnership strategy;
- public-threat evaluation;
- endgame strategy;
- deterministic benchmark scenarios;
- lightweight search or look-ahead;
- Monte Carlo or other experimental approaches using only legitimate public information.

A particularly important design question is:

> Given several legal actions, how should the bot evaluate the future value and opportunity cost of each choice?

Possible factors include:

- estimated number of turns required to finish the hand;
- difficult remaining singles;
- natural structures such as pairs, triples, straights, consecutive pairs, and plates;
- control resources such as Aces, Twos, level cards, Jokers, and bombs;
- heart-level-card flexibility;
- future ability to regain the lead;
- one-turn or two-turn finishing routes;
- partner position;
- opponent remaining-card threat.

Contributions do **not** need to redesign the game engine, UI, networking, or multiplayer system.

Please see [`CONTRIBUTING.md`](CONTRIBUTING.md) and the open GitHub issues labelled `strategy` and `help wanted`.

If you understand Guandan strategy but do not want to implement code, concrete hand examples and human reasoning are also very valuable.

## Requirements

- Node.js 22 (the project declares support for `>=22.0.0 <25`);
- Windows PowerShell (used by the local multiplayer convenience scripts);
- npm.

Install dependencies from the repository root:

```powershell
npm.cmd install
```

## Running the Single-Player Game

### Public Version

Open the deployed single-player version:

<https://card-game-wentop.vercel.app/>

### Local Version

From the repository root, start the frontend:

```powershell
npm.cmd --prefix frontend run dev
```

Then open the Vite URL shown in the terminal, usually:

<http://127.0.0.1:5173/>

This starts the frontend only and is suitable for single-player games.

## Running the Local Multiplayer Game

### Local Server Only

Multiplayer requires both the frontend and authoritative backend.

From the repository root, run:

```powershell
npm.cmd run p4:dev
```

This starts:

- Frontend: `http://127.0.0.1:5173/`;
- Local Worker/Miniflare authoritative backend: `http://127.0.0.1:8788/`;
- Local SQLite-backed Durable Object data.

Open the frontend address and select **Multiplayer** to create or join a room.

Other devices on the same LAN can access:

```text
http://<host-ip>:5173/
```

The frontend proxies `/v1` HTTP and WebSocket requests to the backend running on the host machine.

Do **not** expose port `8788` directly to the LAN or public internet.

To stop normally, press `Ctrl+C` in the terminal running `p4:dev`.

If processes remain after an abnormal shutdown or ports are still occupied, run:

```powershell
npm.cmd run p4:stop
```

## Repository Structure

- `frontend/` — React/Vite browser application;
- `backend/` — local multiplayer rooms, authoritative Worker, and real-time communication;
- `packages/guandan-core/` — shared pure-TypeScript Guandan rules, legal actions, and bot strategy core;
- `docs/` — rules, architecture, and product documentation;
- `tools/` — reusable local development tools;
- `temp/` — disposable local intermediate files; should not be committed.

## Development Checks

Common frontend checks:

```powershell
npm.cmd --prefix frontend run format:check
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run test:run
```

## Contributing

Contributions are welcome, especially in bot strategy.

Before submitting a strategy change, please read [`CONTRIBUTING.md`](CONTRIBUTING.md). Strategy changes should preferably include:

- a concrete hand scenario;
- current bot behaviour;
- expected human-like behaviour;
- strategic reasoning;
- deterministic regression tests;
- confirmation that all selected actions remain legal.

Please avoid using hidden opponent information or mixing unrelated UI/network changes into strategy pull requests.
