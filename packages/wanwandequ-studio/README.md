# Wanwandequ Studio

Wanwandequ Studio is a lightweight desktop control center for the standalone `omp-wanwandequ` competition runtime. The GUI is deliberately a shell around the existing agent: model requests, OMP task/subagent concurrency, hub coordination, tools, skills and scheduler remain in the native agent process.

## v0.1 scope

- VS Code/Zed-like three-pane layout.
- Real PTY-backed embedded terminal (not a fake log viewer).
- Workspace picker and top-level file browser.
- Save/replace DeepSeek API key and competition team token without editing `.env` manually.
- TEST MODE / ARMED status.
- Start interactive agent, solve current workspace, run doctor, stop agent, or start unattended competition mode.
- Bundled Windows x64 `omp-wanwandequ` sidecar in the Studio installer.
- Studio activity and agent audit data remain under the chosen workspace `logs/` directory.

The GUI never receives or displays stored secret values. It only reports configured/not-configured state.

## Development

```bash
bun install
bun --cwd packages/wanwandequ-studio run studio:dev
```

For local development set `WANWANDEQU_BIN` to the standalone agent path if it is not already on `PATH`.

## Architecture

```text
Wanwandequ Studio (Tauri + xterm.js)
        |
        | PTY stdin/stdout
        v
omp-wanwandequ native process
        |
        +-- OMP task/subagents/hub
        +-- WQ skills + verifier/critic
        +-- deterministic competition scheduler
        +-- challenge workspaces and audit logs
```

Studio is intentionally not a second solver and does not participate in model reasoning, so GUI rendering should not materially reduce solving throughput.
