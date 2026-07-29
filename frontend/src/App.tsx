import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type TouchEvent
} from "react";
import "./App.css";
import type { Seat } from "@card-game/guandan-core";
import { createIndexedDbStorage, type StorageBoundary } from "./platform/storage";
import {
  chooseTableHintAction,
  chooseTableBotAction,
  formatCard,
  formatInterpretation,
  getSelectedPlayActions,
  type TableGame
} from "@card-game/guandan-core";
import {
  applyTableSessionAction,
  createTableSession,
  getSouthReturnChoices,
  getSouthTributeChoices,
  prepareNextTableSession,
  restartCurrentTableSession,
  restoreTableSession,
  serializeTableSession,
  setHumanDisplayOrder,
  submitSouthReturn,
  submitSouthTribute,
  type TableSave,
  type TableSession
} from "@card-game/guandan-core";
import {
  groupHumanDisplayCards,
  groupOrderedDisplayCards,
  moveHumanDisplayCard,
  reconcileHumanDisplayOrder,
  sortPlayedCards
} from "@card-game/guandan-core";
import type { TurnAction } from "@card-game/guandan-core";
import {
  actionFromPublicEvent,
  latestRecentActionLayerBySeat,
  latestRecentActionsBySeat
} from "@card-game/guandan-core";
import { botThinkDelayMs } from "@card-game/guandan-core";
import { registerPwaServiceWorker } from "./pwa/service-worker";
import { MultiplayerApp } from "./multiplayer/MultiplayerApp";
import type { MultiplayerClient } from "./multiplayer/client";
import { ActionControls } from "./components/table/ActionControls";
import { CardFace, PlayerCardCount } from "./components/table/CardFace";
import { HandView, type HandViewGroup } from "./components/table/HandView";
import { PublicActions, type PublicActionView } from "./components/table/PublicActions";
import { SeatView } from "./components/table/SeatView";
import { TableView } from "./components/table/TableView";
import { useCardSelection } from "./components/table/useCardSelection";
import {
  createDisplayPositions,
  teammateOf,
  type TableInteractionCallbacks,
  type TableViewModel
} from "./components/table/table-contract";

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

function levelTeam(seat: Seat): "northSouth" | "eastWest" {
  return seat === "north" || seat === "south" ? "northSouth" : "eastWest";
}

function antiTributeReason(game: TableGame, proof: readonly string[]): string {
  const counts = new Map<Seat, number>();
  for (const cardId of proof) {
    const seat = (["east", "south", "west", "north"] as const).find((candidate) =>
      game.state.hands[candidate].includes(cardId)
    );
    if (seat) counts.set(seat, (counts.get(seat) ?? 0) + 1);
  }
  return [...counts]
    .map(([seat, count]) => `${seatShortName[seat]}${count === 2 ? "两个" : "一个"}大王`)
    .join("，");
}

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function sameCardIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cardId) => right.includes(cardId));
}

function defaultStorage(): StorageBoundary<TableSave> {
  return createIndexedDbStorage<TableSave>({
    databaseName: "card-game",
    storeName: "saves",
    key: "guandan-current"
  });
}

export { CardFace, PlayerCardCount } from "./components/table/CardFace";

