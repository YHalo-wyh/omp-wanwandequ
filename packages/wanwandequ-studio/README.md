# Wanwandequ Studio

Wanwandequ Studio is a lightweight desktop CTF IDE for the standalone `omp-wanwandequ` competition runtime. The GUI is deliberately an observer/control shell around the existing agent: model requests, OMP task/subagent concurrency, hub coordination, tools, skills and the competition scheduler remain in the native agent process.

## v0.2 scope

- VS Code/Zed-like three-pane layout.
- Real PTY-backed embedded terminal using `portable-pty` + xterm.js.
- Workspace picker and top-level file browser.
- TEST MODE / ARMED status with explicit `chat` versus `run --root <workspace>` launch paths.
- Start interactive agent, solve current workspace, run doctor, stop agent, or start unattended competition mode.
- Persistent Competition Dashboard sourced from `.wq/state.json` and `.wq/events.jsonl` rather than terminal-text scraping.
- Challenge cards show solved/running state, category, visit count, confirmed-fact count and artifact count.
- Accepted/rejected submit counters are reconstructed from the append-only event stream after Studio restarts.
- Bundled Windows x64 `omp-wanwandequ` sidecar in the Studio installer.
- Studio activity and agent audit data remain under the chosen workspace.

The GUI never receives or displays stored API key or team-token values. Structured observer events also deliberately omit complete flag candidates and credentials.

## Persistent observer protocol

Competition mode writes two complementary machine-readable files:

```text
<competition-root>/.wq/state.json
<competition-root>/.wq/events.jsonl
```

`state.json` is the durable current truth for each challenge (visits, solved state, facts, rejected paths, artifacts and handoff). `events.jsonl` is an append-only lifecycle stream for transient state such as challenge starts, visit completions, resets and submissions.

This separation lets Studio close or crash without becoming a competition-runtime dependency. Reopening the same workspace rebuilds the dashboard from disk; the solver does not need the GUI to stay alive.

## Development

```bash
bun install
bun --cwd packages/wanwandequ-studio run studio:dev
```

For local development set `WANWANDEQU_BIN` to the standalone agent path if it is not already on `PATH`.

Useful checks:

```bash
bun --cwd packages/coding-agent run check:types
bun --cwd packages/wanwandequ-studio run build:web
cargo check --manifest-path packages/wanwandequ-studio/src-tauri/Cargo.toml
```

## Architecture

```text
Wanwandequ Studio
  Tauri + xterm.js
        |
        +---- PTY stdin/stdout ----> omp-wanwandequ
        |                               |
        |                               +-- OMP task/subagents/hub
        |                               +-- verifier / critic / skills
        |                               `-- competition scheduler
        |
        `---- observer ------------> .wq/state.json
                                     .wq/events.jsonl
                                     workspaces/*
                                     logs/*
```

Studio is intentionally not a second solver and does not participate in model reasoning. The CLI remains the reliable fallback and the GUI is not a single point of failure.
