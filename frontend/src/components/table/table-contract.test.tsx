import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionControls } from "./ActionControls";
import { PublicActions } from "./PublicActions";
import { TableView } from "./TableView";
import { createDisplayPositions, logicalSeatOrder } from "./table-contract";
import { useCardSelection } from "./useCardSelection";

function SelectionHarness({ ownHandCardIds }: { readonly ownHandCardIds: readonly string[] }) {
  const { selectedCardIds, toggleCard } = useCardSelection(ownHandCardIds);
  return (
    <>
      <output>{selectedCardIds.join(",")}</output>
      <button type="button" onClick={() => toggleCard("nine-a", true)}>
        选 9A
      </button>
      <button type="button" onClick={() => toggleCard("nine-b", true)}>
        选 9B
      </button>
    </>
  );
}

describe("共享牌桌合同", () => {
  it("出牌回调严格接收当前 selectedCardIds，pending 时禁止重复提交", () => {
    const onPlay = vi.fn();
    const onPass = vi.fn();
    const onHint = vi.fn();
    const { rerender } = render(
      <ActionControls
        canPlay
        canPass
        canHint
        isActionPending={false}
        selectedCardIds={["nine-a", "nine-b"]}
        onPlay={onPlay}
        onPass={onPass}
        onHint={onHint}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "出牌" }));
    expect(onPlay).toHaveBeenCalledWith(["nine-a", "nine-b"]);
    expect(onPlay).not.toHaveBeenCalledWith(["king-a", "king-b"]);

    rerender(
      <ActionControls
        canPlay
        canPass
        canHint
        isActionPending
        selectedCardIds={["nine-a", "nine-b"]}
        onPlay={onPlay}
        onPass={onPass}
        onHint={onHint}
      />
    );
    expect(screen.getByRole("button", { name: "出牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "过牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提示" })).toBeDisabled();
  });

  it("三个动作按钮只由各自的显式能力输入控制", () => {
    const callbacks = { onPlay: vi.fn(), onPass: vi.fn(), onHint: vi.fn() };
    render(
      <ActionControls
        canPlay={false}
        canPass={false}
        canHint
        isActionPending={false}
        selectedCardIds={[]}
        {...callbacks}
      />
    );

    expect(screen.getByRole("button", { name: "出牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "过牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提示" })).toBeEnabled();
  });

  it("个人投影换手后清除失效的选中牌，同时保留仍在手中的牌", () => {
    const { rerender } = render(<SelectionHarness ownHandCardIds={["nine-a", "nine-b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "选 9A" }));
    fireEvent.click(screen.getByRole("button", { name: "选 9B" }));
    expect(screen.getByRole("status")).toHaveTextContent("nine-a,nine-b");

    rerender(<SelectionHarness ownHandCardIds={["nine-b", "queen-a"]} />);
    expect(screen.getByRole("status")).toHaveTextContent("nine-b");
  });

  it("公开动作只需要显式的公开牌面，不依赖其他座位手牌或全量牌表", () => {
    const { container } = render(
      <PublicActions
        className="seat-actions"
        levelRank="2"
        actions={[
          {
            key: "south-play",
            ariaLabel: "南家当前出牌",
            pass: false,
            cards: [
              {
                card: { id: "nine-a", deckIndex: 0, suit: "spades", rank: "9" }
              }
            ]
          }
        ]}
      />
    );

    expect(container.querySelectorAll(".card-face")).toHaveLength(1);
    expect(screen.getByLabelText("南家当前出牌")).toHaveTextContent("9");
  });

  it("视觉映射固定本人在下、队友在上，且不改写逻辑座位顺序", () => {
    const positions = createDisplayPositions("south");
    expect(positions.south).toBe("bottom");
    expect(positions.north).toBe("top");
    expect(positions.east).toBe("right");
    expect(positions.west).toBe("left");
    expect(logicalSeatOrder).toEqual(["south", "east", "north", "west"]);
  });

  it("共享牌桌外框对相同显式 props 保持纯展示", () => {
    const model = {
      viewerLogicalSeat: "south" as const,
      displayPositions: createDisplayPositions("south"),
      gamePhase: "playing" as const
    };
    const { container, rerender } = render(
      <TableView showAllHands={false} model={model}>
        <span>公开桌面</span>
      </TableView>
    );
    const first = container.innerHTML;

    rerender(
      <TableView showAllHands={false} model={model}>
        <span>公开桌面</span>
      </TableView>
    );
    expect(container.innerHTML).toBe(first);
  });
});
