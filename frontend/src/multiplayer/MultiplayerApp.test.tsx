import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function fakeClient(): MultiplayerClient {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockResolvedValue({ room, inviteCode: "invite-123" }),
    joinRoom: vi.fn(),
    getRoom: vi.fn().mockResolvedValue(room),
    ready: vi.fn().mockResolvedValue(room),
    start: vi.fn().mockResolvedValue(room),
    getGameView: vi.fn(),
    submitAction: vi.fn(),
    connect: vi.fn().mockReturnValue(() => undefined)
  };
}

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
    expect(seats.textContent).toContain("normal-vNext");
    expect(screen.getByText(/邀请码：/)).toBeInTheDocument();
    const initialConnects = vi.mocked(client.connect).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await waitFor(() => expect(client.connect).toHaveBeenCalledTimes(initialConnects + 1));
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
});
