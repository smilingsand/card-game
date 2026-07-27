/**
 * P3-06 protocol relay.  It deliberately persists only per-room public/personally
 * projected envelopes; authority state and seeds remain in AuthorityGameDurableObject.
 */
export interface RealtimeRoomEnv {
  readonly ROOM: DurableObjectNamespace;
}

const PROTOCOL_VERSION = "p3-ws-v1";

interface EventRow extends Record<string, SqlStorageValue> {
  readonly sequence: number;
  readonly payload: string;
}

interface CommandRow extends Record<string, SqlStorageValue> {
  readonly commandId: string;
  readonly payload: string;
}

interface Envelope {
  readonly type: string;
  readonly protocolVersion: string;
  readonly roomId: string;
  readonly payload: Record<string, unknown>;
}

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function parse(value: string | ArrayBuffer): Envelope | undefined {
  if (typeof value !== "string" || value.length > 16_384) return undefined;
  try {
    const decoded = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof decoded.type !== "string" ||
      typeof decoded.protocolVersion !== "string" ||
      typeof decoded.roomId !== "string" ||
      !decoded.payload ||
      typeof decoded.payload !== "object" ||
      Array.isArray(decoded.payload)
    )
      return undefined;
    return {
      type: decoded.type,
      protocolVersion: decoded.protocolVersion,
      roomId: decoded.roomId,
      payload: decoded.payload as Record<string, unknown>,
    };
  } catch {
    return undefined;
  }
}

function error(roomId: string, code: string): Envelope {
  return {
    type: code,
    protocolVersion: PROTOCOL_VERSION,
    roomId,
    payload: {},
  };
}

