# 万万得取 Studio

万万得取 Studio 是 `omp-wanwandequ` 的桌面客户端。v0.4 开始，核心原则从“给 TUI 套 GUI”改成 **Runtime-first**：Studio 只负责控制、展示、配置和用户输入，Agent 本身继续运行在原生 OMP Runtime 中。

## v0.4：不再用 PTY 当 API

旧版主链路：

```text
Studio -> PTY -> OMP TUI -> AgentSession
              <- ANSI/终端刷新 <-
```

这条链路会把全屏 TUI 当成机器接口，容易出现输入没有真正送达、ANSI/光标刷新无法还原对话、工具状态靠正则猜测等问题。

v0.4 改为：

```text
Studio
  |
  | JSONL RPC
  v
omp-wanwandequ runtime
  |
  v
OMP AgentSession
  +-- Model / Context
  +-- Tools / MCP / Skills
  +-- Task / Subagents / Hub
  +-- Compaction / Retry / Loop Guard
  `-- Wanwandequ policy
```

`omp-wanwandequ runtime` 直接复用 OMP 自带的 headless RPC 模式。它不是第二套 Agent，也不是 Studio 自己实现的工具代理。

### Studio 直接消费的原生事件

- `message_start / message_update / message_end`
- `tool_execution_start / update / end`
- `subagent_lifecycle / progress / event`
- `auto_compaction_*`
- `model_changed / thinking_level_changed`
- `get_state.contextUsage`
- Extension UI request / response

因此对话、工具调用和上下文不再从终端文本猜测。

## 两种运行路径

### 交互测试 / Studio

```bash
omp-wanwandequ runtime --preset turbo
```

stdin/stdout 使用 OMP 原生 JSONL RPC。Studio 启动这个 Runtime 并作为客户端连接。

原生 TUI 仍然完整保留用于调试：

```bash
omp-wanwandequ chat --preset turbo
```

Studio 中“打开原生 OMP TUI”也只会打开独立调试终端，不再承担正常对话通信。

### 正式比赛

正式比赛仍走无人值守 headless 路径：

```bash
omp-wanwandequ run --root <workspace> --preset turbo
```

比赛调度不经过 Studio 的聊天 Runtime。`.wq/state.json` 与 `.wq/events.jsonl` 仍是 Dashboard 的恢复来源。

## 能力边界

Studio 不会：

- 自己调用模型；
- 代理或重写 OMP 工具；
- 重新实现 MCP；
- 修改 Subagent prompt 后再转发；
- 从 ANSI 文本猜 tool call；
- 绕过比赛锁定模型。

配置面板写入并传递 Wanwandequ 原生变量：

- `DEEPSEEK_API_KEY`
- `WQ_TEAM_TOKEN`
- `WANWANDEQU_PROVIDER`
- `WANWANDEQU_PRESET`
- `WANWANDEQU_THINKING`
- `WQ_QUERY_URL`
- `WQ_RESET_URL`
- `WQ_SUBMIT_URL`

比赛模型继续锁定 `deepseek-v4-flash`。

## 持久状态

```text
<competition-root>/.wq/state.json
<competition-root>/.wq/events.jsonl
<competition-root>/workspaces/<challenge>/WQ_STATE.md
<competition-root>/logs/
```

`state.json` 保存当前真值，`events.jsonl` 保存追加式生命周期事件。Studio Dashboard 读取这些机器状态，而不是解析终端字符串。

## 开发与验证

```bash
bun install
bun --cwd packages/coding-agent run check:types
bun test packages/coding-agent/test/wq-events.test.ts
bun test packages/wanwandequ-studio/src/runtime-protocol.test.ts
bun --cwd packages/wanwandequ-studio run build:web
cargo check --manifest-path packages/wanwandequ-studio/src-tauri/Cargo.toml
```

本地开发：

```bash
bun --cwd packages/wanwandequ-studio run studio:dev
```

如果 `omp-wanwandequ` 不在 `PATH`，设置 `WANWANDEQU_BIN` 指向对应二进制。

CI 打包 Studio 时会从**同一个 commit**构建并嵌入 `omp-wanwandequ` sidecar，不再下载旧的 `wq-dev` 二进制，避免 GUI 与 Runtime 协议版本错配。
