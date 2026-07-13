import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("提供规则入口与可选择的实体手牌", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "单人本地掼蛋" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "规则" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("button", { name: /^选择/ })).toHaveLength(27);

    fireEvent.click(screen.getByRole("button", { name: "规则" }));
    expect(screen.getByLabelText("规则入口")).toHaveTextContent("docs/resolved-rules.md");
  });

  it("提示与出牌经规则边界提交，并在机器人回合后回到人类", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    expect(screen.getByRole("status")).toHaveTextContent("提示：可出单张。");
    fireEvent.click(screen.getByRole("button", { name: /^出牌/ }));

    await waitFor(() => expect(screen.getByText("轮到：你（东家）")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("已出单张。");
  });

  it("人类可仅用提示、出牌和过牌完成一局", async () => {
    render(<App />);

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
});
