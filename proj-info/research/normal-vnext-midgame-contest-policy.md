# normal-vNext 开中局自然结构争牌

## 目的

避免 normal-vNext 在开中局对自然中小对子、三张和三带二过度 pass，同时继续保护高级控制资源和关键结构。

## 评分合同

仅对对子、三张、三带二计算争牌诊断：

- `handSheddingBenefit`：完整自然中小结构每张 60 分。
- `contestBenefit`：完整自然中小结构额外 120 分。
- `passBias`：160 分。
- `highValuePenalty`：主结构含 A、级牌、王或高点控制资源时 320 分。
- `actionScore = handSheddingBenefit + contestBenefit - responseCost - highValuePenalty`。

完整自然中小结构的 `actionScore > passBias` 时推荐争牌。跟牌时，若所有可压制的对子、三张或三带二都触发高价值惩罚，则普通开中局选择 pass；尾局强制阻断和直接出完优先级更高。

## 固定结果

| 场景 | 结构损伤 | 控制资源 | 出牌分 | pass 偏置 | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 22 对 66 | 0 | 0 | 234 | 160 | 接牌 |
| 444 对 888 | 0 | 0 | 292 | 160 | 接牌 |
| 44422 对 88866 | 0 | 0 | 406 | 160 | 接牌 |
| 44422 对 AAAKK | 0 | 120 | -467 | 160 | pass |
| 44422 对 222AA（2 为级牌） | 0 | 240 | -589 | 160 | pass |

所有计算只使用 BotView、合法动作和规则层既有牌型解释；不读取隐藏手牌。
