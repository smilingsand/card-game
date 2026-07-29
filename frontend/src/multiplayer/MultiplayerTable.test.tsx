import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameProjection, RoomProjection } from "./client";
import { MultiplayerTable } from "./MultiplayerTable";
import { projectSeatsForViewer } from "./seat-projection";

const seats: RoomProjection["seats"] = [
  { seat: "south", controller: "human", displayName: "南", ready: true },
  { seat: "east", controller: "human", displayName: "东", ready: true },
  { seat: "north", controller: "bot", strategy: "normal-vNext", ready: true },
  { seat: "west", controller: "bot", strategy: "normal-vNext", ready: true }
];

const game: GameProjection = {
  gameId: "game-1",
  seat: "south",
  eventSequence: 3,
  hand: [
    { id: "nine-spade", deckIndex: 0, rank: "9", suit: "spades" },
    { id: "nine-heart", deckIndex: 0, rank: "9", suit: "hearts" },
    { id: "king-spade", deckIndex: 0, rank: "K", suit: "spades" },
    { id: "king-heart", deckIndex: 0, rank: "K", suit: "hearts" }
  ],
  current: "south",
  leader: "south",
  remainingCardCounts: { south: 4, east: 27, north: 27, west: 27 },
  legalActions: [
    {
      type: "play",
      actor: "south",
      cardIds: ["nine-spade", "nine-heart"],
      interpretation: {
        type: "pair",
        cardIds: ["nine-spade", "nine-heart"],
        wildcardAs: {},
        comparisonKey: [9]
      }
    },
    {
      type: "play",
      actor: "south",
      cardIds: ["king-spade", "king-heart"],
      interpretation: {
        type: "pair",
        cardIds: ["king-spade", "king-heart"],
        wildcardAs: {},
        comparisonKey: [13]
      }
    }
  ],
  publicEvents: []
};

function renderTable(onPlay = vi.fn(), actionPending = false) {
  render(
    <MultiplayerTable
      game={game}
      seats={seats}
      handLayout="stacked"
      actionPending={actionPending}
      notice=""
      onPlay={onPlay}
      onPass={vi.fn()}
    />
  );
  return onPlay;
}

