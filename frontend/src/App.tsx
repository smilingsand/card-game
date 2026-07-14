import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import "./App.css";
import type { Card, Seat } from "./platform/types";
import { createIndexedDbStorage, type StorageBoundary } from "./platform/storage";
import {
  chooseTableHintAction,
  chooseTableBotAction,
  formatCard,
  formatInterpretation,
  getLegalSingleActions,
  getSelectedPlayActions,
  type TableGame
} from "./games/guandan/table-controller";
import {
  applyTableSessionAction,
  createTableSession,
  getSouthReturnChoices,
  getSouthTributeChoices,
  prepareNextTableSession,
  restoreTableSession,
  serializeTableSession,
  setHumanDisplayOrder,
  submitSouthReturn,
  submitSouthTribute,
  type TableSave,
  type TableSession
} from "./games/guandan/table-session";
import {
  groupHumanDisplayCards,
  groupOrderedDisplayCards,
  moveHumanDisplayCard,
  reconcileHumanDisplayOrder,
  sortPlayedCards
} from "./games/guandan/display-order";
import type { TurnAction } from "./games/guandan/turns";
import { actionFromPublicEvent, latestRecentActionsBySeat } from "./games/guandan/recent-actions";
import { botThinkDelayMs } from "./games/guandan/bot-timing";

const HUMAN_SEAT: Seat = "south";
type BotSeat = "east" | "north" | "west";
type HandLayout = "stacked" | "flat";
const seatName: Record<Seat, string> = {
  east: "东家（机器人）",
  south: "南家（你）",
  west: "西家（机器人）",
  north: "北家（机器人）"
};
const seatShortName: Record<Seat, string> = {
  east: "东家",
  south: "南家",
  west: "西家",
  north: "北家"
};

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function defaultStorage(): StorageBoundary<TableSave> {
  return createIndexedDbStorage<TableSave>({
    databaseName: "card-game",
    storeName: "saves",
    key: "guandan-current"
  });
}

export function CardFace({
  card,
  wildcardAs,
  compact = false,
  levelRank = "2"
}: {
  readonly card: Card;
  readonly wildcardAs?: { readonly rank: Card["rank"] };
  readonly compact?: boolean;
  readonly levelRank?: Card["rank"];
}) {
  const suit = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣", joker: "" }[card.suit];
  const rank =
    card.rank === "small-joker" ? "小王" : card.rank === "big-joker" ? "大王" : card.rank;
  const badge = card.rank === levelRank ? (card.suit === "hearts" ? "配" : "级") : undefined;
  return (
    <span className={`card-face ${card.suit}${compact ? " compact" : ""}`}>
      {badge ? <span className="card-badge">{badge}</span> : null}
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{suit}</span>
      {wildcardAs ? <span className="wildcard-as">配{wildcardAs.rank}</span> : null}
    </span>
  );
}

