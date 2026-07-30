import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  groupHumanDisplayCards,
  groupOrderedDisplayCards,
  moveHumanDisplayCard,
  reconcileHumanDisplayOrder,
  type Card,
  type Seat,
  type TurnAction
} from "@card-game/guandan-core";
import {
  createDisplayPositions,
  teammateOf,
  type HandViewGroup,
  type TableInteractionCallbacks,
  type TablePublicAction,
  type TableViewModel
} from "../components/table/table-contract";
import { useCardSelection } from "../components/table/useCardSelection";
import type { GameProjection, RoomProjection } from "./client";

function sameCardIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cardId) => right.includes(cardId));
}

function playerNames(seats: RoomProjection["seats"]): Record<Seat, string> {
  const bots = seats.filter((seat) => seat.controller === "bot");
  return Object.fromEntries(
    seats.map((seat) => [
      seat.seat,
      seat.controller === "human"
        ? (seat.displayName ?? "玩家")
        : `机器人${String.fromCharCode("A".charCodeAt(0) + Math.max(0, bots.indexOf(seat)))}`
    ])
  ) as Record<Seat, string>;
}

function publicAction(
  action: NonNullable<GameProjection["publicActions"]>[number]
): TablePublicAction {
  return {
    key: `${action.actor}:${action.type}:${action.cards.map((card) => card.id).join(",")}`,
    ariaLabel: action.type === "pass" ? "不要" : "已出牌",
    pass: action.type === "pass",
    // Authority projects only the active trick's already-public card faces.
    // The shared view never reconstructs them from a private hand projection.
    cards: action.cards.map((card) => ({
      card,
      wildcardAs: action.wildcardAs[card.id]
    }))
  };
}

export interface MultiplayerTableAdapter {
  readonly model: TableViewModel;
  readonly callbacks: TableInteractionCallbacks;
  readonly handDrag: {
    readonly onTouchEnd: (event: React.TouchEvent<HTMLButtonElement>, cardId: string) => void;
    readonly onDragStart: (event: DragEvent<HTMLButtonElement>, cardId: string) => void;
    readonly onDragEnd: () => void;
    readonly onDrop: (event: DragEvent<HTMLButtonElement>, cardId: string) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, cardId: string) => void;
  };
  readonly levelRank: Card["rank"];
  readonly canAct: boolean;
  readonly isTrickCompletionVisible: boolean;
  readonly selectionStatus: string;
}

