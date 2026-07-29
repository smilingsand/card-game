import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent
} from "react";
import {
  actionFromPublicEvent,
  formatCard,
  groupHumanDisplayCards,
  groupOrderedDisplayCards,
  moveHumanDisplayCard,
  reconcileHumanDisplayOrder,
  type Card,
  type Seat
} from "@card-game/guandan-core";
import {
  createHttpMultiplayerClient,
  type GameProjection,
  type MultiplayerClient,
  type RoomProjection
} from "./client";
import { MultiplayerTable } from "./MultiplayerTable";
import type { TablePosition } from "./seat-projection";

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

function botName(seat: Seat, seats: RoomProjection["seats"]): string {
  const index = seats
    .filter((item) => item.controller === "bot")
    .findIndex((item) => item.seat === seat);
  return `机器人${String.fromCharCode("A".charCodeAt(0) + Math.max(index, 0))}`;
}

function messageFor(error: unknown): string {
  const code = error instanceof Error ? error.message : "network_request_failed";
  const messages: Record<string, string> = {
    event_sequence_conflict: "动作未提交：牌局状态已更新，已同步最新牌桌，请重新选择。",
    invalid_action: "所选牌组不是当前可出的合法牌，请重新选择。",
    not_your_turn: "动作未提交：现在还没轮到你出牌。",
    seat_under_bot_control: "动作未提交：该座位正由机器人托管，本动作结束后会自动恢复。",
    network_request_failed: "提交失败：无法连接权威服务端。"
  };
  return messages[code] ?? `操作失败：${code}`;
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
  const [lobbyPending, setLobbyPending] = useState(false);
  const [eventSequence, setEventSequence] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  const eventSequenceRef = useRef(0);
  const roomPhaseRef = useRef<RoomProjection["phase"] | undefined>(undefined);
  const projectionRefreshRef = useRef<Promise<void> | undefined>(undefined);
  const lobbyPendingRef = useRef(false);
  const latestGameProjectionRef = useRef<{
    readonly gameId?: string;
    readonly eventSequence: number;
  }>({
    eventSequence: -1
  });
  const [notice, setNotice] = useState("请选择名称后创建或加入房间。");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [handLayout, setHandLayout] = useState<"stacked" | "flat">("stacked");
  const name = displayName === "custom" ? customName.trim() : displayName;
  const viewerSeat =
    game?.seat ??
    room?.seats.find((item) => item.controller === "human" && item.isHost)?.seat ??
    seat;
  const hasRoom = Boolean(room);
  const isHost = room?.seats.find((item) => item.seat === viewerSeat)?.isHost === true;
  const viewerReady = room?.seats.find((item) => item.seat === viewerSeat)?.ready === true;
  const allPlayersReady = room?.seats.every((item) => item.ready) === true;
  const matchSeatName = (logicalSeat: Seat) => {
    if (logicalSeat === viewerSeat) return `${SEAT_LABEL[logicalSeat]}（你）`;
    const seated = room?.seats.find((item) => item.seat === logicalSeat);
    return `${SEAT_LABEL[logicalSeat]}（${
      seated?.controller === "bot" ? "机器人" : (seated?.displayName ?? "玩家")
    }）`;
  };

  const applyGameProjection = useCallback((nextGame: GameProjection) => {
    const latest = latestGameProjectionRef.current;
    const sameGame = latest.gameId === nextGame.gameId;
    // A realtime notification can start a projection read just before an action
    // completes. Never let that older read overwrite the acknowledged action.
    if (sameGame && nextGame.eventSequence < latest.eventSequence) return;
    latestGameProjectionRef.current = {
      gameId: nextGame.gameId,
      eventSequence: nextGame.eventSequence
    };
    eventSequenceRef.current = nextGame.eventSequence;
    setGame(nextGame);
    setEventSequence(nextGame.eventSequence);
  }, []);

  const refreshGameProjection = useCallback(
    (id: string) => {
      if (projectionRefreshRef.current) return projectionRefreshRef.current;
      const refresh = client
        .getGameView(id)
        .then(applyGameProjection)
        .finally(() => {
          if (projectionRefreshRef.current === refresh) projectionRefreshRef.current = undefined;
        });
      projectionRefreshRef.current = refresh;
      return refresh;
    },
    [applyGameProjection, client]
  );

  const refreshRoom = useCallback(
    async (id: string) => {
      const next = await client.getRoom(id);
      // A delayed lobby projection from a selection refresh must not take an
      // already-started room back to the lobby screen.
      setRoom((current) =>
        current?.roomId === next.roomId && current.phase === "started" && next.phase === "lobby"
          ? current
          : next
      );
      if (next.phase === "started") {
        await refreshGameProjection(id);
        setNotice((current) => (current.includes("创建或加入房间") ? "已恢复房间连接。" : current));
      }
    },
    [client, refreshGameProjection]
  );

  useEffect(() => {
    roomPhaseRef.current = room?.phase;
  }, [room?.phase]);

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
      onRoomClosed: onExit,
      onEvent: (sequence) => {
        if (Number.isInteger(sequence)) setEventSequence(sequence as number);
        const refresh =
          roomPhaseRef.current === "started" ? refreshGameProjection(roomId) : refreshRoom(roomId);
        void refresh.catch((error) => setNotice(messageFor(error)));
      }
    });
  }, [client, connectionEpoch, hasRoom, onExit, refreshGameProjection, refreshRoom, roomId]);

  useEffect(() => {
    if (!import.meta.env.DEV || room?.phase !== "started" || !roomId || !game) return;
    if (room.seats.find((item) => item.seat === game.current)?.controller !== "bot") return;

    const observedGameId = game.gameId;
    const observedSequence = game.eventSequence;
    // Wrangler/Miniflare may cancel a local DO alarm.  This is deliberately a
    // single delayed recovery per bot turn, not a websocket heartbeat poll:
    // it preserves the visible 0.8–1.34s bot think time and avoids flooding
    // Room with overlapping presence requests.
    const timer = window.setTimeout(() => {
      if (!client.nudgeRoom) return;
      void client
        .nudgeRoom(roomId)
        .then(() => client.getGameView(roomId))
        .then((nextGame) => {
          applyGameProjection(nextGame);
          if (nextGame.gameId === observedGameId && nextGame.eventSequence === observedSequence)
            setNotice("本地机器人仍在等待调度；将由下一次房间事件继续恢复。");
        })
        .catch(() => {
          // This is only the development-only alarm recovery path.  A failed
          // recovery nudge must not be presented as a player operation failure.
          setNotice("本地机器人调度正在恢复，请稍候。");
        });
    }, 1_600);
    return () => window.clearTimeout(timer);
  }, [applyGameProjection, client, game, room, roomId]);

  const withSession = async (operation: () => Promise<void>) => {
    if (lobbyPendingRef.current) return;
    lobbyPendingRef.current = true;
    setLobbyPending(true);
    try {
      await client.createSession();
      await operation();
    } catch (error) {
      setNotice(messageFor(error));
      setConnection("error");
    } finally {
      lobbyPendingRef.current = false;
      setLobbyPending(false);
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

  const run = (operation: () => Promise<RoomProjection>, success: string) => {
    if (lobbyPendingRef.current) return;
    lobbyPendingRef.current = true;
    setLobbyPending(true);
    void operation()
      .then(async (next) => {
        setRoom(next);
        if (next.phase === "started") {
          const nextGame = await client.getGameView(next.roomId);
          applyGameProjection(nextGame);
        }
        setNotice(success);
      })
      .catch((error) => setNotice(messageFor(error)))
      .finally(() => {
        lobbyPendingRef.current = false;
        setLobbyPending(false);
      });
  };

  const submit = (kind: "pass" | "play" | "tribute" | "return", cardIds?: readonly string[]) => {
    if (!roomId || !game || actionPending) return;
    const commandId = crypto.randomUUID();
    const submittedCardIds = kind === "pass" ? [] : [...(cardIds ?? [])];
    setActionPending(true);
    setNotice(
      kind === "pass"
        ? "正在提交过牌。"
        : kind === "tribute"
          ? "正在提交进贡牌。"
          : kind === "return"
            ? "正在提交还贡牌。"
            : "正在提交出牌。"
    );
    void client
      .submitAction({
        roomId,
        commandId,
        expectedEventSequence: game.eventSequence,
        kind,
        ...(kind !== "pass" ? { cardIds: submittedCardIds } : {})
      })
      .then((result) => {
        if (
          result.commandId !== commandId ||
          !result.accepted ||
          result.appliedEventSequence !== result.eventSequence ||
          result.appliedCardIds.length !== submittedCardIds.length ||
          !result.appliedCardIds.every((cardId) => submittedCardIds.includes(cardId))
        ) {
          setNotice("严重一致性错误：权威动作与本次提交不一致，已停止将其视为成功。");
          return;
        }
        applyGameProjection(result.view);
        setNotice(
          kind === "pass"
            ? "已过牌。"
            : kind === "tribute"
              ? "已完成进贡。"
              : kind === "return"
                ? "已完成还贡，下一局开始。"
                : "已出牌。"
        );
      })
      .catch((error) => setNotice(messageFor(error)))
      .finally(() => setActionPending(false));
  };
  const restart = (kind: "match" | "round") => {
    if (!roomId || !game || !isHost || restartPending) return;
    setRestartPending(true);
    setNotice(kind === "match" ? "正在重新开赛。" : "正在重开本局。");
    const submitRestart = (expectedEventSequence: number) => {
      const input = {
        roomId,
        clientCommandId: crypto.randomUUID(),
        expectedEventSequence
      };
      return kind === "match" ? client.restartMatch(input) : client.restartRound(input);
    };
    // A bot event can advance the authority sequence in the short interval
    // between rendering the host control and clicking it.  Refresh the public
    // personal projection and retry that *host command* once with the current
    // revision; never silently reuse a stale revision.
    const restartWithFreshRevision = async () => {
      try {
        return await submitRestart(game.eventSequence);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "event_sequence_conflict") throw error;
        const current = await client.getGameView(roomId);
        applyGameProjection(current);
        return submitRestart(current.eventSequence);
      }
    };
    void restartWithFreshRevision()
      .then(async (next) => {
        setRoom(next);
        const nextGame = await client.getGameView(roomId);
        applyGameProjection(nextGame);
        setNotice(kind === "match" ? "已重新开赛。" : "已重开本局。");
      })
      .catch((error) => setNotice(messageFor(error)))
      .finally(() => {
        setActionPending(false);
        setRestartPending(false);
      });
  };
  const exitTable = () => {
    setGame(undefined);
    setActionPending(false);
    setNotice("已退出牌桌，可在大厅继续管理房间。");
  };
  const exitLobby = () => {
    if (!roomId || !room) return onExit();
    setLobbyPending(true);
    void (isHost ? client.closeRoom(roomId) : client.leaveRoom(roomId))
      .then(onExit)
      .catch((error) => setNotice(messageFor(error)))
      .finally(() => setLobbyPending(false));
  };

  return (
    <main className="multiplayer-app" aria-label="多人联网掼蛋">
      <header>
        <div className="game-title">
          <h1>多人联网掼蛋</h1>
        </div>
        <button
          type="button"
          onClick={() => setRulesOpen((open) => !open)}
          aria-expanded={rulesOpen}
        >
          规则
        </button>
        <button
          type="button"
          onClick={() => restart("match")}
          disabled={!game || !isHost || restartPending}
        >
          重新开赛
        </button>
        <button
          type="button"
          onClick={() => restart("round")}
          disabled={!game || !isHost || restartPending}
        >
          重开本局
        </button>
        <button
          type="button"
          aria-pressed={handLayout === "flat"}
          onClick={() => setHandLayout((layout) => (layout === "stacked" ? "flat" : "stacked"))}
        >
          {handLayout === "stacked" ? "横排" : "竖排"}
        </button>
        <button type="button" onClick={game ? exitTable : exitLobby}>
          退出
        </button>
      </header>
      {game?.match?.previousFinish ? (
        <section className="round-announcement" aria-label="本局结算与下一局提示">
          <span>完成顺序：{game.match.previousFinish.map(matchSeatName).join("、")}。</span>
          <strong>{game.match.tributeHint}</strong>
        </section>
      ) : null}
      {rulesOpen ? (
        <aside aria-label="规则入口">
          本局规则以项目的 <code>docs/resolved-rules.md</code>{" "}
          为唯一口径；牌型与跟牌均由权威服务端判定。
        </aside>
      ) : null}
      {!game ? (
        <p role="status">
          {notice} 连接：{connection}
        </p>
      ) : null}
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
          <button type="button" onClick={create} disabled={!name || lobbyPending}>
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
          <button
            type="button"
            onClick={join}
            disabled={!name || !roomId || !inviteCode || lobbyPending}
          >
            加入房间
          </button>
        </section>
      ) : room.phase === "lobby" ? (
        <section aria-label="多人房间" className="multiplayer-room">
          <p>房间：{room.roomId}</p>
          {inviteCode ? (
            <p>
              邀请码：<code>{inviteCode}</code>
            </p>
          ) : null}
          {connection === "disconnected" || connection === "error" ? (
            <button type="button" onClick={() => setConnectionEpoch((current) => current + 1)}>
              重新连接
            </button>
          ) : null}
          <div className="multiplayer-seats" aria-label="逻辑座位">
            {room.seats.map((item) => (
              <article key={item.seat} data-seat={item.seat}>
                <strong>
                  {item.controller === "bot" ? botName(item.seat, room.seats) : item.displayName}
                </strong>
                <span>{item.ready ? " 已准备" : " 未准备"}</span>
              </article>
            ))}
          </div>
          {room.phase === "lobby" ? (
            <button
              type="button"
              onClick={() =>
                viewerReady && isHost
                  ? run(() => client.start(roomId), "牌局已开始。")
                  : run(() => client.ready(roomId), "已准备。")
              }
              disabled={lobbyPending || (viewerReady && (!isHost || !allPlayersReady))}
            >
              {lobbyPending
                ? "正在提交…"
                : viewerReady
                  ? isHost
                    ? "开始游戏"
                    : "已准备，等待房主开始"
                  : "准备"}
            </button>
          ) : null}
          <button type="button" onClick={exitLobby} disabled={lobbyPending}>
            {isHost ? "关闭房间" : "退出房间"}
          </button>
        </section>
      ) : game ? (
        <MultiplayerTable
          game={game}
          seats={room.seats}
          onPass={() => submit("pass")}
          onPlay={(cardIds) => submit("play", cardIds)}
          onTribute={(kind, cardId) => submit(kind, [cardId])}
          onStaleLeadingSelection={() => {
            setNotice("正在同步服务端提供的当前合法出牌。");
            return refreshRoom(roomId).catch((error) => setNotice(messageFor(error)));
          }}
          handLayout={handLayout}
          actionPending={actionPending}
          notice={notice}
        />
      ) : null}
    </main>
  );
}

