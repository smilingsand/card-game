import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { App, CardFace, PlayerCardCount } from "./App";
import { ActionControls } from "./components/table/ActionControls";
import { latestRecentActionLayerBySeat, latestRecentActionsBySeat } from "@card-game/guandan-core";
import type { StorageBoundary } from "@card-game/guandan-core";
import {
  applyTableSessionAction,
  createTableSession,
  getSouthTributeChoices,
  prepareNextTableSession,
  serializeTableSession,
  type TableSave
} from "@card-game/guandan-core";
import { getLegalSingleActions } from "@card-game/guandan-core";

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
  afterEach(() => cleanup());

  it("共享操作区只由适配器提供的可行动状态决定按钮可用性", () => {
    const onPlay = vi.fn();
    const onPass = vi.fn();
    const onHint = vi.fn();
    render(
      <ActionControls
        canPlay={false}
        canPass={false}
        isActionPending={false}
        selectedCardIds={[]}
        onHint={onHint}
        onPass={onPass}
        onPlay={onPlay}
      />
    );

    expect(screen.getByRole("button", { name: "过牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提示" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "出牌" })).toBeDisabled();
  });

  it("首页通过多人联机游戏按钮进入多人大厅", async () => {
    render(<App initialMode="home" multiplayerGameEnabled={true} storage={memoryStorage()} />);

    expect(screen.getByRole("heading", { name: "掼蛋游戏" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "多人掼蛋游戏" }));
    expect(await screen.findByLabelText("多人大厅")).toBeInTheDocument();
  });

  it("关闭多人发布开关时首页禁用入口且不接受房间链接", () => {
    window.history.replaceState(undefined, "", "?room=room-123");
    render(<App initialMode="home" multiplayerGameEnabled={false} storage={memoryStorage()} />);

    expect(screen.getByRole("button", { name: "多人掼蛋游戏" })).toBeDisabled();
    expect(screen.queryByLabelText("多人大厅")).not.toBeInTheDocument();
    window.history.replaceState(undefined, "", "/");

    cleanup();
    render(
      <App initialMode="multiplayer" multiplayerGameEnabled={false} storage={memoryStorage()} />
    );
    expect(screen.getByLabelText("掼蛋游戏首页")).toBeInTheDocument();
  });

  it("从首页进入单人游戏时忽略旧存档并开始新赛局", async () => {
    const initial = createTableSession(73);
    const opening = getLegalSingleActions(initial.game).find(
      (action) => action.type === "play" && action.cardIds.length === 1
    );
    if (!opening) throw new Error("expected south opening");
    const afterSouth = applyTableSessionAction(initial, opening);
    if (!afterSouth.ok) throw new Error("expected south opening");
    const storage = memoryStorage(serializeTableSession(afterSouth.session));

    render(<App initialMode="home" storage={storage} />);
    fireEvent.click(screen.getByRole("button", { name: "单人掼蛋游戏" }));

    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());
    expect(screen.queryByText("已继续上次未完成的对局。")).not.toBeInTheDocument();
    await waitFor(() => expect(storage.saveCalls).toBeGreaterThan(0));
  });

  it("单人游戏的退出按钮回到首页", () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);

    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    expect(screen.getByRole("heading", { name: "掼蛋游戏" })).toBeInTheDocument();
  });

  it("牌桌只展示 normal-vNext 策略", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("机器人策略")).toHaveTextContent("normal-vNext")
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("机器人决策耗时")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("normal-vNext 决策诊断")).not.toBeInTheDocument();
  });

  it("机器人等待出牌时不额外显示 thinking 提示", async () => {
    const initial = createTableSession(73);
    const opening = getLegalSingleActions(initial.game).find(
      (action) => action.type === "play" && action.cardIds.length === 1
    );
    if (!opening) throw new Error("expected south opening");
    const afterSouth = applyTableSessionAction(initial, opening);
    if (!afterSouth.ok) throw new Error("expected south opening");

    render(
      <App initialMode="solo" storage={memoryStorage(serializeTableSession(afterSouth.session))} />
    );
    expect(screen.queryByText("normal-vNext 正在思考…")).not.toBeInTheDocument();
  });

  it("牌桌提供独立的响应式布局边界", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());
    expect(screen.getByLabelText("牌桌")).toHaveClass("responsive-table");
  });

  it("纵叠手牌和座位计数使用不会被网格拉伸的布局边界", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());

    const hand = screen.getByLabelText("你的手牌");
    expect(hand.querySelectorAll(".compact-card").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("北家座位").querySelector(".card-count")).toHaveClass(
      "seat-card-count"
    );
  });

  it("普通牌与紧凑牌共享同一套响应式尺寸边界", () => {
    const { container } = render(
      <>
        <CardFace card={{ id: "normal", deckIndex: 0, suit: "spades", rank: "A" }} />
        <CardFace card={{ id: "compact", deckIndex: 0, suit: "spades", rank: "A" }} compact />
      </>
    );

    expect(container.querySelectorAll(".size-token-card")).toHaveLength(2);
    expect(container.querySelector(".card-face.compact")).toHaveClass("size-token-card");
  });

  it("纵叠手牌使用无缝连接边界", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());
    expect(
      screen.getByLabelText("你的手牌").querySelectorAll(".joined-card-stack").length
    ).toBeGreaterThan(0);
  });

  it("最近一圈内同一座位的旧动作会被该座位新动作覆盖", () => {
    const firstWestPass = { type: "pass" as const, actor: "west" as const };
    const latestWestPass = { type: "pass" as const, actor: "west" as const };
    const eastPlay = {
      type: "play" as const,
      actor: "east" as const,
      cardIds: ["east-3"],
      interpretation: {
        type: "single" as const,
        comparisonKey: [3],
        cardIds: ["east-3"],
        wildcardAs: {}
      }
    };
    const northPlay = {
      type: "play" as const,
      actor: "north" as const,
      cardIds: ["north-4"],
      interpretation: {
        type: "single" as const,
        comparisonKey: [4],
        cardIds: ["north-4"],
        wildcardAs: {}
      }
    };
    const events = [firstWestPass, eastPlay, latestWestPass, northPlay].map((action, sequence) => ({
      sequence,
      type: "action.applied",
      payload: { action }
    }));

    const latest = latestRecentActionsBySeat(events);

    expect(latest).toHaveLength(3);
    expect(latest.filter((action) => action.actor === "west")).toEqual([latestWestPass]);
    const layers = latestRecentActionLayerBySeat(events);
    expect(layers.get("north")).toBeGreaterThan(layers.get("east") ?? 0);
    expect(layers.get("north")).toBeGreaterThan(layers.get("west") ?? 0);
  });

  it("首局由南家行动，牌桌按四边座位显示并高亮可选牌", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);

    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());
    const humanIdentity = screen.getByText("南家（你）").closest("p");
    expect(humanIdentity).toHaveClass("human-seat-identity");
    expect(humanIdentity).toHaveTextContent("27");
    expect(screen.getByLabelText("北家座位")).toHaveTextContent("27");
    expect(screen.getByLabelText("东家座位")).toHaveTextContent("27");
    expect(screen.getByLabelText("东家座位")).toHaveTextContent("东家（机器人）");
    expect(screen.getByLabelText("北家座位")).toHaveTextContent("北家（机器人）");
    expect(screen.getByLabelText("西家座位")).toHaveTextContent("西家（机器人）");
    expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "重新开赛" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重开本局" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除存档" })).not.toBeInTheDocument();
  });

  it("动态级牌只在本局级牌上标注级或配，2 不会沿用级牌标记", async () => {
    const { container } = render(
      <>
        <CardFace card={{ id: "two", deckIndex: 1, suit: "clubs", rank: "2" }} levelRank="6" />
        <CardFace card={{ id: "six", deckIndex: 1, suit: "hearts", rank: "6" }} levelRank="6" />
      </>
    );
    const faces = [...container.querySelectorAll(".card-face")];
    const twos = faces.filter((face) => face.querySelector(".card-rank")?.textContent === "2");
    const sixes = faces.filter((face) => face.querySelector(".card-rank")?.textContent === "6");

    expect(twos).not.toHaveLength(0);
    expect(sixes).not.toHaveLength(0);
    expect(twos.every((face) => !face.querySelector(".card-badge"))).toBe(true);
    expect(sixes.some((face) => face.querySelector(".card-badge"))).toBe(true);
  });

  it("完成出牌者用名次替代手牌数量", () => {
    const { container } = render(
      <>
        <PlayerCardCount handSize={0} finishIndex={0} />
        <PlayerCardCount handSize={0} finishIndex={1} />
        <PlayerCardCount handSize={0} finishIndex={2} />
        <PlayerCardCount handSize={0} finishIndex={3} />
        <PlayerCardCount handSize={7} finishIndex={-1} />
      </>
    );
    const counts = [...container.querySelectorAll(".card-count")];

    expect(counts.map((count) => count.textContent)).toEqual(["头家", "二家", "三家", "末家", "7"]);
    expect(counts.slice(0, 4).every((count) => !count.classList.contains("urgent"))).toBe(true);
    expect(counts[4]).toHaveClass("urgent");
  });

  it("抗贡提示说明抗贡理由，记分牌仅高亮本局级别所属方", async () => {
    const antiTribute = Array.from({ length: 500 }, (_, seed) => {
      const initial = createTableSession(seed);
      return prepareNextTableSession({
        ...initial,
        game: {
          ...initial.game,
          state: {
            ...initial.game.state,
            completed: true as const,
            finished: ["north", "south", "west", "east"] as const
          }
        },
        match: { ...initial.match, currentFinish: ["north", "south", "west", "east"] as const }
      });
    }).find(
      (session) =>
        session.match.tributePlan.antiTribute &&
        session.match.tributePlan.proof.every((cardId) =>
          session.game.state.hands.west.includes(cardId)
        )
    );
    if (!antiTribute) throw new Error("expected a west two-big-joker anti-tribute seed");

    render(<App initialMode="solo" storage={memoryStorage(serializeTableSession(antiTribute))} />);

    await waitFor(() =>
      expect(screen.getByLabelText("本局结算与下一局提示")).toHaveTextContent(
        "完成顺序：北家（机器人）、南家（你）、西家（机器人）、东家（机器人）。本局抗贡，无需进贡（西家两个大王）"
      )
    );
    const scoreTokens = screen.getByLabelText("赛局记分与贡牌").querySelectorAll(".match-token");
    expect(scoreTokens[0]).not.toHaveClass("inactive");
    expect(scoreTokens[1]).toHaveClass("inactive");
  });

  it("连续赛局的南家进贡阶段只允许选择贡牌并手动确认", async () => {
    const initial = createTableSession(91);
    const completed = {
      ...initial,
      game: {
        ...initial.game,
        state: {
          ...initial.game.state,
          completed: true as const,
          finished: ["east", "north", "west", "south"] as const
        }
      },
      match: { ...initial.match, currentFinish: ["east", "north", "west", "south"] as const }
    };
    const awaitingTribute = prepareNextTableSession(completed);
    const choices = getSouthTributeChoices(awaitingTribute);
    expect(choices).not.toHaveLength(0);

    render(
      <App initialMode="solo" storage={memoryStorage(serializeTableSession(awaitingTribute))} />
    );

    await waitFor(() => expect(screen.getByText("请你（南家）上贡")).toBeInTheDocument());
    expect(screen.getByLabelText("本局结算与下一局提示")).toHaveTextContent(
      "完成顺序：东家（机器人）、北家（机器人）、西家（机器人）、南家（你）。"
    );
    expect(screen.getByRole("button", { name: "过牌" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提示" })).toBeDisabled();
    const hand = screen.getByLabelText("你的手牌");
    const tributeCard = within(hand)
      .getAllByRole("button", { name: /^选择/ })
      .find((button) => choices.includes(button.dataset.cardId ?? ""));
    expect(tributeCard).toBeDefined();
    if (!tributeCard) throw new Error("expected a south tribute card");
    fireEvent.click(tributeCard);
    fireEvent.click(screen.getByRole("button", { name: "确认进贡" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "确认进贡" })).not.toBeInTheDocument()
    );
  });

  it("提示和出牌仍通过规则入口提交", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "提示" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^提示：可出/);
    fireEvent.click(screen.getByRole("button", { name: /^出牌/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^已出/));
  }, 10_000);

  it("明牌以同一组牌布局显示其他三家，并可立即关闭", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "明牌" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "明牌" }));
    const revealed = screen.getByLabelText("东家明牌");
    expect(revealed.querySelectorAll(".card-face")).toHaveLength(27);
    expect(screen.getByLabelText("牌桌")).toHaveClass("show-all-hands");
    expect(screen.getByLabelText("东家座位").querySelector(".east-actions")).toBeInTheDocument();
    expect(screen.getByLabelText("西家座位").querySelector(".west-actions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "明牌" }));
    expect(screen.queryByLabelText("东家明牌")).not.toBeInTheDocument();
    expect(screen.getByLabelText("牌桌")).not.toHaveClass("show-all-hands");
  });

  it("桌面保留本轮最近动作，过牌显示为不要", async () => {
    const initial = createTableSession(73);
    const opening = getLegalSingleActions(initial.game).find(
      (action) => action.type === "play" && action.cardIds.length === 1
    );
    if (!opening) throw new Error("expected south opening");
    const afterSouth = applyTableSessionAction(initial, opening);
    if (!afterSouth.ok) throw new Error("expected south opening");
    const afterEast = applyTableSessionAction(afterSouth.session, { type: "pass", actor: "east" });
    if (!afterEast.ok) throw new Error("expected east pass");
    const afterNorth = applyTableSessionAction(afterEast.session, { type: "pass", actor: "north" });
    if (!afterNorth.ok) throw new Error("expected north pass");

    render(
      <App initialMode="solo" storage={memoryStorage(serializeTableSession(afterNorth.session))} />
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已继续上次未完成的对局。")
    );
    expect(screen.getByLabelText("东家（机器人）最近出牌")).toHaveTextContent("不要");
    expect(screen.getByLabelText("北家（机器人）最近出牌")).toHaveTextContent("不要");
    expect(screen.getByLabelText("南家（你）当前出牌").querySelectorAll(".card-face")).toHaveLength(
      1
    );
  });

  it("手动理牌保留为显示偏好，不改变实体选择", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
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
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());
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

  it("触摸抬起可选中或取消选中手牌，不依赖桌面拖拽", async () => {
    render(<App initialMode="solo" storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByText("轮到：南家（你）")).toBeInTheDocument());

    const card = within(screen.getByLabelText("你的手牌")).getAllByRole("button", {
      name: /^选择/
    })[0];
    fireEvent.touchEnd(card);
    expect(card).toHaveAttribute("aria-pressed", "true");

    fireEvent.touchEnd(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  it("拒绝旧规则版本存档，直到用户明确开始新局才覆盖", async () => {
    const incompatible = structuredClone(serializeTableSession(createTableSession(73)));
    Reflect.set(incompatible.stream, "rulesVersion", "guandan-v1");
    const storage = memoryStorage(incompatible);
    render(<App initialMode="solo" storage={storage} />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("存档不兼容或恢复失败")
    );
    expect(storage.saveCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "重新开赛" }));
    await waitFor(() => expect(storage.saveCalls).toBeGreaterThan(0));
  });
});
