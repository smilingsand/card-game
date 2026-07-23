import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Seat } from "@card-game/guandan-core";
import {
  createHttpMultiplayerClient,
  type GameProjection,
  type MultiplayerClient,
  type RoomProjection
} from "./client";
import { projectSeatsForViewer, type TablePosition } from "./seat-projection";

const PRESET_NAMES = [
  "曹操",
  "刘备",
  "孙权",
  "周瑜",
  "诸葛亮",
  "关羽",
  "张飞",
  "赵云",
  "貂蝉",
  "小乔",
  "甄宓"
] as const;
const SEATS: readonly Seat[] = ["south", "east", "north", "west"];
const SEAT_LABEL: Record<Seat, string> = { south: "南", east: "东", north: "北", west: "西" };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "network_request_failed";
}

export function MultiplayerApp({
  client: suppliedClient,
  onExit,
  initialRoomId,
  onRoomChange
}: {
  readonly client?: MultiplayerClient;
  readonly onExit: () => void;
  readonly initialRoomId?: string;
  readonly onRoomChange?: (roomId: string | undefined) => void;
}) {
  const client = useMemo(() => suppliedClient ?? createHttpMultiplayerClient(), [suppliedClient]);
  const [displayName, setDisplayName] = useState<string>(PRESET_NAMES[0]);
  const [customName, setCustomName] = useState("");
  const [seat, setSeat] = useState<Seat>("south");
  const [roomId, setRoomId] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [room, setRoom] = useState<RoomProjection>();
  const [game, setGame] = useState<GameProjection>();
  const [connection, setConnection] = useState<"idle" | "connected" | "disconnected" | "error">(
    "idle"
  );
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [eventSequence, setEventSequence] = useState(0);
  const eventSequenceRef = useRef(0);
  const [notice, setNotice] = useState("请选择名称后创建或加入房间。");
  const name = displayName === "custom" ? customName.trim() : displayName;
  const viewerSeat =
    game?.seat ??
    room?.seats.find((item) => item.controller === "human" && item.isHost)?.seat ??
    seat;
  const hasRoom = Boolean(room);
  const positions = projectSeatsForViewer(viewerSeat);

  const refreshRoom = useCallback(
    async (id: string) => {
      const next = await client.getRoom(id);
      setRoom(next);
      if (next.phase === "started") setGame(await client.getGameView(id));
    },
    [client]
  );

  useEffect(() => {
    if (!initialRoomId || room) return;
    setRoomId(initialRoomId);
    void refreshRoom(initialRoomId).catch((error) => setNotice(messageFor(error)));
  }, [initialRoomId, refreshRoom, room]);

  useEffect(() => {
    eventSequenceRef.current = eventSequence;
  }, [eventSequence]);

  useEffect(() => {
    if (!roomId || !hasRoom) return;
    return client.connect({
      roomId,
      lastEventSequence: eventSequenceRef.current,
      onStatus: setConnection,
      onEvent: (sequence) => {
        setEventSequence(sequence);
        void refreshRoom(roomId).catch((error) => setNotice(messageFor(error)));
      }
    });
  }, [client, connectionEpoch, hasRoom, refreshRoom, roomId]);

  const withSession = async (operation: () => Promise<void>) => {
    try {
      await client.createSession();
      await operation();
    } catch (error) {
      setNotice(messageFor(error));
      setConnection("error");
    }
  };

  const create = () =>
    void withSession(async () => {
      const created = await client.createRoom({ displayName: name, seat });
      setRoomId(created.room.roomId);
      onRoomChange?.(created.room.roomId);
      setInviteCode(created.inviteCode);
      setRoom(created.room);
      setNotice("房间已创建，请把邀请码发给其他玩家。");
    });
  const join = () =>
    void withSession(async () => {
      const joined = await client.joinRoom({ roomId, inviteCode, displayName: name, seat });
      setRoom(joined.room);
      onRoomChange?.(roomId);
      setNotice("已加入房间，等待其他玩家准备。");
    });

  const run = (operation: () => Promise<RoomProjection>, success: string) =>
    void operation()
      .then((next) => {
        setRoom(next);
        setNotice(success);
      })
      .catch((error) => setNotice(messageFor(error)));

  const submit = (kind: "pass" | "play") => {
    if (!roomId || !game) return;
    void client
      .submitAction({
        roomId,
        commandId: crypto.randomUUID(),
        expectedEventSequence: eventSequence,
        kind,
        ...(kind === "play" ? { cardIds: [game.hand[0]?.id].filter(Boolean) } : {})
      })
      .then((result) => {
        setEventSequence(result.eventSequence);
        setGame(result.view);
      })
      .catch((error) => setNotice(messageFor(error)));
  };

  return (
    <main className="multiplayer-app" aria-label="多人联网掼蛋">
      <header>
        <div className="game-title">
          <h1>多人联网掼蛋</h1>
        </div>
        <button type="button" onClick={onExit}>
          返回单机
        </button>
      </header>
      <p role="status">
        {notice} 连接：{connection}
      </p>
      {!room ? (
        <section aria-label="多人大厅" className="multiplayer-lobby">
          <label>
            玩家名称
            <select value={displayName} onChange={(event) => setDisplayName(event.target.value)}>
              {PRESET_NAMES.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
              <option value="custom">自定义</option>
            </select>
          </label>
          {displayName === "custom" ? (
            <label>
              自定义名称
              <input value={customName} onChange={(event) => setCustomName(event.target.value)} />
            </label>
          ) : null}
          <label>
            逻辑座位
            <select value={seat} onChange={(event) => setSeat(event.target.value as Seat)}>
              {SEATS.map((item) => (
                <option key={item} value={item}>
                  {SEAT_LABEL[item]}家（{item}）
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={create} disabled={!name}>
            创建房间
          </button>
          <label>
            房间 ID
            <input
              aria-label="房间 ID"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value.trim())}
            />
          </label>
          <label>
            邀请码
            <input
              aria-label="邀请码"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.trim())}
            />
          </label>
          <button type="button" onClick={join} disabled={!name || !roomId || !inviteCode}>
            加入房间
          </button>
        </section>
      ) : (
        <section aria-label="多人房间" className="multiplayer-room">
          <p>房间：{room.roomId}</p>
          {inviteCode ? (
            <p>
              邀请码：<code>{inviteCode}</code>
            </p>
          ) : null}
          {connection !== "connected" ? (
            <button type="button" onClick={() => setConnectionEpoch((current) => current + 1)}>
              重新连接
            </button>
          ) : null}
          <div className="multiplayer-seats" aria-label="逻辑座位">
            {room.seats.map((item) => (
              <article key={item.seat} data-seat={item.seat}>
                <strong>{SEAT_LABEL[item.seat]}家</strong>：
                {item.controller === "bot" ? `机器人（${item.strategy}）` : item.displayName}
                <span>{item.ready ? " 已准备" : " 未准备"}</span>
              </article>
            ))}
          </div>
          {room.phase === "lobby" ? (
            <>
              <button type="button" onClick={() => run(() => client.ready(roomId), "已准备。")}>
                准备
              </button>
              <button type="button" onClick={() => run(() => client.start(roomId), "牌局已开始。")}>
                开始牌局
              </button>
            </>
          ) : null}
          {game ? (
            <GameView
              game={game}
              positions={positions}
              onPass={() => submit("pass")}
              onPlay={() => submit("play")}
            />
          ) : null}
        </section>
      )}
    </main>
  );
}

function GameView({
  game,
  positions,
  onPass,
  onPlay
}: {
  readonly game: GameProjection;
  readonly positions: Record<TablePosition, Seat>;
  readonly onPass: () => void;
  readonly onPlay: () => void;
}) {
  return (
    <section aria-label="个人牌局视图" className="multiplayer-game">
      <p>
        你的逻辑座位：{game.seat}；当前行动：{game.current}
      </p>
      <div className="multiplayer-table" aria-label="视觉座位投影">
        {(Object.entries(positions) as [TablePosition, Seat][]).map(([position, logicalSeat]) => (
          <span key={position} data-position={position}>
            {position}: {logicalSeat}（剩余 {game.remainingCardCounts[logicalSeat]} 张）
          </span>
        ))}
      </div>
      <div aria-label="你的手牌">
        {game.hand.map((card) => (
          <span key={card.id}>
            {card.rank}-{card.suit}{" "}
          </span>
        ))}
      </div>
      <button type="button" onClick={onPass} disabled={game.current !== game.seat}>
        过牌
      </button>
      <button
        type="button"
        onClick={onPlay}
        disabled={game.current !== game.seat || game.hand.length === 0}
      >
        出第一张牌
      </button>
    </section>
  );
}