export function LegacyGameView({
  game,
  positions,
  seats,
  onPass,
  onPlay,
  onStaleLeadingSelection,
  handLayout,
  actionPending,
  notice
}: {
  readonly game: GameProjection;
  readonly positions: Record<TablePosition, Seat>;
  readonly seats: RoomProjection["seats"];
  readonly onPass: () => void;
  readonly onPlay: (cardIds: readonly string[]) => void;
  readonly onStaleLeadingSelection: () => Promise<void>;
  readonly handLayout: "stacked" | "flat";
  readonly actionPending: boolean;
  readonly notice: string;
}) {
  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  const [displayOrder, setDisplayOrder] = useState<readonly string[]>();
  const [draggingCardId, setDraggingCardId] = useState<string>();
  const staleLeadingSelectionRef = useRef<string | undefined>(undefined);
  const canAct = game.current === game.seat;
  const cardsById = useMemo(() => new Map(game.hand.map((card) => [card.id, card])), [game.hand]);
  const hand = useMemo(
    () =>
      reconcileHumanDisplayOrder(
        displayOrder,
        game.hand.map((card) => card.id),
        cardsById,
        game.levelRank ?? "2"
      ),
    [cardsById, displayOrder, game.hand, game.levelRank]
  );
  const handGroups = displayOrder
    ? groupOrderedDisplayCards(hand, cardsById)
    : groupHumanDisplayCards(hand, cardsById, game.levelRank ?? "2");
  useEffect(() => {
    setSelectedCardIds((current) =>
      current.filter((cardId) => game.hand.some((card) => card.id === cardId))
    );
  }, [game.hand]);
  // Legal actions are personal and are empty whenever this seat does not own
  // the turn.  Do not leave an old highlighted selection on the table after
  // Authority advances to another player.
  useEffect(() => {
    if (!canAct) setSelectedCardIds([]);
  }, [canAct, game.eventSequence]);
  useEffect(() => {
    setDisplayOrder(undefined);
  }, [game.gameId]);
  const selectedPlay = game.legalActions?.find(
    (action) => action.type === "play" && sameCards(action.cardIds, selectedCardIds)
  );
  const leadingSingleSelection =
    canAct && game.current === game.leader && selectedCardIds.length === 1 && !selectedPlay;
  useEffect(() => {
    if (!leadingSingleSelection) return;
    const key = `${game.gameId ?? "current"}:${game.eventSequence}:${selectedCardIds[0]}`;
    if (staleLeadingSelectionRef.current === key) return;
    staleLeadingSelectionRef.current = key;
    void onStaleLeadingSelection();
  }, [
    game.eventSequence,
    game.gameId,
    leadingSingleSelection,
    onStaleLeadingSelection,
    selectedCardIds
  ]);
  const recentActions = new Map(
    (game.publicEvents ?? [])
      .map(actionFromPublicEvent)
      .filter((action): action is NonNullable<typeof action> => action !== undefined)
      .slice(-4)
      .map((action) => [action.actor, action])
  );
  const displayName = (logicalSeat: Seat) => {
    const entry = seats.find((item) => item.seat === logicalSeat);
    return entry?.controller === "human"
      ? (entry.displayName ?? "玩家")
      : botName(logicalSeat, seats);
  };
  const toggleCard = (cardId: string) => {
    if (!canAct) return;
    setSelectedCardIds((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]
    );
  };
  const moveCard = (movingCardId: string, targetCardId: string) => {
    const next = moveHumanDisplayCard(hand, movingCardId, targetCardId);
    if (next !== hand) setDisplayOrder(next);
  };
  const dragStart = (event: DragEvent<HTMLButtonElement>, cardId: string) => {
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingCardId(cardId);
  };
  const dropOnCard = (event: DragEvent<HTMLButtonElement>, targetCardId: string) => {
    event.preventDefault();
    const movingCardId = event.dataTransfer.getData("text/plain") || draggingCardId;
    if (movingCardId) moveCard(movingCardId, targetCardId);
    setDraggingCardId(undefined);
  };
  const reorderWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, cardId: string) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const index = hand.indexOf(cardId);
    const targetIndex = event.key === "ArrowLeft" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= hand.length) return;
    event.preventDefault();
    const next = [...hand];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setDisplayOrder(next);
  };
  return (
    <section aria-label="个人牌局视图" className="multiplayer-game multiplayer-table-game">
      <section className="table responsive-table" aria-label="多人牌桌">
        {(["top", "left", "right"] as const).map((position) => {
          const logicalSeat = positions[position];
          return (
            <section
              className={`seat ${position === "top" ? "north" : position === "left" ? "west" : "east"}`}
              key={position}
              aria-label={`${position} 座位`}
            >
              <strong>{displayName(logicalSeat)}</strong>
              <span className="card-count seat-card-count">
                {game.remainingCardCounts[logicalSeat]}
              </span>
              <PublicAction
                action={recentActions.get(logicalSeat)}
                highestPlay={game.highestPlay?.actor === logicalSeat ? game.highestPlay : undefined}
              />
            </section>
          );
        })}
        <section className="table-info" aria-label="桌面信息">
          <p>轮到：{displayName(game.current)}</p>
          <p>
            {game.highestPlay ? `${displayName(game.highestPlay.actor)}当前领出` : "等待牌局开始"}
          </p>
          <p className="table-status" role="status">
            {notice}
          </p>
        </section>
        <span className="seat-actions south-actions">
          <PublicAction
            action={recentActions.get(game.seat)}
            highestPlay={game.highestPlay?.actor === game.seat ? game.highestPlay : undefined}
          />
        </span>
        <section className="human-seat" aria-label="你的手牌">
          <section aria-label="操作">
            <button
              type="button"
              onClick={onPass}
              disabled={
                actionPending ||
                !canAct ||
                !game.legalActions?.some((action) => action.type === "pass")
              }
            >
              过牌
            </button>
            <button
              type="button"
              onClick={() =>
                onPlay(selectedPlay?.type === "play" ? selectedPlay.cardIds : selectedCardIds)
              }
              disabled={actionPending || !canAct || !selectedPlay}
            >
              出牌
            </button>
          </section>
          <p className="selected-play-status" aria-live="polite">
            {!canAct
              ? `等待${displayName(game.current)}出牌。`
              : selectedCardIds.length === 0
                ? "请选择要出的牌。"
                : selectedPlay
                  ? `已选择 ${selectedCardIds.length} 张牌，可以出牌。`
                  : `已选择 ${selectedCardIds.length} 张牌；这不是当前可出的合法牌型。`}
          </p>
          <div className={`card-groups human-hand ${handLayout}`}>
            {handGroups.map((group) => (
              <span className="card-stack joined-card-stack" key={group.key}>
                {group.cardIds.map((cardId, index) => {
                  const card = cardsById.get(cardId);
                  if (!card) return null;
                  const compact = handLayout === "stacked" && index > 0;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`hand-card${compact ? " compact-card" : ""}`}
                      aria-label={`选择${formatCard(card)}`}
                      aria-pressed={canAct && selectedCardIds.includes(card.id)}
                      aria-disabled={!canAct}
                      aria-describedby="multiplayer-hand-help"
                      draggable
                      onClick={() => toggleCard(card.id)}
                      onDragStart={(event) => dragStart(event, card.id)}
                      onDragEnd={() => setDraggingCardId(undefined)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => dropOnCard(event, card.id)}
                      onKeyDown={(event) => reorderWithKeyboard(event, card.id)}
                    >
                      <MultiplayerCardFace
                        card={card}
                        compact={compact}
                        levelRank={game.levelRank}
                      />
                    </button>
                  );
                })}
              </span>
            ))}
          </div>
          <p className="human-seat-identity">
            <strong className="human-seat-name">{displayName(game.seat)}</strong>
            <span className="card-count seat-card-count">{game.hand.length}</span>
          </p>
        </section>
        <p id="multiplayer-hand-help">
          已按牌面自动整理。可拖拽牌到另一张牌前方理牌；也可按 Alt 加左右方向键移动当前牌。
        </p>
      </section>
    </section>
  );
}