export function App({ storage }: { readonly storage?: StorageBoundary<TableSave> }) {
  const saveStorage = useMemo(() => storage ?? defaultStorage(), [storage]);
  const [session, setSession] = useState<TableSession>(() => createTableSession(newSeed()));
  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("请选择手牌后出牌。");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string>();
  const [showAllHands, setShowAllHands] = useState(false);
  const [handLayout, setHandLayout] = useState<HandLayout>("stacked");
  const game: TableGame = session.game;
  const levelRank = game.levelRank ?? session.match.levelRank;

  useEffect(() => {
    let active = true;
    void saveStorage
      .load()
      .then((save) => {
        if (!active || !save) return;
        setSession(restoreTableSession(save));
        setSelectedCardIds([]);
        setMessage("已继续上次未完成的对局。");
      })
      .catch(() => {
        if (!active) return;
        setSaveBlocked(true);
        setMessage("存档不兼容或恢复失败；请新局或清除存档。");
      })
      .finally(() => {
        if (active) setStorageReady(true);
      });
    return () => {
      active = false;
    };
  }, [saveStorage]);

  useEffect(() => {
    if (!storageReady || saveBlocked) return;
    void saveStorage.save(serializeTableSession(session)).catch(() => undefined);
  }, [saveBlocked, saveStorage, session, storageReady]);

  useEffect(() => {
    if (
      game.state.completed ||
      session.match.tributePhase !== "ready" ||
      game.state.current === HUMAN_SEAT
    )
      return;
    const timer = window.setTimeout(() => {
      const action = chooseTableBotAction(game);
      if (!action) {
        setMessage(`${seatName[game.state.current]}没有可执行的合法动作。`);
        return;
      }
      const result = applyTableSessionAction(session, action);
      if (!result.ok) {
        setMessage(`机器人动作被规则引擎拒绝：${result.code}`);
        return;
      }
      setSession(result.session);
    }, botThinkDelayMs(game.publicEvents.length));
    return () => window.clearTimeout(timer);
  }, [game, session]);

  useEffect(() => {
    if (!game.state.completed) return;
    const timer = window.setTimeout(() => {
      try {
        setSession((current) => prepareNextTableSession(current));
        setSelectedCardIds([]);
        setMessage("本局已结算，正在准备下一局。");
      } catch {
        setMessage("下一局准备失败，请开始新局。");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [game.state.completed]);

  const hand = reconcileHumanDisplayOrder(
    session.humanDisplayOrder,
    game.state.hands[HUMAN_SEAT],
    game.cardsById,
    levelRank
  );
  const handGroups = session.humanDisplayOrder
    ? groupOrderedDisplayCards(hand, game.cardsById)
    : groupHumanDisplayCards(hand, game.cardsById, levelRank);
  const selectedActions = getSelectedPlayActions(game, selectedCardIds);
  const canPass = getLegalSingleActions(game).some((action) => action.type === "pass");
  const highestPlay = game.state.highestSeat
    ? [...game.publicEvents]
        .reverse()
        .map(actionFromPublicEvent)
        .find(
          (action): action is Extract<TurnAction, { readonly type: "play" }> =>
            action?.type === "play" && action.actor === game.state.highestSeat
        )
    : undefined;
  const revealedHand = (seat: BotSeat) =>
    groupHumanDisplayCards(game.state.hands[seat], game.cardsById, levelRank);
  const publicPlay = (seat: Seat) => (highestPlay?.actor === seat ? highestPlay : undefined);
  const recentActions = latestRecentActionsBySeat(game.publicEvents);
  const recentActionsFor = (seat: Seat) => recentActions.filter((action) => action.actor === seat);

  const renderAction = (action: TurnAction, current: boolean) => (
    <span
      key={`${action.actor}-${action.type}-${action.type === "play" ? action.cardIds.join("-") : "pass"}`}
      className="public-action"
      aria-label={`${seatName[action.actor]}${current ? "当前出牌" : "最近出牌"}`}
    >
      {action.type === "pass" ? (
        <span className="pass-word">不要</span>
      ) : (
        sortPlayedCards(action.cardIds, game.cardsById, levelRank, action.interpretation).map(
          (cardId) => {
            const card = game.cardsById.get(cardId);
            if (!card) return null;
            return (
              <CardFace
                key={cardId}
                card={card}
                levelRank={levelRank}
                wildcardAs={action.interpretation.wildcardAs[cardId]}
              />
            );
          }
        )
      )}
    </span>
  );

  const submit = (action: ReturnType<typeof getLegalSingleActions>[number]) => {
    const result = applyTableSessionAction(session, action);
    if (!result.ok) {
      setMessage(`规则引擎拒绝此动作：${result.code}`);
      return;
    }
    setSession(result.session);
    setSelectedCardIds([]);
    setMessage(
      action.type === "pass"
        ? "你选择了过牌。"
        : `已出${formatInterpretation(action.interpretation)}。`
    );
  };

  const southTributeChoices = getSouthTributeChoices(session);
  const southReturnChoices = getSouthReturnChoices(session);
  const southManualChoices =
    session.match.tributePhase === "awaiting-tribute" ? southTributeChoices : southReturnChoices;
  const awaitingSouthTribute = southTributeChoices.length > 0;
  const awaitingSouthReturn = southReturnChoices.length > 0;
  const humanCanAct =
    session.match.tributePhase === "ready" &&
    game.state.current === HUMAN_SEAT &&
    !game.state.completed;
  const tributeHint = (() => {
    if (!session.match.previousFinish) return "首局由南家先出";
    if (session.match.tributePlan.antiTribute) return "本局抗贡，无需进贡";
    if (awaitingSouthTribute) return "请你（南家）上贡";
    if (awaitingSouthReturn) return "请你（南家）还贡";
    const next = session.match.tributePlan.obligations.find(
      (item) => !session.match.submittedTributes.includes(item.cardId)
    );
    return next ? `请${seatShortName[next.from]}上贡` : "下一局已准备完成";
  })();
  const tributeSummary = session.match.tributePlan.antiTribute
    ? ["抗贡"]
    : session.match.tributePlan.obligations.map((item) => {
        const card = game.cardsById.get(item.cardId);
        return `${seatShortName[item.from]}贡${card ? formatCard(card) : "牌"}`;
      });
  const displayedFinish = session.match.currentFinish ?? session.match.previousFinish;

  const submitManualTribute = () => {
    const cardId = selectedCardIds[0];
    if (!cardId) return;
    try {
      setSession(submitSouthTribute(session, cardId));
      setSelectedCardIds([]);
      setMessage("已提交进贡牌，正在处理其余贡牌。");
    } catch {
      setMessage("所选牌不符合进贡要求。");
    }
  };

  const submitManualReturn = () => {
    const cardId = selectedCardIds[0];
    if (!cardId) return;
    try {
      setSession(submitSouthReturn(session, cardId));
      setSelectedCardIds([]);
      setMessage("已提交还贡牌，下一局开始。");
    } catch {
      setMessage("所选牌不能用于还贡。");
    }
  };

  const toggleCard = (cardId: string) => {
    const selectable = humanCanAct || southManualChoices.includes(cardId);
    if (!selectable) return;
    setSelectedCardIds((current) =>
      current.includes(cardId)
        ? current.filter((id) => id !== cardId)
        : humanCanAct
          ? [...current, cardId]
          : [cardId]
    );
  };

  const moveCard = (movingCardId: string, targetCardId: string) => {
    const nextOrder = moveHumanDisplayCard(hand, movingCardId, targetCardId);
    if (nextOrder === hand) return;
    setSession((current) => setHumanDisplayOrder(current, nextOrder));
    setMessage("已调整手牌显示顺序。");
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
    const nextOrder = [...hand];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    setSession((current) => setHumanDisplayOrder(current, nextOrder));
    setMessage("已调整手牌显示顺序。");
  };

  const startNewGame = () => {
    setSaveBlocked(false);
    setSession(createTableSession(newSeed()));
    setSelectedCardIds([]);
    setMessage("已开始新局。");
  };

  const clearSave = () => {
    void saveStorage.clear().catch(() => undefined);
    startNewGame();
  };

  return (
    <main aria-label="掼蛋牌桌">
      <header>
        <h1>单人本地掼蛋</h1>
        <button
          type="button"
          onClick={() => setRulesOpen((open) => !open)}
          aria-expanded={rulesOpen}
        >
          规则
        </button>
        <button type="button" onClick={startNewGame}>
          新局
        </button>
        <button type="button" onClick={clearSave}>
          清除存档
        </button>
        <button
          type="button"
          aria-pressed={showAllHands}
          onClick={() => setShowAllHands((shown) => !shown)}
        >
          明牌
        </button>
        <button
          type="button"
          aria-pressed={handLayout === "flat"}
          onClick={() => setHandLayout((layout) => (layout === "stacked" ? "flat" : "stacked"))}
        >
          {handLayout === "stacked" ? "横排" : "竖排"}
        </button>
      </header>
      {displayedFinish ? (
        <section className="round-announcement" aria-label="本局结算与下一局提示">
          <span>完成顺序：{displayedFinish.map((seat) => seatName[seat]).join("、")}。</span>
          <strong>{tributeHint}</strong>
        </section>
      ) : null}
      {rulesOpen ? (
        <aside aria-label="规则入口">
          本局规则以项目的 <code>docs/resolved-rules.md</code>{" "}
          为唯一口径；牌型与跟牌均由规则引擎判定。
        </aside>
      ) : null}
      <section className={`table${showAllHands ? " show-all-hands" : ""}`} aria-label="牌桌">
        <section className="match-scoreboard" aria-label="赛局记分与贡牌">
          <span>我方</span>
          <span className="match-token">{session.match.levels.northSouth}</span>
          <span>对方</span>
          <span className="match-token">{session.match.levels.eastWest}</span>
          {tributeSummary.map((summary) => (
            <span className="tribute-token" key={summary}>
              {summary}
            </span>
          ))}
        </section>
        <section className="seat north" aria-label="北家座位">
          <strong>{seatName.north}</strong>
          <span className={game.state.hands.north.length < 10 ? "card-count urgent" : "card-count"}>
            {game.state.hands.north.length}
          </span>
          {showAllHands ? (
            <span className={`revealed-hand card-groups ${handLayout}`} aria-label="北家明牌">
              {revealedHand("north").map((group) => (
                <span className="card-stack" key={group.key}>
                  {group.cardIds.map((cardId, index) => {
                    const card = game.cardsById.get(cardId);
                    return card ? (
                      <CardFace
                        card={card}
                        compact={handLayout === "stacked" && index > 0}
                        key={cardId}
                        levelRank={levelRank}
                      />
                    ) : null;
                  })}
                </span>
              ))}
            </span>
          ) : null}
          <span className="seat-actions">
            {recentActionsFor("north").map((action) =>
              renderAction(action, action === publicPlay("north"))
            )}
          </span>
        </section>
        <section className="seat east" aria-label="东家座位">
          <strong>{seatName.east}</strong>
          <span className={game.state.hands.east.length < 10 ? "card-count urgent" : "card-count"}>
            {game.state.hands.east.length}
          </span>
          {showAllHands ? (
            <span className={`revealed-hand card-groups ${handLayout}`} aria-label="东家明牌">
              {revealedHand("east").map((group) => (
                <span className="card-stack" key={group.key}>
                  {group.cardIds.map((cardId, index) => {
                    const card = game.cardsById.get(cardId);
                    return card ? (
                      <CardFace
                        card={card}
                        compact={handLayout === "stacked" && index > 0}
                        key={cardId}
                        levelRank={levelRank}
                      />
                    ) : null;
                  })}
                </span>
              ))}
            </span>
          ) : null}
          <span className="seat-actions east-actions">
            {recentActionsFor("east").map((action) =>
              renderAction(action, action === publicPlay("east"))
            )}
          </span>
        </section>
        <section className="table-info" aria-label="桌面信息">
          <p>轮到：{seatName[game.state.current]}</p>
          <p>
            {game.state.highestSeat
              ? `当前牌由${seatName[game.state.highestSeat]}压住。`
              : "当前为领出。"}
          </p>
          <p className="table-status" role="status">
            {message}
          </p>
        </section>
        <section className="seat west" aria-label="西家座位">
          <strong>{seatName.west}</strong>
          <span className={game.state.hands.west.length < 10 ? "card-count urgent" : "card-count"}>
            {game.state.hands.west.length}
          </span>
          {showAllHands ? (
            <span className={`revealed-hand card-groups ${handLayout}`} aria-label="西家明牌">
              {revealedHand("west").map((group) => (
                <span className="card-stack" key={group.key}>
                  {group.cardIds.map((cardId, index) => {
                    const card = game.cardsById.get(cardId);
                    return card ? (
                      <CardFace
                        card={card}
                        compact={handLayout === "stacked" && index > 0}
                        key={cardId}
                        levelRank={levelRank}
                      />
                    ) : null;
                  })}
                </span>
              ))}
            </span>
          ) : null}
          <span className="seat-actions west-actions">
            {recentActionsFor("west").map((action) =>
              renderAction(action, action === publicPlay("west"))
            )}
          </span>
        </section>
        <span className="seat-actions south-actions">
          {recentActionsFor(HUMAN_SEAT).map((action) =>
            renderAction(action, action === publicPlay(HUMAN_SEAT))
          )}
        </span>
        {game.state.completed ? null : (
          <section className="human-seat" aria-label="你的手牌">
            <section aria-label="操作">
              <button
                type="button"
                onClick={() => submit({ type: "pass", actor: HUMAN_SEAT })}
                disabled={!humanCanAct || !canPass}
              >
                过牌
              </button>
              <button
                type="button"
                onClick={() => {
                  const hint = chooseTableHintAction(game);
                  if (!hint || hint.type !== "play") {
                    setMessage("规则引擎没有提供可提示的出牌。");
                    return;
                  }
                  setSelectedCardIds(hint.cardIds);
                  setMessage(`提示：可出${formatInterpretation(hint.interpretation)}。`);
                }}
                disabled={!humanCanAct}
              >
                提示
              </button>
              <button
                type="button"
                onClick={() => submit(selectedActions[0])}
                disabled={!humanCanAct || selectedActions.length === 0}
              >
                出牌
                {selectedActions[0]?.type === "play"
                  ? `（${formatInterpretation(selectedActions[0].interpretation)}）`
                  : ""}
              </button>
              {awaitingSouthTribute ? (
                <button
                  type="button"
                  onClick={submitManualTribute}
                  disabled={selectedCardIds.length !== 1}
                >
                  确认进贡
                </button>
              ) : null}
              {awaitingSouthReturn ? (
                <button
                  type="button"
                  onClick={submitManualReturn}
                  disabled={selectedCardIds.length !== 1}
                >
                  确认还贡
                </button>
              ) : null}
            </section>
            <div className={`card-groups human-hand ${handLayout}`}>
              {handGroups.map((group) => (
                <span className="card-stack" key={group.key}>
                  {group.cardIds.map((cardId, index) => {
                    const card = game.cardsById.get(cardId);
                    if (!card) return null;
                    const selected = selectedCardIds.includes(cardId);
                    return (
                      <button
                        key={cardId}
                        type="button"
                        className="hand-card"
                        aria-pressed={selected}
                        aria-label={`选择${formatCard(card)}`}
                        aria-describedby="hand-arrangement-help"
                        data-card-id={cardId}
                        disabled={!humanCanAct && !southManualChoices.includes(cardId)}
                        draggable={humanCanAct}
                        onClick={() => toggleCard(cardId)}
                        onDragStart={(event) => dragStart(event, cardId)}
                        onDragEnd={() => setDraggingCardId(undefined)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => dropOnCard(event, cardId)}
                        onKeyDown={(event) => reorderWithKeyboard(event, cardId)}
                      >
                        <CardFace
                          card={card}
                          compact={handLayout === "stacked" && index > 0}
                          levelRank={levelRank}
                        />
                      </button>
                    );
                  })}
                </span>
              ))}
            </div>
            <div className="human-footer">
              <p id="hand-arrangement-help">
                已按牌面自动整理。可拖拽牌到另一张牌前方理牌；也可按 Alt 加左右方向键移动当前牌。
              </p>
              <span className={hand.length < 10 ? "card-count urgent" : "card-count"}>
                {hand.length}
              </span>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
