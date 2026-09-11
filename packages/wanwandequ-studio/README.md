# 万万得取 Studio

万万得取 Studio 是 `omp-wanwandequ` 的桌面 CTF IDE。它的原则只有一条：**GUI 只做控制、输入输出和只读观测，不重写也不削弱 OMP Agent 的执行链。** 模型请求、MCP、Skill、Task/Subagent、Hub、工具调用、上下文压缩和比赛调度仍全部运行在原生 `omp-wanwandequ` 进程中。

## v0.3

- 全中文 IDE 界面，重做工作区、对话、文件预览、原生终端和右侧 Inspector。
- 左侧工作区不再是“摆设”：目录可展开，文本文件可在 Studio 内预览，PDF/二进制可交给系统默认程序打开。
- 独立对话区与输入框。消息通过 `GUI -> PTY -> omp-wanwandequ` 原样发送，不由 Studio 直接调用模型。
- 原生 xterm PTY 继续完整保留，任何时候都能切回 OMP 自己的交互终端。
- 右侧增加“运行 / 工具 / 上下文 / 配置”四个面板。
- 工具面板只读观察 PTY 中出现的 bash/read/edit/task/MCP 等调用迹象，不拦截、不重放、不修改工具参数。
- 上下文面板只在 OMP 原生输出提供可解析 token 数据时显示占用；没有数据时明确显示未知，不伪造百分比。
- 配置面板直接读写 Wanwandequ 已支持的运行变量：
  - `DEEPSEEK_API_KEY`
  - `WQ_TEAM_TOKEN`
  - `WANWANDEQU_PROVIDER`
  - `WANWANDEQU_PRESET` (`safe` / `turbo` / `max`)
  - `WQ_QUERY_URL`
  - `WQ_RESET_URL`
  - `WQ_SUBMIT_URL`
- 比赛模型仍锁定 `deepseek-v4-flash`。Studio 不提供绕过比赛模型限制的假开关。
- 运行时会把上述 `.env` 配置显式传给 sidecar，确保 GUI 中保存的配置就是 Agent 真正读取的配置。
- 正式比赛仍使用 `omp-wanwandequ run --root <workspace>`，并在 UI 中锁住对话输入，避免人工键入干扰无人值守 Agent。

## 持久状态

比赛模式继续写入：

```text
<competition-root>/.wq/state.json
<competition-root>/.wq/events.jsonl
```

`state.json` 保存题目当前真值，`events.jsonl` 保存追加式生命周期事件。Studio 退出或崩溃不会成为比赛运行时依赖；重新打开同一工作区即可恢复 Dashboard。

## 架构

```text
万万得取 Studio
  Tauri UI
    |
    +-- 对话框 / 原生终端 -- PTY --> omp-wanwandequ
    |                               |
    |                               +-- 模型与上下文
    |                               +-- MCP / Tools / Skills
    |                               +-- Task / Subagents / Hub
    |                               +-- Critic / Verifier
    |                               `-- Competition Scheduler
    |
    +-- 只读观测 -----------------> PTY stdout
    |                               .wq/state.json
    |                               .wq/events.jsonl
    |
    `-- 配置 ----------------------> ~/.omp-wanwandequ/.env
```

Studio **不是第二个 Solver**，也不参与模型推理。即使 GUI 不可用，CLI 仍是完整可靠的后备路径。

## 开发

```bash
bun install
bun --cwd packages/wanwandequ-studio run studio:dev
```

本地开发如果 `omp-wanwandequ` 不在 `PATH`，设置 `WANWANDEQU_BIN` 指向 sidecar。

检查：

```bash
bun --cwd packages/coding-agent run check:types
bun --cwd packages/wanwandequ-studio run build:web
cargo check --manifest-path packages/wanwandequ-studio/src-tauri/Cargo.toml
```
