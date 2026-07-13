import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import type { StorageBoundary } from "./platform/storage";
import {
  applyTableSessionAction,
  createTableSession,
  serializeTableSession,
  type TableSave
} from "./games/guandan/table-session";
import { chooseTableBotAction, getLegalSingleActions } from "./games/guandan/table-controller";

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

function saveAfterEastOpensWithSouthResponse(): TableSave {
  for (let seed = 0; seed < 100; seed += 1) {
    const session = createTableSession(seed);
    const opening = getLegalSingleActions(session.game).find(
      (candidate) => candidate.type === "play"
    );
    if (!opening) continue;
    const result = applyTableSessionAction(session, opening);
    if (!result.ok || result.session.game.state.current !== "south") continue;

    const response = chooseTableBotAction(result.session.game);
    if (response?.type === "play" && response.actor === "south")
      return serializeTableSession(result.session);
  }
  throw new Error("expected a deterministic south response after east opens");
}

describe("App", () => {
  it("提供规则入口与可选择的实体手牌", async () => {
    const storage = memoryStorage();
    render(<App storage={storage} />);

    await waitFor(() => expect(storage.saveCalls).toBeGreaterThan(0));

    expect(screen.getByRole("heading", { name: "单人本地掼蛋" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "规则" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("button", { name: /^选择/ })).toHaveLength(27);

    fireEvent.click(screen.getByRole("button", { name: "规则" }));
    expect(screen.getByLabelText("规则入口")).toHaveTextContent("docs/resolved-rules.md");
  });

  it("提示与出牌经规则边界提交，并在机器人回合后回到人类", async () => {
    render(<App storage={memoryStorage()} />);

    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    expect(screen.getByRole("status")).toHaveTextContent("提示：可出单张。");
    fireEvent.click(screen.getByRole("button", { name: /^出牌/ }));

    await waitFor(() => expect(screen.getByText("轮到：你（东家）")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("已出单张。");
  });

  it("东家领出后，南家可压制时组件会执行机器人轮转", async () => {
    render(<App storage={memoryStorage(saveAfterEastOpensWithSouthResponse())} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已继续上次未完成的对局。")
    );
    await waitFor(() => expect(screen.getByText("轮到：你（东家）")).toBeInTheDocument());
  });

  it("人类可仅用提示、出牌和过牌完成一局", async () => {
    render(<App storage={memoryStorage()} />);

    for (
      let turn = 0;
      turn < 100 && !screen.queryByRole("heading", { name: "本局结束" });
      turn += 1
    ) {
      if (screen.queryByRole("heading", { name: /你的手牌（0）/ })) break;
      await waitFor(() =>
        expect(
          screen.queryByText("轮到：你（东家）") ??
            screen.queryByRole("heading", { name: "本局结束" })
        ).toBeInTheDocument()
      );
      if (screen.queryByRole("heading", { name: "本局结束" })) break;

      fireEvent.click(screen.getByRole("button", { name: "提示" }));
      const play = screen.getByRole("button", { name: /^出牌/ });
      if (!play.hasAttribute("disabled")) {
        fireEvent.click(play);
      } else {
        fireEvent.click(screen.getByRole("button", { name: "过牌" }));
      }
    }

    await waitFor(
      () => expect(screen.getByRole("heading", { name: "本局结束" })).toBeInTheDocument(),
      { timeout: 5_000 }
    );
  }, 15_000);

  it("从可注入存储继续中断对局，并提供新局和清除存档", async () => {
    const session = createTableSession(73);
    const action = getLegalSingleActions(session.game).find(
      (candidate) => candidate.type === "play"
    );
    if (!action) throw new Error("expected opening play");
    const result = applyTableSessionAction(session, action);
    if (!result.ok) throw new Error("expected legal opening play");
    const storage = memoryStorage(serializeTableSession(result.session));

    render(<App storage={storage} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已继续上次未完成的对局。")
    );
    expect(screen.getByRole("heading", { name: /你的手牌（26）/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新局" }));
    expect(screen.getByRole("status")).toHaveTextContent("已开始新局。");
    fireEvent.click(screen.getByRole("button", { name: "清除存档" }));
    await waitFor(() => expect(storage.cleared).toBe(true));
  });

  it("拒绝不兼容旧存档，并在用户明确开始新局前不覆盖它", async () => {
    const incompatible = structuredClone(serializeTableSession(createTableSession(73)));
    Reflect.set(incompatible.stream, "rulesVersion", "guandan-v0");
    const storage = memoryStorage(incompatible);

    render(<App storage={storage} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("存档不兼容或恢复失败")
    );
    expect(storage.saveCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "新局" }));
    await waitFor(() => expect(storage.saveCalls).toBeGreaterThan(0));
  });

  it("可拖拽理牌并在重新加载后恢复显示顺序，且不改变实体牌选择", async () => {
    const storage = memoryStorage();
    const firstRender = render(<App storage={storage} />);
    await waitFor(() => expect(storage.saveCalls).toBeGreaterThan(0));

    const hand = screen.getByLabelText("你的手牌");
    const cards = within(hand).getAllByRole("button", { name: /^选择/ });
    const first = cards[0];
    const last = cards.at(-1);
    if (!last) throw new Error("expected cards");
    const transfer = {
      value: "",
      setData(_: string, value: string) {
        this.value = value;
      },
      getData() {
        return this.value;
      },
      effectAllowed: ""
    };

    fireEvent.dragStart(last, { dataTransfer: transfer });
    fireEvent.drop(first, { dataTransfer: transfer });
    await waitFor(() =>
      expect(within(hand).getAllByRole("button", { name: /^选择/ })[0]).toBe(last)
    );

    fireEvent.click(last);
    expect(last).toHaveAttribute("aria-pressed", "true");
    firstRender.unmount();
    render(<App storage={storage} />);
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("你的手牌")).getAllByRole("button", { name: /^选择/ })[0]
      ).toHaveTextContent(last.textContent ?? "")
    );
  });

  it("提供 Alt 加方向键的理牌回退操作", async () => {
    render(<App storage={memoryStorage()} />);
    const hand = screen.getByLabelText("你的手牌");
    const before = within(hand).getAllByRole("button", { name: /^选择/ });
    const first = before[0];
    const second = before[1];

    fireEvent.keyDown(first, { altKey: true, key: "ArrowRight" });

    await waitFor(() =>
      expect(within(hand).getAllByRole("button", { name: /^选择/ })[0]).toBe(second)
    );
    expect(screen.getByRole("status")).toHaveTextContent("已调整手牌显示顺序。");
  });
});