function SoloApp({
  storage,
  onExit
}: {
  readonly storage?: StorageBoundary<TableSave>;
  readonly onExit: () => void;
}) {
  const saveStorage = useMemo(() => storage ?? defaultStorage(), [storage]);
  const [session, setSession] = useState<TableSession>(() => createTableSession(newSeed()));
  const game: TableGame = session.game;
  const {
    selectedCardIds,
    setSelectedCardIds,
    clearSelection,
    toggleCard: updateCardSelection
  } = useCardSelection(game.state.hands[HUMAN_SEAT]);
  const [message, setMessage] = useState("请选择手牌后出牌。");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string>();
  const [showAllHands, setShowAllHands] = useState(false);
  const [handLayout, setHandLayout] = useState<HandLayout>("stacked");
  const [applyPwaUpdate, setApplyPwaUpdate] = useState<() => void>();
  const [botThinking, setBotThinking] = useState(false);
  const levelRank = game.levelRank ?? session.match.levelRank;
  const finishIndex = (seat: Seat) => game.state.finished.indexOf(seat);

  useEffect(() => {
    let active = true;
    void saveStorage
      .load()
      .then((save) => {
        if (!active || !save) return;
        setSession(restoreTableSession(save));
        clearSelection();
        setMessage("已继续上次未完成的对局。");
      })
      .catch(() => {
        if (!active) return;
        setSaveBlocked(true);
        setMessage("存档不兼容或恢复失败；请重新开赛。");
      })
      .finally(() => {
        if (active) setStorageReady(true);
      });
    return () => {
      active = false;
    };
  }, [clearSelection, saveStorage]);

  useEffect(() => {
    if (!storageReady || saveBlocked) return;
    void saveStorage.save(serializeTableSession(session)).catch(() => undefined);
  }, [saveBlocked, saveStorage, session, storageReady]);

  useEffect(() => {
    void registerPwaServiceWorker({
      onUpdateAvailable: (applyUpdate) => setApplyPwaUpdate(() => applyUpdate),
      onControllerChange: () => window.location.reload()
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (
      game.state.completed ||
      session.match.tributePhase !== "ready" ||
      game.state.current === HUMAN_SEAT
    )
      return;
    setBotThinking(true);
    const timer = window.setTimeout(() => {
      const action = chooseTableBotAction(game);
      setBotThinking(false);
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
        clearSelection();
        setMessage("本局已结算，正在准备下一局。");
      } catch {
        setMessage("下一局准备失败，请开始新局。");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clearSelection, game.state.completed]);

  const hand = reconcileHumanDisplayOrder(
    session.humanDisplayOrder,
    game.state.hands[HUMAN_SEAT],
    game.cardsById,
    levelRank
  );
  const handGroups = session.humanDisplayOrder
    ? groupOrderedDisplayCards(hand, game.cardsById)
    : groupHumanDisplayCards(hand, game.cardsById, levelRank);
  const handViewGroups: readonly HandViewGroup[] = handGroups.map((group) => ({
    key: group.key,
    cards: group.cardIds.flatMap((cardId) => {
      const card = game.cardsById.get(cardId);
      return card ? [card] : [];
    })
  }));
  const selectedActions = getSelectedPlayActions(game, selectedCardIds);
  const canPass = game.state.current === HUMAN_SEAT && game.state.highest !== undefined;
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
  const recentActionLayers = latestRecentActionLayerBySeat(game.publicEvents);
  const recentActionsFor = (seat: Seat) => recentActions.filter((action) => action.actor === seat);

  const publicActionViewsFor = (seat: Seat): readonly PublicActionView[] =>
    recentActionsFor(seat).map((action) => ({
      key: `${action.actor}-${action.type}-${action.type === "play" ? action.cardIds.join("-") : "pass"}`,
      ariaLabel: `${seatName[action.actor]}${action === publicPlay(seat) ? "当前出牌" : "最近出牌"}`,
      pass: action.type === "pass",
      cards:
        action.type === "pass"
          ? []
          : sortPlayedCards(
              action.cardIds,
              game.cardsById,
              levelRank,
              action.interpretation
            ).flatMap((cardId) => {
              const card = game.cardsById.get(cardId);
              return card ? [{ card, wildcardAs: action.interpretation.wildcardAs[cardId] }] : [];
            })
    }));

  const submit = (action: TurnAction) => {
    const result = applyTableSessionAction(session, action);
    if (!result.ok) {
      setMessage(`规则引擎拒绝此动作：${result.code}`);
      return;
    }
    setSession(result.session);
    clearSelection();
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
  const activeLevelTeam = levelTeam(session.match.previousFinish?.[0] ?? session.match.leader);
  const antiTributeProof = antiTributeReason(game, session.match.tributePlan.proof);
  const tributeHint = (() => {
    if (!session.match.previousFinish) return "首局由南家先出";
    if (session.match.tributePlan.antiTribute)
      return `本局抗贡，无需进贡${antiTributeProof ? `（${antiTributeProof}）` : ""}`;
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
      clearSelection();
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
      clearSelection();
      setMessage("已提交还贡牌，下一局开始。");
    } catch {
      setMessage("所选牌不能用于还贡。");
    }
  };

  const toggleCard = (cardId: string) => {
    const selectable = humanCanAct || southManualChoices.includes(cardId);
    if (!selectable) return;
    updateCardSelection(cardId, humanCanAct);
  };

  const selectCardWithTouch = (event: TouchEvent<HTMLButtonElement>, cardId: string) => {
    event.preventDefault();
    toggleCard(cardId);
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

  const restartMatch = () => {
    setSaveBlocked(false);
    setSession(createTableSession(newSeed()));
    clearSelection();
    setMessage("已重新开赛，双方从 2 级开始。");
  };

  const restartCurrentRound = () => {
    setSession(restartCurrentTableSession(session, newSeed()));
    clearSelection();
    setMessage("已重新发当前局手牌，贡牌和先手已重新计算。");
  };

  const displayPositions = createDisplayPositions(HUMAN_SEAT);
  const tableViewModel: TableViewModel = {
    viewerLogicalSeat: HUMAN_SEAT,
    displayPositions,
    ownHand: handViewGroups,
    selectedCardIds,
    selectableCardIds: humanCanAct ? hand : southManualChoices,
    remainingCardCounts: {
      south: game.state.hands.south.length,
      east: game.state.hands.east.length,
      north: game.state.hands.north.length,
      west: game.state.hands.west.length
    },
    publicActions: {
      south: publicActionViewsFor("south"),
      east: publicActionViewsFor("east"),
      north: publicActionViewsFor("north"),
      west: publicActionViewsFor("west")
    },
    highestPlay: highestPlay ? publicActionViewsFor(highestPlay.actor).at(0) : undefined,
    currentActorSeat: game.state.current,
    teammateSeat: teammateOf(HUMAN_SEAT),
    canPlay: humanCanAct && selectedActions.length > 0,
    canPass: humanCanAct && canPass,
    canHint: humanCanAct,
    isActionPending: false,
    playerNames: seatName,
    gamePhase: game.state.completed
      ? "completed"
      : session.match.tributePhase === "ready"
        ? "playing"
        : "tribute",
    handLayout
  };
  const tableInteractions: TableInteractionCallbacks = {
    onToggleCard: toggleCard,
    onPlay: (cardIds) => {
      const action = selectedActions.find(
        (candidate) => candidate.type === "play" && sameCardIds(candidate.cardIds, cardIds)
      );
      if (!action) {
        setMessage("所选牌已失效，请重新选择。");
        return;
      }
      submit(action);
    },
    onPass: () => submit({ type: "pass", actor: HUMAN_SEAT }),
    onHint: () => {
      const hint = chooseTableHintAction(game);
      if (!hint || hint.type !== "play") {
        setMessage("规则引擎没有提供可提示的出牌。");
        return;
      }
      setSelectedCardIds(hint.cardIds);
      setMessage(`提示：可出${formatInterpretation(hint.interpretation)}。`);
    },
    onReorderCard: moveCard,
    onChangeLayout: setHandLayout
  };

  return (
    <main aria-label="掼蛋牌桌">
      <header>
        <div className="game-title">
          <h1>单人本地掼蛋</h1>
          <span className="preview-profile" aria-label="机器人策略">
            （策略：普通 normal-vNext）
          </span>
        </div>
        <button
          type="button"
          onClick={() => setRulesOpen((open) => !open)}
          aria-expanded={rulesOpen}
        >
          规则
        </button>
        <button type="button" onClick={restartMatch}>
          重新开赛
        </button>
        <button type="button" onClick={restartCurrentRound}>
          重开本局
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
          onClick={() =>
            tableInteractions.onChangeLayout(handLayout === "stacked" ? "flat" : "stacked")
          }
        >
          {handLayout === "stacked" ? "横排" : "竖排"}
        </button>
        <button type="button" onClick={onExit}>
          退出
        </button>
      </header>
      {applyPwaUpdate ? (
        <section className="pwa-update" role="status" aria-label="应用更新提示">
          <span>发现新版本，更新后将重新加载牌桌。</span>
          <button type="button" onClick={applyPwaUpdate}>
            更新
          </button>
        </section>
      ) : null}
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
      <TableView showAllHands={showAllHands} model={tableViewModel}>
        <section className="match-scoreboard" aria-label="赛局记分与贡牌">
          <span>我方</span>
          <span className={`match-token${activeLevelTeam === "northSouth" ? "" : " inactive"}`}>
            {session.match.levels.northSouth}
          </span>
          <span>对方</span>
          <span className={`match-token${activeLevelTeam === "eastWest" ? "" : " inactive"}`}>
            {session.match.levels.eastWest}
          </span>
          {tributeSummary.map((summary) => (
            <span className="tribute-token" key={summary}>
              {summary}
            </span>
          ))}
        </section>
        <SeatView
          className="seat north"
          ariaLabel="北家座位"
          zIndex={recentActionLayers.get("north") ?? 0}
          name={tableViewModel.playerNames.north}
          handSize={tableViewModel.remainingCardCounts.north}
          finishIndex={finishIndex("north")}
        >
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
          <PublicActions
            actions={tableViewModel.publicActions.north}
            className="seat-actions"
            levelRank={levelRank}
          />
        </SeatView>
        <SeatView
          className="seat east"
          ariaLabel="东家座位"
          zIndex={recentActionLayers.get("east") ?? 0}
          name={tableViewModel.playerNames.east}
          handSize={tableViewModel.remainingCardCounts.east}
          finishIndex={finishIndex("east")}
        >
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
          <PublicActions
            actions={tableViewModel.publicActions.east}
            className="seat-actions east-actions"
            levelRank={levelRank}
          />
        </SeatView>
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
          {botThinking ? (
            <p className="bot-thinking" role="status">
              normal-vNext 正在思考…
            </p>
          ) : null}
        </section>
        <SeatView
          className="seat west"
          ariaLabel="西家座位"
          zIndex={recentActionLayers.get("west") ?? 0}
          name={tableViewModel.playerNames.west}
          handSize={tableViewModel.remainingCardCounts.west}
          finishIndex={finishIndex("west")}
        >
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
          <PublicActions
            actions={tableViewModel.publicActions.west}
            className="seat-actions west-actions"
            levelRank={levelRank}
          />
        </SeatView>
        <PublicActions
          actions={tableViewModel.publicActions.south}
          className="seat-actions south-actions"
          levelRank={levelRank}
          style={{ zIndex: recentActionLayers.get(HUMAN_SEAT) ?? 0 }}
        />
        {game.state.completed ? null : (
          <section className="human-seat" aria-label="你的手牌">
            <ActionControls
              canPass={tableViewModel.canPass}
              canPlay={tableViewModel.canPlay}
              canHint={tableViewModel.canHint}
              isActionPending={tableViewModel.isActionPending}
              selectedCardIds={tableViewModel.selectedCardIds}
              onPass={tableInteractions.onPass}
              onHint={tableInteractions.onHint}
              onPlay={tableInteractions.onPlay}
              playLabel={
                <>
                  出牌
                  {selectedActions[0]?.type === "play"
                    ? `（${formatInterpretation(selectedActions[0].interpretation)}）`
                    : ""}
                </>
              }
            >
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
            </ActionControls>
            <HandView
              groups={tableViewModel.ownHand}
              handLayout={tableViewModel.handLayout}
              selectedCardIds={tableViewModel.selectedCardIds}
              selectableCardIds={tableViewModel.selectableCardIds}
              draggable={humanCanAct}
              levelRank={levelRank}
              onToggleCard={tableInteractions.onToggleCard}
              onTouchEnd={selectCardWithTouch}
              onDragStart={dragStart}
              onDragEnd={() => setDraggingCardId(undefined)}
              onDrop={dropOnCard}
              onKeyDown={reorderWithKeyboard}
            />
            <div className="human-footer">
              <p id="hand-arrangement-help">
                已按牌面自动整理。可拖拽牌到另一张牌前方理牌；也可按 Alt 加左右方向键移动当前牌。
              </p>
              <PlayerCardCount handSize={hand.length} finishIndex={finishIndex(HUMAN_SEAT)} />
            </div>
          </section>
        )}
      </TableView>
    </main>
  );
}

function HomePage({
  onSelectSolo,
  onSelectMultiplayer
}: {
  readonly onSelectSolo: () => void;
  readonly onSelectMultiplayer: () => void;
}) {
  return (
    <main className="game-home" aria-label="掼蛋游戏首页">
      <h1>掼蛋游戏</h1>
      <div className="game-home-actions">
        <button type="button" onClick={onSelectSolo}>
          单人掼蛋游戏
        </button>
        <button type="button" onClick={onSelectMultiplayer}>
          多人掼蛋游戏
        </button>
      </div>
    </main>
  );
}

/** The local save boundary is mounted only for the single-player application. */
export function App({
  storage,
  multiplayerClient,
  initialMode = "home"
}: {
  readonly storage?: StorageBoundary<TableSave>;
  readonly multiplayerClient?: MultiplayerClient;
  readonly initialMode?: "home" | "solo" | "multiplayer";
}) {
  const initialRoomId = new URLSearchParams(window.location.search).get("room") ?? undefined;
  const [mode, setMode] = useState<"home" | "solo" | "multiplayer">(
    initialRoomId ? "multiplayer" : initialMode
  );
  const setOnlineRoom = (roomId: string | undefined) => {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set("room", roomId);
    else url.searchParams.delete("room");
    window.history.replaceState(undefined, "", url);
  };
  if (mode === "multiplayer")
    return (
      <MultiplayerApp
        client={multiplayerClient}
        initialRoomId={initialRoomId}
        onRoomChange={setOnlineRoom}
        onExit={() => {
          setOnlineRoom(undefined);
          setMode("home");
        }}
      />
    );
  if (mode === "home")
    return (
      <HomePage
        onSelectSolo={() => setMode("solo")}
        onSelectMultiplayer={() => setMode("multiplayer")}
      />
    );
  return (
    <>
      <SoloApp storage={storage} onExit={() => setMode("home")} />
    </>
  );
}
