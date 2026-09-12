# Wanwandequ Agent Architecture

> 目标：在授权 CTF 赛场中最大化 **verified points / minute**，而不是最大化 Agent 数量或 token 消耗。

## 1. 总体原则

万万得取采用 **一题一个权威 Parent Solver + 自适应并行 Intent Lanes**，而不是“一道题同时启动 N 个完整 Solver”。

完整 Solver 多开看起来并发很猛，实际上容易出现四个 Agent 同时执行 `file / strings / checksec`、重复反编译、重复扫端口、重复构造同一条利用链的问题。它们的上下文彼此隔离，还需要额外做结果仲裁，浪费时间和请求额度。

因此并发被拆成两层：

1. **题目级并发（Controller）**：同时推进多道题，优先覆盖容易得分的题。
2. **题内并发（Parent Solver）**：同一道题内部只保留一个权威上下文，用多个不同目的的 lane 扩大搜索空间。

## 2. 控制面

```text
Competition API
      │
      ▼
Controller / Scheduler
      │
      ├── Challenge A ── Parent Solver A
      ├── Challenge B ── Parent Solver B
      ├── Challenge C ── Parent Solver C
      └── Challenge D ── Parent Solver D
                         │
                         ├── Specialist lane
                         ├── Intent lane
                         ├── Intent lane
                         ├── Critic (conditional)
                         └── Verifier (candidate-only)
```

Controller 负责：

- 拉取题目、附件和连接信息；
- 按得分潜力、已解人数、历史进展、剩余时间排序；
- 控制同时活跃的 challenge 数；
- 为每题创建隔离 workspace；
- 保存 FACT / REJECTED / ARTIFACT / handoff；
- reset 与 submit；
- 最终以平台返回结果作为全局 solved 状态。

Controller **不参与具体解题推理**，也不允许 Solver 自己直接调比赛 submit/reset 接口。

## 3. 一道题内部只有一个权威 Parent Solver

Parent Solver 是该次 visit 的事实合并点和最终决策者。所有 lane 都给 Parent 提供证据，不各自宣布“我解出来了”。

Parent 的职责：

- 读取 `WQ_CHALLENGE.json` 与 `WQ_STATE.md`；
- 判断当前真正瓶颈；
- 选择分类 Skill；
- 分配少量、互不重复的 Intent lane；
- 合并 lane 结果并维护 FACT / HYPOTHESIS / REJECTED；
- 决定继续已有 peer、换策略、调用 critic 或进入 verifier；
- 输出唯一的 `<WQ_RESULT>`。

这样做的核心不是“少开 Agent”，而是让并发共享一个事实平面，避免多套世界观互相打架。

## 4. Lane 不是多个完整 Solver

### Specialist lane

每题最多优先使用一个分类 Specialist：

- `wq-pwn`
- `wq-reverse`
- `wq-web`
- `wq-crypto`
- `wq-forensics`

它负责该领域的 fast path 与关键决策，不负责机械地把所有技巧跑一遍。

### Intent lanes

剩余 lane 必须对应不同的可证伪假设。例如 PWN 首轮可以是：

- Lane A：静态结构 / protections / 输入边界 / primitive；
- Lane B：动态行为 / crash / 泄漏 / allocator 状态；
- Lane C：最短 exploit 链 / solver 脚本验证。

Reverse 可以是静态数据流、动态跟踪、约束/VM；Web 可以是入口面与权限边界、状态机/业务逻辑；Crypto 可以是结构识别与独立数学攻击路线。

**禁止用 lane 数量制造重复侦察。** 两个 lane 如果本质上验证的是同一假设，就应该合并。

## 5. 自适应 lane budget

Preset 中的 `innerConcurrency` 是上限，不再代表“每题必须开满”。

当前策略：

| 场景 | 首次 visit | 后续 visit |
| --- | ---: | ---: |
| PWN / Reverse | 3 lanes | 每次 fresh-context visit 最多 +1，直到 preset ceiling |
| Web / Crypto / Forensics / Misc | 2 lanes | 每次 fresh-context visit 最多 +1，直到 preset ceiling |
| 显式 `--inner-concurrency` | 用户指定 | 用户指定 |

因此 `max` 的 6 lane 不意味着每道题一上来就烧 6 个子 Agent。只有一题经过多次有价值的 fresh-context revisit 后，才允许逐步扩张搜索宽度。

这让比赛前半段把资源优先给“多题覆盖”，比赛后半段或顽固题再把并发集中起来。

## 6. Critic 与 Verifier

### Critic

Critic 不是常驻第二 Solver。只有以下情况才值得启动：

- 连续两次实验没有新增 FACT；
- 多个 lane 的前提互相冲突；
- exploit/solver 链很长且建立在脆弱假设上；
- revisit 仍围绕同一策略打转。

Critic 的任务是 **反证当前路线并提出不同策略类**，不是换种措辞继续做同一件事。

### Verifier

Verifier 也不是第二个完整 Solver。它只在出现具体 candidate flag 后启动，检查：

- flag 是否来自真实输出/文件/服务；
- 是否可复现；
- 是否包含精确 literal provenance；
- 是否只是模型猜测、样例或 placeholder；
- 需要时重新执行最短验证链。

本地 verifier accept 后，Controller 才有资格向平台 submit；平台 accepted 才是全局 solved。

## 7. Hub / Handoff

有价值的 lane 不应该因为一次调用结束就丢掉上下文。仍有潜力的 peer 使用 Hub 延续；需要 fresh-context 时，把结论压缩进 `WQ_STATE.md`：

- CONFIRMED FACTS
- REJECTED
- ARTIFACTS
- CURRENT BOTTLENECK
- NEXT INTENTS

Fresh-context visit 的意义是“带着事实换脑子”，不是重做一遍 recon。

## 8. Advisor 的定位

Advisor 应当是 **跨题监督层 / meta-scheduler**，而不是第 N 个解题 Agent。

它重点观察：

- 每题最近新增 FACT 的速度；
- 重复 tool call 比例；
- lane hypothesis 多样性；
- token / request / wall-clock 成本；
- revisit 次数与失败轨迹；
- 当前赛场剩余时间与题目得分潜力。

Advisor 输出的不是 exploit，而是资源决策：

`continue / widen / critic / fresh-context / lower-priority / rescue / abandon-for-now`

后续可以让 Advisor 动态调整 challenge-level concurrency 和 per-challenge lane ceiling，而不是固定使用 preset 的最大值。

## 9. 推荐执行拓扑

```text
                           Controller
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
          Challenge A      Challenge B      Challenge C
              │                │                │
        Parent Solver     Parent Solver     Parent Solver
              │
       ┌──────┼─────────┐
       ▼      ▼         ▼
 Specialist Intent A  Intent B
       │      │         │
       └──────┴────┬────┘
                   ▼
             Evidence merge
                   │
          ┌────────┴────────┐
          │                 │
       stalled          candidate
          │                 │
        Critic           Verifier
          │                 │
          └────────┬────────┘
                   ▼
              WQ_RESULT
                   │
                   ▼
               Controller
                   │
                   ▼
             Platform submit
```

## 10. 结论

**每道题不需要多个完整 Solver。** 更合理的是：

- 1 个 Parent Solver 负责事实与决策；
- 2–3 个首轮差异化 lane；
- 难题/revisit 时逐步增加 lane；
- Critic 按需启动；
- candidate 出现后独立 Verifier；
- Controller 跨题调度；
- Advisor 做全局资源监督。

这比“每题开 4 个 Solver 看谁先撞出 flag”更稳定，也更适合真实比赛中的请求额度、时间和上下文管理。
