import type { ReactNode } from "react";
import type { TableViewModel } from "./table-contract";

/**
 * 仅提供四座牌桌的外层语义和响应式样式边界；状态与规则均由适配器组装为 children。
 */
export function TableView({
  showAllHands,
  model,
  children
}: {
  readonly showAllHands: boolean;
  readonly model: Pick<TableViewModel, "viewerLogicalSeat" | "displayPositions" | "gamePhase">;
  readonly children: ReactNode;
}) {
  return (
    <section
      className={`table responsive-table${showAllHands ? " show-all-hands" : ""}`}
      aria-label="牌桌"
      data-viewer-logical-seat={model.viewerLogicalSeat}
      data-game-phase={model.gamePhase}
    >
      {children}
    </section>
  );
}
