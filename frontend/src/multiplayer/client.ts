import type { Card, Seat } from "@card-game/guandan-core";

export const MULTIPLAYER_PROTOCOL_VERSION = "p3-ws-v1";

export interface RoomSeatProjection {
  readonly seat: Seat;
  readonly controller: "human" | "bot";
  readonly displayName?: string;
  readonly strategy?: "normal-vNext";
  readonly ready: boolean;
  readonly isHost?: boolean;
}

export interface RoomProjection {
  readonly roomId: string;
  readonly phase: "lobby" | "started";
  readonly seats: readonly RoomSeatProjection[];
}

export interface GameProjection {
  readonly seat: Seat;
  readonly hand: readonly Card[];
  readonly current: Seat;
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly positions?: Readonly<Record<"bottom" | "left" | "top" | "right", Seat>>;
}

export interface MultiplayerClient {
  createSession(): Promise<void>;
  createRoom(input: { readonly displayName: string; readonly seat: Seat }): Promise<{
    readonly room: RoomProjection;
    readonly inviteCode: string;
  }>;
  joinRoom(input: {
    readonly roomId: string;
    readonly inviteCode: string;
    readonly displayName: string;
    readonly seat: Seat;
  }): Promise<{ readonly room: RoomProjection }>;
  getRoom(roomId: string): Promise<RoomProjection>;
  ready(roomId: string): Promise<RoomProjection>;
  start(roomId: string): Promise<RoomProjection>;
  getGameView(roomId: string): Promise<GameProjection>;
  submitAction(input: {
    readonly roomId: string;
    readonly commandId: string;
    readonly expectedEventSequence: number;
    readonly kind: "pass" | "play";
    readonly cardIds?: readonly string[];
  }): Promise<{ readonly eventSequence: number; readonly view: GameProjection }>;
  connect(input: {
    readonly roomId: string;
    readonly lastEventSequence: number;
    readonly onEvent: (eventSequence: number) => void;
    readonly onStatus: (status: "connected" | "disconnected" | "error") => void;
  }): () => void;
}

type FetchLike = typeof fetch;

function apiOrigin(): string {
  return import.meta.env.VITE_MULTIPLAYER_API_ORIGIN?.replace(/\/$/u, "") ?? "";
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { readonly error?: string };
  if (!response.ok) throw new Error(body.error ?? "network_request_failed");
  return body;
}

export function createHttpMultiplayerClient(fetchImpl: FetchLike = fetch): MultiplayerClient {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> =>
    responseJson<T>(
      await fetchImpl(`${apiOrigin()}${path}`, {
        credentials: "include",
        ...init,
        headers: { "content-type": "application/json", ...init?.headers }
      })
    );
  const post = <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) });
  return {
    async createSession() {
      await post("/v1/session", {});
    },
    async createRoom(input) {
      const result = await post<{ readonly room: RoomProjection; readonly inviteCode: string }>(
        "/v1/rooms",
        input
      );
      return result;
    },
    async joinRoom(input) {
      const { roomId, ...body } = input;
      return post<{ readonly room: RoomProjection }>(`/v1/rooms/${roomId}/join`, body);
    },
    async getRoom(roomId) {
      const result = await request<{ readonly room: RoomProjection }>(`/v1/rooms/${roomId}/view`);
      return result.room;
    },
    async ready(roomId) {
      const result = await post<{ readonly room: RoomProjection }>(`/v1/rooms/${roomId}/ready`, {});
      return result.room;
    },
    async start(roomId) {
      const result = await post<{ readonly room: RoomProjection }>(`/v1/rooms/${roomId}/start`, {});
      return result.room;
    },
    async getGameView(roomId) {
      return request<GameProjection>(`/v1/rooms/${roomId}/game-view`);
    },
    submitAction(input) {
      const { roomId, ...body } = input;
      return post<{ readonly eventSequence: number; readonly view: GameProjection }>(
        `/v1/rooms/${roomId}/actions`,
        body
      );
    },
    connect(input) {
      const origin = apiOrigin() || window.location.origin;
      const url = new URL(`/v1/rooms/${input.roomId}/realtime`, origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        input.onStatus("connected");
        socket.send(
          JSON.stringify({
            type: "hello",
            protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
            roomId: input.roomId,
            payload: { lastEventSequence: input.lastEventSequence }
          })
        );
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            readonly type?: string;
            readonly payload?: { readonly eventSequence?: unknown };
          };
          if (message.type === "serverEvent" && Number.isInteger(message.payload?.eventSequence))
            input.onEvent(message.payload!.eventSequence as number);
        } catch {
          input.onStatus("error");
        }
      });
      socket.addEventListener("close", () => input.onStatus("disconnected"));
      socket.addEventListener("error", () => input.onStatus("error"));
      return () => socket.close();
    }
  };
}