/** Internal-only Durable Object; the Worker authenticates before forwarding. */
export class RealtimeRoomDurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: RealtimeRoomEnv,
  ) {}

  private setup(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS realtime_events (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS realtime_commands (command_id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    );
  }

  private eventsAfter(sequence: number): Envelope[] {
    return [
      ...this.ctx.storage.sql.exec<EventRow>(
        "SELECT sequence, payload FROM realtime_events WHERE sequence > ? ORDER BY sequence",
        sequence,
      ),
    ].map((row) => JSON.parse(row.payload) as Envelope);
  }

  private nextSequence(): number {
    return (
      [
        ...this.ctx.storage.sql.exec<{ readonly sequence: number }>(
          "SELECT COALESCE(MAX(sequence), 0) + 1 as sequence FROM realtime_events",
        ),
      ][0]?.sequence ?? 1
    );
  }

  private async projection(
    roomId: string,
    subjectId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const room = this.env.ROOM.get(this.env.ROOM.idFromName(roomId));
    const response = await room.fetch("https://room.internal/view", {
      method: "POST",
      body: encode({ subjectId }),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      readonly room?: Record<string, unknown>;
    };
    return body.room;
  }

  private async reportPresence(
    roomId: string,
    subjectId: string,
    connected: boolean,
  ): Promise<void> {
    const room = this.env.ROOM.get(this.env.ROOM.idFromName(roomId));
    await room.fetch("https://room.internal/presence", {
      method: "POST",
      body: encode({ subjectId, connected, now: Date.now() }),
    });
  }

  private appendProjection(
    roomId: string,
    projection: Record<string, unknown>,
  ): Envelope {
    const sequence = this.nextSequence();
    const envelope: Envelope = {
      type: "serverEvent",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      payload: { eventSequence: sequence, projection },
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO realtime_events (sequence, payload) VALUES (?, ?)",
      sequence,
      encode(envelope),
    );
    return envelope;
  }

  private send(socket: WebSocket, message: Envelope): void {
    socket.send(encode(message));
  }

  private broadcast(message: Envelope): void {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
  }

  private attachment(
    socket: WebSocket,
  ): { readonly roomId: string; readonly subjectId: string } | undefined {
    const value = socket.deserializeAttachment();
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as Record<string, unknown>).roomId !== "string" ||
      typeof (value as Record<string, unknown>).subjectId !== "string"
    )
      return undefined;
    return value as { readonly roomId: string; readonly subjectId: string };
  }

  async fetch(request: Request): Promise<Response> {
    this.setup();
    const url = new URL(request.url);
    if (url.pathname === "/room-changed") {
      const roomId = request.headers.get("x-p3-internal-room-id");
      if (!roomId || request.method !== "POST")
        return new Response("forbidden", { status: 403 });
      this.broadcast({
        type: "roomChanged",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        payload: {},
      });
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== "/connect")
      return new Response("not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("upgrade required", { status: 426 });
    const roomId = url.searchParams.get("roomId");
    const subjectId = request.headers.get("x-p3-internal-subject");
    if (!roomId || !subjectId)
      return new Response("invalid payload", { status: 400 });
    const projection = await this.projection(roomId, subjectId);
    if (!projection) return new Response("forbidden", { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ roomId, subjectId });
    await this.reportPresence(roomId, subjectId, true);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    this.setup();
    const identity = this.attachment(socket);
    const envelope = parse(message);
    if (!identity || !envelope || envelope.roomId !== identity.roomId) {
      socket.close(1008, "invalid_message");
      return;
    }
    if (envelope.protocolVersion !== PROTOCOL_VERSION) {
      this.send(socket, error(identity.roomId, "protocol.unsupported"));
      socket.close(1002, "unsupported_protocol");
      return;
    }
    if (envelope.type === "heartbeat") {
      await this.reportPresence(identity.roomId, identity.subjectId, true);
      return;
    }
    if (envelope.type === "hello") {
      const last = envelope.payload.lastEventSequence;
      if (!Number.isInteger(last) || (last as number) < 0) {
        socket.close(1008, "invalid_message");
        return;
      }
      const projection = await this.projection(
        identity.roomId,
        identity.subjectId,
      );
      if (!projection) {
        socket.close(1008, "forbidden");
        return;
      }
      if (this.nextSequence() === 1)
        this.appendProjection(identity.roomId, projection);
      this.send(socket, {
        type: "hello.accepted",
        protocolVersion: PROTOCOL_VERSION,
        roomId: identity.roomId,
        payload: { replayAfterEventSequence: last },
      });
      for (const event of this.eventsAfter(last as number))
        this.send(socket, event);
      return;
    }
    if (envelope.type === "resync") {
      const after = envelope.payload.afterEventSequence;
      if (!Number.isInteger(after) || (after as number) < 0) {
        socket.close(1008, "invalid_message");
        return;
      }
      for (const event of this.eventsAfter(after as number))
        this.send(socket, event);
      return;
    }
    if (envelope.type !== "command") {
      socket.close(1008, "invalid_message");
      return;
    }
    const commandId = envelope.payload.clientCommandId;
    const expected = envelope.payload.expectedEventSequence;
    if (
      typeof commandId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(commandId) ||
      !Number.isInteger(expected) ||
      (expected as number) < 0
    ) {
      socket.close(1008, "invalid_message");
      return;
    }
    const existing = [
      ...this.ctx.storage.sql.exec<CommandRow>(
        "SELECT command_id as commandId, payload FROM realtime_commands WHERE command_id=?",
        commandId,
      ),
    ][0];
    if (existing) {
      this.send(socket, JSON.parse(existing.payload) as Envelope);
      return;
    }
    if (envelope.payload.kind !== "sync") {
      this.send(socket, error(identity.roomId, "command.unsupported"));
      return;
    }
    const current = this.nextSequence() - 1;
    if (expected !== current) {
      this.send(socket, {
        type: "command.conflict",
        protocolVersion: PROTOCOL_VERSION,
        roomId: identity.roomId,
        payload: { clientCommandId: commandId, eventSequence: current },
      });
      return;
    }
    const projection = await this.projection(
      identity.roomId,
      identity.subjectId,
    );
    if (!projection) {
      socket.close(1008, "forbidden");
      return;
    }
    const acknowledgement: Envelope = {
      type: "ack",
      protocolVersion: PROTOCOL_VERSION,
      roomId: identity.roomId,
      payload: { clientCommandId: commandId, eventSequence: current + 1 },
    };
    let event: Envelope | undefined;
    this.ctx.storage.transactionSync(() => {
      event = this.appendProjection(identity.roomId, projection);
      this.ctx.storage.sql.exec(
        "INSERT INTO realtime_commands (command_id, payload) VALUES (?, ?)",
        commandId,
        encode(acknowledgement),
      );
    });
    this.broadcast(event!);
    this.send(socket, acknowledgement);
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    const identity = this.attachment(socket);
    // Only a negotiated normal close is immediate.  Network loss relies on the
    // persisted 10s heartbeat / 30s missed-heartbeat deadline in Room.
    if (identity && code === 1000)
      await this.reportPresence(identity.roomId, identity.subjectId, false);
  }
}
