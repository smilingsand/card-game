# P1-18 核对发现

- `docs/resolved-rules.md` 已冻结：首局南家领出；后续由进贡后出牌权决定。单下、双下、抗贡、还贡和首出规则已描述。
- `frontend/src/games/guandan/settlement.ts` 有纯函数 `settleRound`、`settleSingleTribute`、`settleDoubleTribute`、`initializeNextRound`，但尚未由 `TableSession` 或 UI 调用。
- 现有 `TableSession` 只保存当前一局的 seed、动作流、快照和南家显示顺序；规则版本为 `guandan-v2`，存档版本为 2。
- 用户已确认双方独立等级：仅头游所在队升级；下一局级牌取先出方所属队伍等级。
- 用户已确认进贡、双下分配和抗贡条件；现有结算输入只有一个 `level`，需要扩展为双方等级和实际牌交换状态。
- UI 当前仅显示本局完成顺序；尚无赛局/贡牌状态。
- `match.ts` 已建立纯规则边界：`levelsAfterRound`、`levelForLeader`、`createTributePlan`；5 个固定牌例覆盖双方升级、级牌来源、单双下与抗贡。