export function useMultiplayerTableAdapter({
  game,
  seats,
  handLayout,
  isActionPending,
  onSubmitPlay,
  onSubmitPass,
  onChangeLayout,
  onRefreshLegalActions
}: {
  readonly game: GameProjection;
  readonly seats: RoomProjection["seats"];
  readonly handLayout: "stacked" | "flat";
  readonly isActionPending: boolean;
  readonly onSubmitPlay: (cardIds: readonly string[]) => void;
  readonly onSubmitPass: () => void;
  readonly onChangeLayout: (layout: "stacked" | "flat") => void;
  readonly onRefreshLegalActions?: () => Promise<void>;
}): MultiplayerTableAdapter {
  const handIds = useMemo(() => game.hand.map((card) => card.id), [game.hand]);
  const { selectedCardIds, clearSelection, toggleCard } = useCardSelection(handIds);
  const [displayOrder, setDisplayOrder] = useState<readonly string[]>();
  const draggingCardId = useRef<string | undefined>(undefined);
  const staleSelection = useRef<string | undefined>(undefined);
  const tributeAction = game.tributeAction;
  const isTributePending = tributeAction !== undefined;
  const completedTrickKey = game.completedTrickActions?.length
    ? `${game.gameId ?? "current"}:${game.eventSequence}`
    : undefined;
  const completedTrickKeyRef = useRef<string | undefined>(undefined);
  const completedTrickSourceRef = useRef(game.completedTrickActions);
  completedTrickSourceRef.current = game.completedTrickActions;
  const [completedTrickActions, setCompletedTrickActions] =
    useState<GameProjection["completedTrickActions"]>();
  useEffect(() => {
    if (!completedTrickKey) {
      setCompletedTrickActions(undefined);
      return;
    }
    if (completedTrickKeyRef.current === completedTrickKey) return;
    const actions = completedTrickSourceRef.current;
    if (!actions?.length) return;
    completedTrickKeyRef.current = completedTrickKey;
    setCompletedTrickActions(actions);
    const timer = window.setTimeout(() => setCompletedTrickActions(undefined), 900);
    return () => window.clearTimeout(timer);
  }, [completedTrickKey]);
  const isTrickCompletionVisible = completedTrickActions !== undefined;
  const canAct = game.current === game.seat && !isTributePending && !isTrickCompletionVisible;
  const canSelect = canAct || isTributePending;
  const cardsById = useMemo(() => new Map(game.hand.map((card) => [card.id, card])), [game.hand]);
  const orderedIds = useMemo(
    () => reconcileHumanDisplayOrder(displayOrder, handIds, cardsById, game.levelRank ?? "2"),
    [cardsById, displayOrder, game.levelRank, handIds]
  );
  const ownHand = useMemo<readonly HandViewGroup[]>(() => {
    const groups = displayOrder
      ? groupOrderedDisplayCards(orderedIds, cardsById)
      : groupHumanDisplayCards(orderedIds, cardsById, game.levelRank ?? "2");
    return groups.map((group) => ({
      key: group.key,
      cards: group.cardIds
        .map((cardId) => cardsById.get(cardId))
        .filter((card): card is Card => !!card)
    }));
  }, [cardsById, displayOrder, game.levelRank, orderedIds]);
  const selectedPlay = game.legalActions?.find(
    (action): action is Extract<TurnAction, { readonly type: "play" }> =>
      action.type === "play" && sameCardIds(action.cardIds, selectedCardIds)
  );
  const canPass = canAct && game.legalActions?.some((action) => action.type === "pass") === true;

  useEffect(() => {
    if (!canSelect) clearSelection();
  }, [canSelect, clearSelection, game.eventSequence]);
  // Authority keeps the same game ID and physical card IDs for the whole match.
  // A fresh deal must not inherit the player's visual ordering from the prior round.
  useEffect(() => setDisplayOrder(undefined), [game.gameId, game.match?.roundNumber]);
  useEffect(() => {
    if (
      !onRefreshLegalActions ||
      !canAct ||
      game.current !== game.leader ||
      selectedCardIds.length !== 1 ||
      selectedPlay
    )
      return;
    const key = `${game.gameId ?? "current"}:${game.eventSequence}:${selectedCardIds[0]}`;
    if (staleSelection.current === key) return;
    staleSelection.current = key;
    void onRefreshLegalActions();
  }, [canAct, game, onRefreshLegalActions, selectedCardIds, selectedPlay]);

  const publicActions = useMemo(() => {
    const mapped = (completedTrickActions ?? game.publicActions)?.map(publicAction) ?? [];
    return Object.fromEntries(
      (["south", "east", "north", "west"] as const).map((seat) => [
        seat,
        mapped.filter((action) => action.key.startsWith(`${seat}:`)).slice(-1)
      ])
    ) as unknown as Record<Seat, readonly TablePublicAction[]>;
  }, [completedTrickActions, game.publicActions]);
  const highestPlay = game.highestPlay
    ? {
        key: `highest:${game.highestPlay.actor}:${game.eventSequence}`,
        ariaLabel: "当前最高牌",
        pass: false,
        cards: game.highestPlay.cards.map((card) => ({
          card,
          wildcardAs: game.highestPlay!.wildcardAs[card.id]
        }))
      }
    : undefined;
  const moveCard = (movingCardId: string, targetCardId: string) => {
    const next = moveHumanDisplayCard(orderedIds, movingCardId, targetCardId);
    if (next !== orderedIds) setDisplayOrder(next);
  };
  const callbacks: TableInteractionCallbacks = {
    onToggleCard: (cardId) => {
      if (canSelect && !isActionPending) toggleCard(cardId, true);
    },
    onPlay: (cardIds) => {
      // `legalActions` is an Authority-projected candidate catalogue, not a
      // complete local rule oracle for every physical selection. Forward the
      // user's exact IDs and let Authority perform the sole legality decision.
      if (!isActionPending && canAct && cardIds.length > 0) onSubmitPlay(cardIds);
    },
    onPass: () => {
      if (!isActionPending && canPass) onSubmitPass();
    },
    onHint: () => {
      const hint = game.legalActions?.find((action) => action.type === "play");
      if (hint?.type === "play") {
        clearSelection();
        hint.cardIds.forEach((cardId) => toggleCard(cardId, true));
      }
    },
    onReorderCard: moveCard,
    onChangeLayout
  };
  const model: TableViewModel = {
    viewerLogicalSeat: game.seat,
    displayPositions: createDisplayPositions(game.seat),
    ownHand,
    selectedCardIds,
    selectableCardIds: !isActionPending
      ? isTributePending
        ? tributeAction.cardIds
        : canAct
          ? handIds
          : []
      : [],
    remainingCardCounts: game.remainingCardCounts,
    publicActions,
    highestPlay,
    currentActorSeat: game.current,
    teammateSeat: teammateOf(game.seat),
    canPlay: isTributePending
      ? selectedCardIds.length === 1 && tributeAction.cardIds.includes(selectedCardIds[0])
      : canAct && selectedCardIds.length > 0,
    canPass,
    canHint: canAct && game.legalActions?.some((action) => action.type === "play") === true,
    isActionPending,
    playerNames: playerNames(seats),
    gamePhase: game.finished?.length === 4 ? "completed" : "playing",
    handLayout
  };
  return {
    model,
    callbacks,
    handDrag: {
      onTouchEnd: () => undefined,
      onDragStart: (event, cardId) => {
        event.dataTransfer.setData("text/plain", cardId);
        event.dataTransfer.effectAllowed = "move";
        draggingCardId.current = cardId;
      },
      onDragEnd: () => {
        draggingCardId.current = undefined;
      },
      onDrop: (event, targetCardId) => {
        event.preventDefault();
        const movingCardId = event.dataTransfer.getData("text/plain") || draggingCardId.current;
        if (movingCardId) moveCard(movingCardId, targetCardId);
        draggingCardId.current = undefined;
      },
      onKeyDown: (event, cardId) => {
        if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        const index = orderedIds.indexOf(cardId);
        const target = orderedIds[index + (event.key === "ArrowLeft" ? -1 : 1)];
        if (!target) return;
        event.preventDefault();
        moveCard(cardId, target);
      }
    },
    levelRank: game.levelRank ?? "2",
    canAct,
    isTrickCompletionVisible,
    selectionStatus: isTributePending
      ? selectedCardIds.length === 0
        ? tributeAction.kind === "return"
          ? "请选择一张不大于 10 的牌还贡。"
          : "请选择最大的牌进贡。"
        : `已选择 ${selectedCardIds.length} 张牌，确认后提交给服务端。`
      : isTrickCompletionVisible
        ? "本墩全员不要，正在结墩。"
        : !canAct
          ? `等待${model.playerNames[game.current]}出牌。`
          : selectedCardIds.length === 0
            ? "请选择要出的牌。"
            : `已选择 ${selectedCardIds.length} 张牌，可以提交给服务端判定。`
  };
}
