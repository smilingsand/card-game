import { ActionControls } from "../components/table/ActionControls";
import { HandView } from "../components/table/HandView";
import { PublicActions } from "../components/table/PublicActions";
import { SeatView } from "../components/table/SeatView";
import { TableView } from "../components/table/TableView";
import type { GameProjection, RoomProjection } from "./client";
import { useMultiplayerTableAdapter } from "./useMultiplayerTableAdapter";

export function MultiplayerTable({
  game,
  seats,
  handLayout,
  actionPending,
  notice,
  onPlay,
  onPass,
  onTribute = () => undefined,
  onChangeLayout = () => undefined,
  onStaleLeadingSelection
}: {
  readonly game: GameProjection;
  readonly seats: RoomProjection["seats"];
  readonly handLayout: "stacked" | "flat";
  readonly actionPending: boolean;
  readonly notice: string;
  readonly onPlay: (cardIds: readonly string[]) => void;
  readonly onPass: () => void;
  readonly onTribute?: (kind: "tribute" | "return", cardId: string) => void;
  readonly onChangeLayout?: (layout: "stacked" | "flat") => void;
  readonly onStaleLeadingSelection?: () => Promise<void>;
}) {
  const adapter = useMultiplayerTableAdapter({
    game,
    seats,
    handLayout,
    isActionPending: actionPending,
    onSubmitPlay: onPlay,
    onSubmitPass: onPass,
    onChangeLayout,
    onRefreshLegalActions: onStaleLeadingSelection
  });
  const { model, callbacks } = adapter;
  const positionClass = { top: "north", left: "west", right: "east" } as const;
  const viewerTeam =
    model.viewerLogicalSeat === "south" || model.viewerLogicalSeat === "north"
      ? "northSouth"
      : "eastWest";
  const opponentTeam = viewerTeam === "northSouth" ? "eastWest" : "northSouth";
  return (
    <section aria-label="个人牌局视图" className="multiplayer-game multiplayer-table-game">
      <TableView showAllHands={false} model={model} ariaLabel="多人牌桌">
        {game.match ? (
          <section className="match-scoreboard" aria-label="赛局记分与贡牌">
            <span>我方</span>
            <span
              className={`match-token${game.match.activeLevelTeam === viewerTeam ? "" : " inactive"}`}
            >
              {game.match.levels[viewerTeam]}
            </span>
            <span>对方</span>
            <span
              className={`match-token${game.match.activeLevelTeam === opponentTeam ? "" : " inactive"}`}
            >
              {game.match.levels[opponentTeam]}
            </span>
            {game.match.tributeSummary.map((summary) => (
              <span className="tribute-token" key={summary}>
                {summary}
              </span>
            ))}
          </section>
        ) : null}
        {(["top", "left", "right"] as const).map((position) => {
          const logicalSeat = Object.entries(model.displayPositions).find(
            ([, display]) => display === position
          )?.[0] as keyof typeof model.displayPositions;
          return (
            <SeatView
              key={position}
              ariaLabel={`${position} 座位`}
              className={`seat ${positionClass[position]}`}
              zIndex={1}
              name={model.playerNames[logicalSeat]}
              handSize={model.remainingCardCounts[logicalSeat]}
              finishIndex={game.finished?.indexOf(logicalSeat) ?? -1}
            >
              <PublicActions
                actions={model.publicActions[logicalSeat]}
                className="seat-actions"
                levelRank={adapter.levelRank}
              />
            </SeatView>
          );
        })}
        <section className="table-info" aria-label="桌面信息">
          <p>轮到：{model.playerNames[model.currentActorSeat]}</p>
          <p>
            {model.highestPlay
              ? `当前牌由${model.playerNames[game.highestPlay!.actor]}压住。`
              : `${model.playerNames[game.leader ?? game.seat]}领出。`}
          </p>
          <p className="table-status" role="status">
            {game.highestPlay?.patternLabel ? `已出${game.highestPlay.patternLabel}。` : notice}
          </p>
        </section>
        <PublicActions
          actions={model.publicActions[model.viewerLogicalSeat]}
          className="seat-actions south-actions"
          levelRank={adapter.levelRank}
        />
        <section className="human-seat" aria-label="你的手牌">
          <ActionControls
            canPlay={model.canPlay}
            canPass={model.canPass}
            canHint={model.canHint}
            isActionPending={model.isActionPending}
            selectedCardIds={model.selectedCardIds}
            onPlay={(cardIds) => {
              if (game.tributeAction && cardIds.length === 1)
                onTribute(game.tributeAction.kind, cardIds[0]);
              else callbacks.onPlay(cardIds);
            }}
            onPass={callbacks.onPass}
            onHint={callbacks.onHint}
            playLabel={
              game.tributeAction
                ? game.tributeAction.kind === "return"
                  ? "确认还贡"
                  : "确认进贡"
                : undefined
            }
          />
          <p className="selected-play-status" aria-live="polite">
            {adapter.selectionStatus}
          </p>
          <HandView
            groups={model.ownHand}
            handLayout={model.handLayout}
            selectedCardIds={model.selectedCardIds}
            selectableCardIds={model.selectableCardIds}
            draggable
            levelRank={adapter.levelRank}
            onToggleCard={callbacks.onToggleCard}
            {...adapter.handDrag}
          />
          <p className="human-seat-identity">
            <strong className="human-seat-name">
              {model.playerNames[model.viewerLogicalSeat]}
            </strong>
            <span className="card-count seat-card-count">
              {model.remainingCardCounts[model.viewerLogicalSeat]}
            </span>
          </p>
        </section>
        <p id="hand-arrangement-help">
          已按牌面自动整理。可拖拽牌到另一张牌前方理牌，也可按 Alt 加左右方向键移动当前牌。
        </p>
      </TableView>
    </section>
  );
}