describe("共享多人牌桌适配器", () => {
  it("四个观察者都将自己映射到底部，且视觉映射不改变逻辑顺序", () => {
    expect(projectSeatsForViewer("south")).toEqual({
      bottom: "south",
      left: "west",
      top: "north",
      right: "east"
    });
    expect(projectSeatsForViewer("east")).toEqual({
      bottom: "east",
      left: "south",
      top: "west",
      right: "north"
    });
    expect(projectSeatsForViewer("north")).toEqual({
      bottom: "north",
      left: "east",
      top: "south",
      right: "west"
    });
    expect(projectSeatsForViewer("west")).toEqual({
      bottom: "west",
      left: "north",
      top: "east",
      right: "south"
    });
  });

  it("99 的实体 ID 原样提交，绝不替换为另一组合法的 KK", () => {
    const onPlay = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "选择♠9" }));
    fireEvent.click(screen.getByRole("button", { name: "选择♥9" }));
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    expect(onPlay).toHaveBeenCalledWith(["nine-spade", "nine-heart"]);
    expect(onPlay).not.toHaveBeenCalledWith(["king-spade", "king-heart"]);
  });

  it("pending 时不允许重复提交", () => {
    const onPlay = renderTable(vi.fn(), true);
    expect(screen.getByRole("button", { name: "出牌" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("领出时不把不完整的候选 legalActions 当作本地禁止出牌的规则裁决", () => {
    const onPlay = vi.fn();
    render(
      <MultiplayerTable
        game={{ ...game, legalActions: [] }}
        seats={seats}
        handLayout="stacked"
        actionPending={false}
        notice=""
        onPlay={onPlay}
        onPass={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "选择♠9" }));
    expect(screen.getByRole("button", { name: "出牌" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    expect(onPlay).toHaveBeenCalledWith(["nine-spade"]);
  });

  it("renders every public action in the active trick and names only the highest play", () => {
    const botSeats: RoomProjection["seats"] = [
      { seat: "south", controller: "human", displayName: "曹操", ready: true },
      { seat: "east", controller: "bot", strategy: "normal-vNext", ready: true },
      { seat: "north", controller: "bot", strategy: "normal-vNext", ready: true },
      { seat: "west", controller: "bot", strategy: "normal-vNext", ready: true }
    ];
    render(
      <MultiplayerTable
        game={{
          ...game,
          current: "east",
          leader: "north",
          highestPlay: {
            actor: "west",
            cards: [{ id: "west-joker", deckIndex: 1, rank: "big-joker", suit: "joker" }],
            wildcardAs: {},
            patternLabel: "单张"
          },
          publicActions: [
            {
              actor: "north",
              type: "play",
              cards: [{ id: "north-nine", deckIndex: 0, rank: "9", suit: "clubs" }],
              wildcardAs: {}
            },
            {
              actor: "west",
              type: "play",
              cards: [{ id: "west-joker", deckIndex: 1, rank: "big-joker", suit: "joker" }],
              wildcardAs: {}
            }
          ]
        }}
        seats={botSeats}
        handLayout="stacked"
        actionPending={false}
        notice=""
        onPlay={vi.fn()}
        onPass={vi.fn()}
      />
    );
    expect(within(screen.getByLabelText("top 座位")).getByText("9")).toBeInTheDocument();
    expect(within(screen.getByLabelText("left 座位")).getByText("大王")).toBeInTheDocument();
    expect(screen.getByText(/当前牌由机器人C压住/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已出单张。");
    expect(screen.queryByText(/机器人C领出/)).not.toBeInTheDocument();
  });

  it("renders the explicit public match summary without requiring a session or hidden hands", () => {
    render(
      <MultiplayerTable
        game={{
          ...game,
          match: {
            roundNumber: 2,
            levels: { northSouth: "2", eastWest: "3" },
            activeLevelTeam: "eastWest",
            previousFinish: ["east", "south", "north", "west"],
            tributeSummary: ["西家贡小王"],
            tributeHint: "下一局已准备完成"
          }
        }}
        seats={seats}
        handLayout="stacked"
        actionPending={false}
        notice=""
        onPlay={vi.fn()}
        onPass={vi.fn()}
      />
    );
    const scoreboard = screen.getByLabelText("赛局记分与贡牌");
    expect(scoreboard).toHaveTextContent("我方2对方3西家贡小王");
    expect(scoreboard.querySelectorAll(".match-token")).toHaveLength(2);
  });

  it("在人类收到进贡时只允许从原手牌选牌，再确认还贡", () => {
    const onTribute = vi.fn();
    render(
      <MultiplayerTable
        game={{
          ...game,
          match: {
            roundNumber: 2,
            levels: { northSouth: "2", eastWest: "3" },
            activeLevelTeam: "eastWest",
            tributeSummary: ["东家贡A"],
            tributeHint: "请你（南家）还贡"
          },
          tributeAction: { kind: "return", cardIds: ["nine-spade"] }
        }}
        seats={seats}
        handLayout="stacked"
        actionPending={false}
        notice=""
        onPlay={vi.fn()}
        onPass={vi.fn()}
        onTribute={onTribute}
      />
    );
    expect(screen.queryByLabelText("选择还贡牌")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择♠9" }));
    fireEvent.click(screen.getByRole("button", { name: "确认还贡" }));
    expect(onTribute).toHaveBeenCalledWith("return", "nine-spade");
  });

  it("resets manual hand ordering when Authority starts a new round", async () => {
    const props = {
      seats,
      handLayout: "stacked" as const,
      actionPending: false,
      notice: "",
      onPlay: vi.fn(),
      onPass: vi.fn()
    };
    const { rerender } = render(<MultiplayerTable game={game} {...props} />);
    const nineSpade = screen.getByRole("button", { name: "选择♠9" });
    fireEvent.keyDown(nineSpade, { altKey: true, key: "ArrowLeft" });
    fireEvent.keyDown(nineSpade, { altKey: true, key: "ArrowLeft" });

    rerender(
      <MultiplayerTable
        game={{
          ...game,
          hand: [game.hand[0], game.hand[2]],
          match: {
            roundNumber: 2,
            levels: { northSouth: "2", eastWest: "2" },
            activeLevelTeam: "northSouth",
            tributeSummary: [],
            tributeHint: ""
          }
        }}
        {...props}
      />
    );

    await waitFor(() => {
      const cards = within(screen.getByLabelText("你的手牌")).getAllByRole("button");
      expect(cards[0]).toHaveAccessibleName("选择♠K");
    });
  });
});