function sameCards(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cardId) => right.includes(cardId));
}

function PublicAction({
  action,
  highestPlay
}: {
  readonly action: ReturnType<typeof actionFromPublicEvent>;
  readonly highestPlay?: NonNullable<GameProjection["highestPlay"]>;
}) {
  if (!action && !highestPlay) return null;
  return (
    <span className="public-action">
      {highestPlay ? (
        highestPlay.cards.map((card) => (
          <MultiplayerCardFace
            key={card.id}
            card={card}
            levelRank={undefined}
            wildcardAs={highestPlay.wildcardAs[card.id]}
          />
        ))
      ) : action?.type === "pass" ? (
        <span className="pass-word">过</span>
      ) : (
        <span>已出</span>
      )}
    </span>
  );
}

function MultiplayerCardFace({
  card,
  compact = false,
  levelRank,
  wildcardAs
}: {
  readonly card: Card;
  readonly compact?: boolean;
  readonly levelRank?: Card["rank"];
  readonly wildcardAs?: { readonly rank: Card["rank"] };
}) {
  const suit = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣", joker: "" }[card.suit];
  const rank =
    card.rank === "small-joker" ? "小王" : card.rank === "big-joker" ? "大王" : card.rank;
  return (
    <span className={`card-face ${card.suit}${compact ? " compact" : ""}`}>
      {card.rank === levelRank ? (
        <span className="card-badge">{card.suit === "hearts" ? "配" : "级"}</span>
      ) : null}
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{suit}</span>
      {wildcardAs ? <span className="wildcard-as">配{wildcardAs.rank}</span> : null}
    </span>
  );
}
