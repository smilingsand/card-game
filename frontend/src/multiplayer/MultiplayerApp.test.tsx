import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpMultiplayerClient, type MultiplayerClient, type RoomProjection } from "./client";
import { MultiplayerApp } from "./MultiplayerApp";
import { projectSeatsForViewer } from "./seat-projection";

const room: RoomProjection = {
  roomId: "room-123",
  phase: "lobby",
  seats: [
    { seat: "south", controller: "human", displayName: "曹操", ready: false, isHost: true },
    { seat: "east", controller: "bot", strategy: "normal-vNext", ready: true },
    { seat: "north", controller: "bot", strategy: "normal-vNext", ready: true },
    { seat: "west", controller: "bot", strategy: "normal-vNext", ready: true }
  ]
};

const startedRoom: RoomProjection = { ...room, phase: "started" };
const testCommandId = "00000000-0000-4000-8000-000000000001";
const startedGame = {
  seat: "south" as const,
  eventSequence: 0,
  hand: [
    { id: "card-1", deckIndex: 0, rank: "A" as const, suit: "spades" as const },
    { id: "card-2", deckIndex: 0, rank: "A" as const, suit: "hearts" as const }
  ],
  current: "south" as const,
  leader: "south" as const,
  remainingCardCounts: { south: 27, east: 27, north: 27, west: 27 },
  publicEvents: [],
  legalActions: [
    {
      type: "play" as const,
      actor: "south" as const,
      cardIds: ["card-1"],
      interpretation: {
        type: "single" as const,
        cardIds: ["card-1"],
        wildcardAs: {},
        comparisonKey: [14]
      }
    }
  ]
};

