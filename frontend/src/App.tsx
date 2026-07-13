import { useEffect, useMemo, useState } from "react";
import type { Seat } from "./platform/types";
import {
  chooseTableBotAction,
  createTableGame,
  formatCard,
  formatInterpretation,
  getLegalSingleActions,
  getSelectedPlayActions,
  submitTableAction,
  type TableGame
} from "./games/guandan/table-controller";

const HUMAN_SEAT: Seat = "east";
const seatName: Record<Seat, string> = {
  east: "你（东家）",
  south: "南家",
  west: "西家",
  north: "北家"
};

function cardSort(left: string, right: string): number {
  return left.localeCompare(right);
}

export function App() {
  const initialGame = useMemo(() => createTableGame(), []);
  const [game, setGame] = useState<TableGame>(initialGame);
  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("请选择手牌后出牌。");
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (game.state.completed || game.state.current === HUMAN_SEAT) return;
    const timer = window.setTimeout(() => {
      const action = chooseTableBotAction(game);
      if (!action) {
        setMessage(`${seatName[game.state.current]}没有可执行的合法动作。`);
        return;
      }
      const result = submitTableAction(game, action);
      if (!result.ok) {
        setMessage(`机器人动作被规则引擎拒绝：${result.code}`);
        return;
      }
      setGame({ ...game, state: result.state });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [game]);

  const hand = [...game.state.hands[HUMAN_SEAT]].sort(cardSort);
  const selectedActions = getSelectedPlayActions(game, selectedCardIds);
  const canPass = getLegalSingleActions(game).some((action) => action.type === "pass");

  const submit = (action: ReturnType<typeof getLegalSingleActions>[number]) => {
    const result = submitTableAction(game, action);
    if (!result.ok) {
      setMessage(`规则引擎拒绝此动作：${result.code}`);
      return;
    }
    setGame({ ...game, state: result.state });
    setSelectedCardIds([]);
    setMessage(
      action.type === "pass"
        ? "你选择了过牌。"
        : `已出${formatInterpretation(action.interpretation)}。`
    );
  };

  const toggleCard = (cardId: string) => {
    if (game.state.current !== HUMAN_SEAT || game.state.completed) return;
    setSelectedCardIds((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]
    );
  };

  if (game.state.completed) {
    return (
      <main aria-label="掼蛋牌桌">
        <h1>本局结束</h1>
        <p>完成顺序：{game.state.finished.map((seat) => seatName[seat]).join("、")}</p>
        <button type="button" onClick={() => window.location.reload()}>
          新开一局
        </button>
      </main>
    );
  }

  return (
    <main aria-label="掼蛋牌桌">
      <header>
        <h1>单人本地掼蛋</h1>
        <button
          type="button"
          onClick={() => setRulesOpen((open) => !open)}
          aria-expanded={rulesOpen}
        >
          规则
        </button>
      </header>
      {rulesOpen ? (
        <aside aria-label="规则入口">
          本局规则以项目的 <code>docs/resolved-rules.md</code>{" "}
          为唯一口径；牌型与跟牌均由规则引擎判定。
        </aside>
      ) : null}
      <section aria-label="桌面信息">
        <p>轮到：{seatName[game.state.current]}</p>
        <p>
          各家剩余：东 {game.state.hands.east.length}、南 {game.state.hands.south.length}、西{" "}
          {game.state.hands.west.length}、北 {game.state.hands.north.length}
        </p>
        <p>
          {game.state.highestSeat
            ? `当前牌由${seatName[game.state.highestSeat]}压住。`
            : "当前为领出。"}
        </p>
      </section>
      <p role="status">{message}</p>
      <section aria-label="你的手牌">
        <h2>你的手牌（{hand.length}）</h2>
        <div>
          {hand.map((cardId) => {
            const card = game.cardsById.get(cardId);
            if (!card) return null;
            const selected = selectedCardIds.includes(cardId);
            return (
              <button
                key={cardId}
                type="button"
                aria-pressed={selected}
                aria-label={`选择${formatCard(card)}`}
                onClick={() => toggleCard(cardId)}
              >
                {formatCard(card)}
              </button>
            );
          })}
        </div>
      </section>
      <section aria-label="操作">
        <button
          type="button"
          onClick={() => {
            const hint = getLegalSingleActions(game).find((action) => action.type === "play");
            if (!hint || hint.type !== "play") {
              setMessage("规则引擎没有提供可提示的出牌。");
              return;
            }
            setSelectedCardIds(hint.cardIds);
            setMessage(`提示：可出${formatInterpretation(hint.interpretation)}。`);
          }}
          disabled={game.state.current !== HUMAN_SEAT}
        >
          提示
        </button>
        <button
          type="button"
          onClick={() => submit(selectedActions[0])}
          disabled={game.state.current !== HUMAN_SEAT || selectedActions.length === 0}
        >
          出牌
          {selectedActions[0]?.type === "play"
            ? `（${formatInterpretation(selectedActions[0].interpretation)}）`
            : ""}
        </button>
        <button
          type="button"
          onClick={() => submit({ type: "pass", actor: HUMAN_SEAT })}
          disabled={game.state.current !== HUMAN_SEAT || !canPass}
        >
          过牌
        </button>
      </section>
    </main>
  );
}
