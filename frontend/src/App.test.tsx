import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import type { StorageBoundary } from "./platform/storage";
import {
  applyTableSessionAction,
  createTableSession,
  serializeTableSession,
  type TableSave
} from "./games/guandan/table-session";
import { getLegalSingleActions } from "./games/guandan/table-controller";

function memoryStorage(
  initial?: TableSave
): StorageBoundary<TableSave> & { cleared: boolean; saveCalls: number } {
  let value = initial;
  return {
    cleared: false,
    saveCalls: 0,
    async load() {
      return value;
    },
    async save(next) {
      value = next;
      this.saveCalls += 1;
    },
    async clear() {
      value = undefined;
      this.cleared = true;
    }
  };
}

describe("App", () => {
  it("首局由南家行动，牌桌按四边座位显示并高亮可选牌", async () => {
    render(<App storage={memoryStorage()} />);

    await waitFor(() => expect(screen.getByText("轮到：你（南家）")).toBeInTheDocument());
    expect(screen.getByLabelText("北家座位")).toHaveTextContent("27");
    expect(screen.getByLabelText("东家座位")).toHaveTextContent("27");
    expect(screen.getByText("轮到：你（南家）")).toBeInTheDocument();
    const hand = screen.getByLabelText("你的手牌");
    expect(screen.getByLabelText("牌桌")).toContainElement(hand);
    expect(screen.queryByRole("heading", { name: /你的手牌/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "横排" })).toHaveAttribute("aria-pressed", "false");
    const cards = within(hand).getAllByRole("button", { name: /^选择/ });
    expect(cards).toHaveLength(27);
    fireEvent.click(cards[0]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cards[0]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
    expect(hand.querySelectorAll(".card-face")).toHaveLength(27);
    expect(hand.querySelectorAll(".card-face.compact").length).toBeGreaterThan(0);
    expect(
      within(screen.getByLabelText("操作"))
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["过牌", "提示", "出牌"]);
  });

  it("提示和出牌仍通过规则入口提交", async () => {
    render(<App storage={memoryStorage()} />);
    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    expect(screen.getByRole("status")).toHaveTextContent("提示：可出单张。");
    fireEvent.click(screen.getByRole("button", { name: /^出牌/ }));
    await waitFor(() => expect(screen.getByText("轮到：你（南家）")).toBeInTheDocument());
  });

  it("明牌以同一组牌布局显示其他三家，并可立即关闭", async () => {
    render(<App storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "明牌" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "明牌" }));
    const revealed = screen.getByLabelText("东家明牌");
    expect(revealed.querySelectorAll(".card-face")).toHaveLength(27);
    fireEvent.click(screen.getByRole("button", { name: "明牌" }));
    expect(screen.queryByLabelText("东家明牌")).not.toBeInTheDocument();
  });

  it("桌面保留本轮最近动作，过牌显示为不要", async () => {
    const initial = createTableSession(73);
    const opening = getLegalSingleActions(initial.game).find((action) => action.type === "play");
    if (!opening) throw new Error("expected south opening");
    const afterSouth = applyTableSessionAction(initial, opening);
    if (!afterSouth.ok) throw new Error("expected south opening");
    const afterEast = applyTableSessionAction(afterSouth.session, { type: "pass", actor: "east" });
    if (!afterEast.ok) throw new Error("expected east pass");
    const afterNorth = applyTableSessionAction(afterEast.session, { type: "pass", actor: "north" });
    if (!afterNorth.ok) throw new Error("expected north pass");

    render(<App storage={memoryStorage(serializeTableSession(afterNorth.session))} />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已继续上次未完成的对局。")
    );
    expect(screen.getByLabelText("东家（机器人）最近出牌")).toHaveTextContent("不要");
    expect(screen.getByLabelText("北家最近出牌")).toHaveTextContent("不要");
    expect(screen.getByLabelText("你（南家）当前出牌").querySelectorAll(".card-face")).toHaveLength(
      1
    );
  });

  it("手动理牌保留为显示偏好，不改变实体选择", async () => {
    render(<App storage={memoryStorage()} />);
    const hand = screen.getByLabelText("你的手牌");
    const before = within(hand).getAllByRole("button", { name: /^选择/ });
    const first = before[0];
    const second = before[1];
    const secondLabel = second.getAttribute("aria-label");
    fireEvent.keyDown(first, { altKey: true, key: "ArrowRight" });
    await waitFor(() =>
      expect(within(hand).getAllByRole("button", { name: /^选择/ })[0]).toHaveAttribute(
        "aria-label",
        secondLabel
      )
    );
    const moved = within(hand).getAllByRole("button", { name: /^选择/ })[0];
    fireEvent.click(moved);
    expect(moved).toHaveAttribute("aria-pressed", "true");
    expect(hand.querySelectorAll(".card-face.compact").length).toBeGreaterThan(0);
  });

  it("横排和竖排按钮切换南家及明牌手牌的布局", async () => {
    render(<App storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByText("轮到：你（南家）")).toBeInTheDocument());
    const hand = screen.getByLabelText("你的手牌");
    fireEvent.click(screen.getByRole("button", { name: "明牌" }));
    expect(hand.querySelectorAll(".card-face.compact").length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText("东家明牌").querySelectorAll(".card-face.compact").length
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "横排" }));
    expect(screen.getByRole("button", { name: "竖排" })).toHaveAttribute("aria-pressed", "true");
    expect(hand.querySelectorAll(".card-face.compact")).toHaveLength(0);
    expect(screen.getByLabelText("东家明牌").querySelectorAll(".card-face.compact")).toHaveLength(
      0
    );
  });

  it("拒绝旧规则版本存档，直到用户明确开始新局才覆盖", async () => {
    const incompatible = structuredClone(serializeTableSession(createTableSession(73)));
    Reflect.set(incompatible.stream, "rulesVersion", "guandan-v1");
    const storage = memoryStorage(incompatible);
    render(<App storage={storage} />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("存档不兼容或恢复失败")
    );
    expect(storage.saveCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "新局" }));
    await waitFor(() => expect(storage.saveCalls).toBeGreaterThan(0));
  });
});
