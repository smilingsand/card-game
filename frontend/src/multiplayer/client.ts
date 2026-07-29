import type { Card, Event, Seat, TurnAction } from "@card-game/guandan-core";

export const MULTIPLAYER_PROTOCOL_VERSION = "p3-ws-v1";
const HEARTBEAT_INTERVAL_MS = 10_000;
const LOCAL_RECOVERY_RETRY_DELAY_MS = 400;

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
  readonly gameId?: string;
  readonly seat: Seat;
  readonly eventSequence: number;
  readonly hand: readonly Card[];
  readonly current: Seat;
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly levelRank?: Card["rank"];
  /** Explicitly public match facts; never a TableSession or another seat's hand. */
  readonly match?: {
    readonly roundNumber: number;
    readonly levels: Readonly<{
      readonly northSouth: Card["rank"];
      readonly eastWest: Card["rank"];
    }>;
    readonly activeLevelTeam: "northSouth" | "eastWest";
    readonly previousFinish?: readonly Seat[];
    readonly tributeSummary: readonly string[];
    readonly tributeHint: string;
  };
  /** 仅在本人需要完成进贡或还贡时出现的权威可选实体牌。 */
  readonly tributeAction?: {
    readonly kind: "tribute" | "return";
    readonly cardIds: readonly string[];
  };
  readonly positions?: Readonly<Record<"bottom" | "left" | "top" | "right", Seat>>;
  readonly leader?: Seat;
  readonly passes?: readonly Seat[];
  readonly finished?: readonly Seat[];
  /** 仅供尚未删除的 LegacyGameView 兼容；活跃多人牌桌不使用它。 */
  readonly publicEvents?: readonly Event[];
  readonly publicActions?: readonly {
    readonly actor: Seat;
    readonly type: "play" | "pass";
    readonly cards: readonly Card[];
    readonly wildcardAs: Readonly<Record<string, { readonly rank: Card["rank"] }>>;
  }[];
  /** The currently winning public play; never a private hand projection. */
  readonly highestPlay?: {
    readonly actor: Seat;
    readonly cards: readonly Card[];
    readonly wildcardAs: Readonly<Record<string, { readonly rank: Card["rank"] }>>;
  };
  /** Present only for the authenticated viewer while it is their turn. */
  readonly legalActions?: readonly TurnAction[];
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
  restartMatch(input: {
    readonly roomId: string;
    readonly clientCommandId: string;
    readonly expectedEventSequence: number;
  }): Promise<RoomProjection>;
  restartRound(input: {
    readonly roomId: string;
    readonly clientCommandId: string;
    readonly expectedEventSequence: number;
  }): Promise<RoomProjection>;
  getGameView(roomId: string): Promise<GameProjection>;
  submitAction(input: {
    readonly roomId: string;
    readonly commandId: string;
    readonly expectedEventSequence: number;
    readonly kind: "pass" | "play" | "tribute" | "return";
    readonly cardIds?: readonly string[];
  }): Promise<{
    readonly accepted: true;
    readonly commandId: string;
    readonly eventSequence: number;
    readonly appliedEventSequence: number;
    readonly appliedCardIds: readonly string[];
    readonly view: GameProjection;
  }>;
  /** Local-only recovery for a missed Durable Object bot alarm. */
  nudgeRoom?(roomId: string): Promise<void>;
  connect(input: {
    readonly roomId: string;
    readonly lastEventSequence: number;
    readonly onEvent: (eventSequence?: number) => void;
    readonly onStatus: (status: "connected" | "disconnected" | "error") => void;
  }): () => void;
}

type FetchLike = typeof fetch;

function apiOrigin(): string {
  return import.meta.env.VITE_MULTIPLAYER_API_ORIGIN?.replace(/\/$/u, "") ?? "";
}

function isLocalWorkerRestart(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("http_503:") &&
    error.message.includes("worker restarted mid-request")
  );
}

async function responseJson<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  let body: T;
  try {
    body = rawBody ? (JSON.parse(rawBody) as T) : ({} as T);
  } catch {
    const detail = rawBody.replace(/\s+/gu, " ").trim().slice(0, 160);
    throw new Error(
      response.ok
        ? "invalid_server_response"
        : `http_${response.status}${detail ? `: ${detail}` : ""}`
    );
  }
  if (!response.ok) {
    const error = (body as T & { readonly error?: string }).error;
    throw new Error(error ?? `http_${response.status}`);
  }
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
    async restartMatch(input) {
      const { roomId, ...body } = input;
      const result = await post<{ readonly room: RoomProjection }>(
        `/v1/rooms/${roomId}/restart-match`,
        body
      );
      return result.room;
    },
    async restartRound(input) {
      const { roomId, ...body } = input;
      const result = await post<{ readonly room: RoomProjection }>(
        `/v1/rooms/${roomId}/restart-round`,
        body
      );
      return result.room;
    },
    async getGameView(roomId) {
      return request<GameProjection>(`/v1/rooms/${roomId}/game-view`);
    },
    submitAction(input) {
      const { roomId, ...body } = input;
      return post<{
        readonly accepted: true;
        readonly commandId: string;
        readonly eventSequence: number;
        readonly appliedEventSequence: number;
        readonly appliedCardIds: readonly string[];
        readonly view: GameProjection;
      }>(`/v1/rooms/${roomId}/actions`, body);
    },
    async nudgeRoom(roomId) {
      if (!import.meta.env.DEV) return;
      try {
        await post(`/v1/rooms/${roomId}/presence`, { connected: true });
      } catch (error) {
        // This endpoint only refreshes local presence and is safe to replay.
        // Wrangler can restart its local worker while Miniflare is recovering an
        // alarm, which otherwise surfaces as an unrelated player operation error.
        if (!isLocalWorkerRestart(error)) throw error;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, LOCAL_RECOVERY_RETRY_DELAY_MS);
        });
        await post(`/v1/rooms/${roomId}/presence`, { connected: true });
      }
    },
    connect(input) {
      const origin = apiOrigin() || window.location.origin;
      const url = new URL(`/v1/rooms/${input.roomId}/realtime`, origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      let heartbeat: number | undefined;
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
        heartbeat = window.setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(
            JSON.stringify({
              type: "heartbeat",
              protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
              roomId: input.roomId,
              payload: {}
            })
          );
        }, HEARTBEAT_INTERVAL_MS);
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            readonly type?: string;
            readonly payload?: { readonly eventSequence?: unknown };
          };
          // RealtimeRoom has its own relay sequence.  It is deliberately not
          // the Authority event sequence used to submit an action, so never
          // feed it into the caller's optimistic command revision.  A fresh
          // personal projection supplies that revision after the notification.
          if (message.type === "roomChanged" || message.type === "serverEvent") input.onEvent();
        } catch {
          input.onStatus("error");
        }
      });
      socket.addEventListener("close", () => {
        if (heartbeat !== undefined) window.clearInterval(heartbeat);
        input.onStatus("disconnected");
      });
      socket.addEventListener("error", () => input.onStatus("error"));
      return () => {
        if (heartbeat !== undefined) window.clearInterval(heartbeat);
        socket.close(1000);
      };
    }
  };
}
