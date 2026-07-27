import type { ReactNode } from "react";
import type { TableInteractionCallbacks, TableViewModel } from "./table-contract";

export function ActionControls({
  canPlay,
  canPass,
  canHint = canPlay,
  isActionPending,
  selectedCardIds,
  onHint,
  onPass,
  onPlay,
  playLabel = "出牌",
  children
}: {
  readonly canPlay: TableViewModel["canPlay"];
  readonly canPass: TableViewModel["canPass"];
  readonly canHint?: TableViewModel["canHint"];
  readonly isActionPending: TableViewModel["isActionPending"];
  readonly selectedCardIds: TableViewModel["selectedCardIds"];
  readonly onHint: TableInteractionCallbacks["onHint"];
  readonly onPass: TableInteractionCallbacks["onPass"];
  readonly onPlay: TableInteractionCallbacks["onPlay"];
  readonly playLabel?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <section aria-label="操作">
      <button type="button" onClick={onPass} disabled={!canPass || isActionPending}>
        过牌
      </button>
      <button type="button" onClick={onHint} disabled={!canHint || isActionPending}>
        提示
      </button>
      <button
        type="button"
        onClick={() => onPlay(selectedCardIds)}
        disabled={!canPlay || isActionPending}
      >
        {playLabel}
      </button>
      {children}
    </section>
  );
}