function fakeClient(): MultiplayerClient {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockResolvedValue({ room, inviteCode: "invite-123" }),
    joinRoom: vi.fn(),
    getRoom: vi.fn().mockResolvedValue(room),
    ready: vi.fn().mockResolvedValue(room),
    start: vi.fn().mockResolvedValue(room),
    restartMatch: vi.fn().mockResolvedValue(startedRoom),
    restartRound: vi.fn().mockResolvedValue(startedRoom),
    getGameView: vi.fn(),
    submitAction: vi.fn(),
    connect: vi.fn().mockReturnValue(() => undefined)
  };
}

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(testCommandId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("多人前端", () => {
  it("创建房间仅发送名称和逻辑座位，并展示机器人空座", async () => {
    const client = fakeClient();
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await waitFor(() =>
      expect(client.createRoom).toHaveBeenCalledWith({ displayName: "曹操", seat: "south" })
    );
    const seats = screen.getByLabelText("逻辑座位");
    expect(seats.querySelectorAll("[data-seat]")).toHaveLength(4);
    expect(seats.textContent).toContain("机器人A");
    expect(screen.getByText(/邀请码：/)).toBeInTheDocument();
    const initialConnects = vi.mocked(client.connect).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await waitFor(() =>
      expect(vi.mocked(client.connect).mock.calls.length).toBeGreaterThanOrEqual(
        initialConnects + 1
      )
    );
  });

  it("支持预设与自定义名称，且联机页面不接收本地存档", () => {
    render(<MultiplayerApp client={fakeClient()} onExit={() => undefined} />);
    fireEvent.change(screen.getByLabelText("玩家名称"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("自定义名称"), { target: { value: "自定义玩家" } });
    expect(screen.getByDisplayValue("自定义玩家")).toBeInTheDocument();
    expect(screen.queryByText("继续上次未完成的对局")).not.toBeInTheDocument();
  });

  it("视觉位置始终将本人放在底部，而不改变逻辑行动顺序", () => {
    expect(projectSeatsForViewer("east")).toEqual({
      bottom: "east",
      left: "south",
      top: "west",
      right: "north"
    });
    expect(projectSeatsForViewer("south")).toEqual({
      bottom: "south",
      left: "west",
      top: "north",
      right: "east"
    });
  });

  it("出牌意图不发送可信 actor 或 seat", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ eventSequence: 4, view: {} }), { status: 200 })
      );
    const client = createHttpMultiplayerClient(fetchImpl);
    await client.submitAction({
      roomId: "room-123",
      commandId: "command-123",
      expectedEventSequence: 3,
      kind: "pass"
    });
    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      commandId: "command-123",
      expectedEventSequence: 3,
      kind: "pass"
    });
  });

  it("房主开局后立即读取个人投影并渲染可玩的四方牌桌", async () => {
    const client = fakeClient();
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(startedGame);
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findAllByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    expect(await screen.findByLabelText("多人牌桌")).toBeInTheDocument();
    expect(client.getGameView).toHaveBeenCalledWith("room-123");
    expect(screen.getByLabelText("你的手牌").querySelectorAll(".card-face")).toHaveLength(2);
    expect(screen.queryByText("card-1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("多人房间")).not.toBeInTheDocument();
  });

  it("正式牌桌使用可见名称，并显示权威公开的当前最高出牌", async () => {
    const client = fakeClient();
    vi.mocked(client.getRoom).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue({
      ...startedGame,
      current: "east",
      highestPlay: {
        actor: "west",
        cards: [{ id: "public-west-10", deckIndex: 1, rank: "10", suit: "hearts" }],
        wildcardAs: {}
      },
      publicActions: [
        {
          actor: "west",
          type: "play",
          cards: [{ id: "public-west-10", deckIndex: 1, rank: "10", suit: "hearts" }],
          wildcardAs: {}
        }
      ]
    });
    render(<MultiplayerApp client={client} initialRoomId="room-123" onExit={() => undefined} />);
    await screen.findByLabelText("多人牌桌");
    expect(screen.getByLabelText("你的手牌")).toHaveTextContent("曹操");
    expect(screen.getByText("机器人C")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText("西家")).not.toBeInTheDocument();
  });

  it("多人牌桌保留房主专属重开控制、规则和横竖排手牌整理", async () => {
    const client = fakeClient();
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(startedGame);
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    expect(screen.queryByRole("button", { name: "明牌" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新开赛" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重开本局" })).toBeEnabled();
    expect(screen.getByLabelText("你的手牌").querySelectorAll(".compact-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "横排" }));
    expect(screen.getByRole("button", { name: "竖排" })).toBeInTheDocument();
    expect(screen.getByLabelText("你的手牌").querySelector(".human-hand")).toHaveClass("flat");
    fireEvent.click(screen.getByRole("button", { name: "重新开赛" }));
    await waitFor(() => expect(client.restartMatch).toHaveBeenCalled());
    expect(vi.mocked(client.restartMatch).mock.calls[0]?.[0]).toMatchObject({
      roomId: "room-123",
      expectedEventSequence: 0
    });
  });

  it("非房主的重开控制始终禁用", async () => {
    const client = fakeClient();
    const guestRoom: RoomProjection = {
      ...startedRoom,
      seats: startedRoom.seats.map((item) => ({ ...item, isHost: false }))
    };
    vi.mocked(client.getRoom).mockResolvedValue(guestRoom);
    vi.mocked(client.getGameView).mockResolvedValue(startedGame);
    render(<MultiplayerApp client={client} initialRoomId="room-123" onExit={() => undefined} />);
    await screen.findByLabelText("多人牌桌");
    expect(screen.getByRole("button", { name: "重新开赛" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重开本局" })).toBeDisabled();
  });

  it("两名持续连接的玩家不轮询 /view，并在 roomChanged 后各自刷新个人投影", async () => {
    const client = fakeClient();
    vi.mocked(client.getRoom).mockImplementation(async () =>
      vi.mocked(client.getRoom).mock.calls.length <= 2 ? room : startedRoom
    );
    vi.mocked(client.getGameView).mockResolvedValue(startedGame);
    let firstRoomChanged: (() => void) | undefined;
    let secondRoomChanged: (() => void) | undefined;
    vi.mocked(client.connect)
      .mockImplementationOnce((input) => {
        firstRoomChanged = () => input.onEvent();
        return () => undefined;
      })
      .mockImplementationOnce((input) => {
        secondRoomChanged = () => input.onEvent();
        return () => undefined;
      });
    render(
      <>
        <MultiplayerApp client={client} initialRoomId="room-123" onExit={() => undefined} />
        <MultiplayerApp client={client} initialRoomId="room-123" onExit={() => undefined} />
      </>
    );
    await screen.findAllByLabelText("多人房间");
    await waitFor(() => expect(client.connect).toHaveBeenCalledTimes(2));
    const initialViewReads = vi.mocked(client.getRoom).mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 1_100));
    expect(client.getRoom).toHaveBeenCalledTimes(initialViewReads);
    await act(async () => {
      firstRoomChanged?.();
      secondRoomChanged?.();
    });
    await waitFor(() => expect(client.getGameView).toHaveBeenCalledTimes(2));
  });

  it("只根据个人投影的合法动作提交选中的牌", async () => {
    const client = fakeClient();
    const pairGame = {
      ...startedGame,
      legalActions: [
        {
          type: "play" as const,
          actor: "south" as const,
          cardIds: ["card-1", "card-2"],
          interpretation: {
            type: "pair" as const,
            cardIds: ["card-1", "card-2"],
            wildcardAs: {},
            comparisonKey: [14]
          }
        }
      ]
    };
    const afterPairGame = {
      ...pairGame,
      eventSequence: 1,
      hand: [],
      current: "east" as const,
      remainingCardCounts: { south: 25, east: 27, north: 27, west: 27 },
      legalActions: []
    };
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(pairGame);
    vi.mocked(client.submitAction).mockResolvedValue({
      accepted: true,
      commandId: testCommandId,
      eventSequence: 1,
      appliedEventSequence: 1,
      appliedCardIds: ["card-1", "card-2"],
      view: afterPairGame
    });
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    fireEvent.click(screen.getByRole("button", { name: "选择♠A" }));
    fireEvent.click(screen.getByRole("button", { name: "选择♥A" }));
    expect(screen.getByText("已选择 2 张牌，可以提交给服务端判定。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    await waitFor(() => expect(client.submitAction).toHaveBeenCalled());
    expect(vi.mocked(client.submitAction).mock.calls[0]?.[0]).toMatchObject({
      roomId: "room-123",
      kind: "play",
      cardIds: ["card-1", "card-2"]
    });
    await waitFor(() => expect(screen.getByLabelText("你的手牌")).toHaveTextContent("25"));
    expect(screen.getByLabelText("你的手牌").querySelectorAll(".card-face")).toHaveLength(0);
    expect(screen.getByText("轮到：机器人A")).toBeInTheDocument();
  });

  it("跟牌的合法响应也会在权威确认后立即移除手牌并轮转", async () => {
    const client = fakeClient();
    const responseGame = {
      ...startedGame,
      current: "south" as const,
      leader: "west" as const,
      highestPlay: {
        actor: "west" as const,
        cards: [{ id: "west-pair", deckIndex: 1, rank: "K" as const, suit: "clubs" as const }],
        wildcardAs: {}
      },
      legalActions: [
        {
          type: "play" as const,
          actor: "south" as const,
          cardIds: ["card-1", "card-2"],
          interpretation: {
            type: "pair" as const,
            cardIds: ["card-1", "card-2"],
            wildcardAs: {},
            comparisonKey: [14]
          }
        }
      ]
    };
    const afterResponseGame = {
      ...responseGame,
      eventSequence: 1,
      hand: [],
      current: "east" as const,
      remainingCardCounts: { south: 25, east: 27, north: 27, west: 27 },
      legalActions: []
    };
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(responseGame);
    vi.mocked(client.submitAction).mockResolvedValue({
      accepted: true,
      commandId: testCommandId,
      eventSequence: 1,
      appliedEventSequence: 1,
      appliedCardIds: ["card-1", "card-2"],
      view: afterResponseGame
    });
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    fireEvent.click(screen.getByRole("button", { name: "选择♠A" }));
    fireEvent.click(screen.getByRole("button", { name: "选择♥A" }));
    expect(screen.getByRole("button", { name: "出牌" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    await waitFor(() => expect(client.submitAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("轮到：机器人A")).toBeInTheDocument());
    expect(screen.getByLabelText("你的手牌").querySelectorAll(".card-face")).toHaveLength(0);
  });

  it("reports a readable action conflict instead of silently ignoring it", async () => {
    const client = fakeClient();
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(startedGame);
    vi.mocked(client.submitAction).mockRejectedValue(new Error("event_sequence_conflict"));
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    fireEvent.click(screen.getByRole("button", { name: "选择♠A" }));
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "动作未提交：牌局状态已更新，已同步最新牌桌，请重新选择。"
      )
    );
  });

  it("does not treat an ACK with different applied card IDs as a successful human play", async () => {
    const client = fakeClient();
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(startedGame);
    vi.mocked(client.submitAction).mockResolvedValue({
      accepted: true,
      commandId: testCommandId,
      eventSequence: 1,
      appliedEventSequence: 1,
      appliedCardIds: ["card-2"],
      view: { ...startedGame, eventSequence: 1, hand: [], current: "east", legalActions: [] }
    });
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    fireEvent.click(screen.getByRole("button", { name: "选择♠A" }));
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "严重一致性错误：权威动作与本次提交不一致"
      )
    );
    expect(screen.getByLabelText("你的手牌").querySelectorAll(".card-face")).toHaveLength(2);
  });

  it("clears a prior selection and disables turn controls after Authority advances to another seat", async () => {
    const client = fakeClient();
    const notYourTurnGame = {
      ...startedGame,
      current: "east" as const,
      eventSequence: 3,
      legalActions: []
    };
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView).mockResolvedValue(notYourTurnGame);
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    const card = document.querySelector<HTMLButtonElement>(".hand-card");
    expect(card).not.toBeNull();
    fireEvent.click(card!);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "出牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "过牌" })).toBeDisabled();
    expect(client.submitAction).not.toHaveBeenCalled();
  });

  it("领出时单张未出现在过期投影中会重取 Authority 完整合法动作，不会自行放行", async () => {
    const client = fakeClient();
    const staleGame = {
      ...startedGame,
      legalActions: [
        {
          ...startedGame.legalActions[0],
          cardIds: ["card-1"],
          interpretation: { ...startedGame.legalActions[0].interpretation, cardIds: ["card-1"] }
        }
      ]
    };
    const refreshedGame = {
      ...startedGame,
      legalActions: [
        {
          ...startedGame.legalActions[0],
          cardIds: ["card-2"],
          interpretation: { ...startedGame.legalActions[0].interpretation, cardIds: ["card-2"] }
        }
      ]
    };
    vi.mocked(client.createRoom).mockResolvedValue({ room, inviteCode: "invite-123" });
    vi.mocked(client.start).mockResolvedValue(startedRoom);
    vi.mocked(client.getRoom).mockResolvedValue(startedRoom);
    vi.mocked(client.getGameView)
      .mockResolvedValueOnce(staleGame)
      .mockResolvedValueOnce(refreshedGame);
    vi.mocked(client.submitAction).mockResolvedValue({
      accepted: true,
      commandId: testCommandId,
      eventSequence: 1,
      appliedEventSequence: 1,
      appliedCardIds: ["card-2"],
      view: refreshedGame
    });
    render(<MultiplayerApp client={client} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await screen.findByLabelText("多人房间");
    fireEvent.click(screen.getByRole("button", { name: "开始牌局" }));
    await screen.findByLabelText("你的手牌");
    fireEvent.click(screen.getByRole("button", { name: "选择♥A" }));
    await waitFor(() => expect(client.getGameView).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "出牌" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    await waitFor(() =>
      expect(client.submitAction).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "play", cardIds: ["card-2"] })
      )
    );
  });
});
