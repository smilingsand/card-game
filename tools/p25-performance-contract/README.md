# P2.5 Expert performance-contract runner

ADR-0023 的 Node/tsx 主性能门禁工具。每个 worker 是一个独立 Node
进程，并分开记录三层数据：

1. `processColdStart`：清空精确缓存后的首个 expert 决策，仅作诊断；
2. `steadyStateCold`：随后使用三个不属于冻结 34 样本的 expert BotView
   做不计时预热，在支持时执行一次 GC，再测量此前从未作为决策输入的冻结
   34 个 BotView。这是主门禁；
3. `warm`：立即重复相同的 34 个 BotView。

worker 不修改策略、预算或模拟状态，且单次决策之间绝不触发 GC。

从 `frontend/` 运行五个独立 worker：

```powershell
1..5 | ForEach-Object {
  node --expose-gc --import tsx ..\tools\p25-performance-contract\runner.ts worker `
    ..\temp\p25-adr-0023-process-$_.json
}
node --import tsx ..\tools\p25-performance-contract\runner.ts aggregate `
  ..\temp\p25-adr-0023-process-1.json `
  ..\temp\p25-adr-0023-process-2.json `
  ..\temp\p25-adr-0023-process-3.json `
  ..\temp\p25-adr-0023-process-4.json `
  ..\temp\p25-adr-0023-process-5.json
```

`aggregate` 将机器可读 JSON 写到 stdout；验收记录必须保留五个 worker 的
完整聚合结果，不能选择单个较优进程。
