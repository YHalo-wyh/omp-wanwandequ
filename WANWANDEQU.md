# OMP-Wanwandequ

`omp-wanwandequ` is a standalone competition agent derived from OMP v18.1.17 for the 2026 Bay Area Cup autonomous CTF challenge. It installs beside normal OMP and uses its own config root (`~/.omp-wanwandequ`), so `omp` and `omp-wanwandequ` do not overwrite each other's sessions.

## Open-box Windows setup

For the current rolling competition build, open PowerShell **inside the directory you want to use as the contest working directory** and run one command:

```powershell
irm https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/wq/competition-v1/scripts/install-and-run-wanwandequ.ps1 | iex
```

The script will:

1. Download the current `wq-dev` Windows x64 build.
2. Verify the published SHA-256 when present.
3. Install it as `%LOCALAPPDATA%\Programs\omp-wanwandequ\omp-wanwandequ.exe`.
4. Add that directory to the current and user PATH without replacing normal `omp`.
5. On first setup, copy only reusable config/model/auth files from `~/.omp` into the standalone `~/.omp-wanwandequ` tree when those files exist. It does not copy sessions, logs, workspaces or caches.
6. Create `./logs` in the launch working directory.
7. Run `doctor`, then open a new PowerShell terminal in the same working directory and start the interactive agent.

After installation, typing:

```powershell
omp-wanwandequ
```

opens the native Wanwandequ OMP TUI. Double-clicking the standalone EXE also enters the interactive agent instead of printing help and closing immediately.

To install without opening the interactive terminal:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/wq/competition-v1/scripts/install-and-run-wanwandequ.ps1))) -NoLaunch
```

## Audit logs

Every standalone invocation mirrors console output into the **launch working directory**:

```text
<workdir>/logs/omp-wanwandequ-YYYYMMDD-HHMMSS.log
```

The header records start time, working directory and redacted command-line arguments. `--token` values are never written into the audit header. Competition mode additionally preserves per-challenge visit stdout/stderr and persistent state under the run root, so the original solving trail can be inspected after the round.

Launch the final competition from the directory you want the organizer to inspect, for example:

```powershell
mkdir D:\BayAreaCup\final -Force
cd D:\BayAreaCup\final
$env:WQ_TEAM_TOKEN = "<team-token>"
omp-wanwandequ run --preset turbo
```

The resulting `logs/`, `workspaces/` and `.wq/` state all stay under that run directory.

## Public commands

```text
omp-wanwandequ                         interactive Wanwandequ TUI
omp-wanwandequ chat                    explicit TUI form
omp-wanwandequ doctor
omp-wanwandequ agents
omp-wanwandequ presets
omp-wanwandequ solve <challenge>
omp-wanwandequ bench <historical-challenge>
omp-wanwandequ run
```

The internal `wq` prefix still exists only so worker subprocesses can re-enter the same compiled binary safely.

## Model lock

The competition build exposes one model only:

```text
deepseek-v4-flash
```

All OMP roles (`default`, `task`, `smol`, `slow`, `plan`, `vision`, `tiny`, `advisor`, `commit`) are forced to the same model and automatic model fallback is disabled. `--model` and `--provider` are rejected by the Wanwandequ competition CLI.

Default transport provider is `deepseek`. If the organizer supplies a custom OpenAI/Anthropic-compatible gateway, set only:

```text
WANWANDEQU_PROVIDER=<provider-id>
```

and define that provider in the isolated Wanwandequ `models.yml`. The model id remains `deepseek-v4-flash`.

## Competition architecture

Wanwandequ combines OMP's mature tool runtime with deterministic contest control:

```text
Competition API
    |
    v
Controller / scheduler
    |-- poll + download + priority + retry
    |-- reset arbitration
    |-- deterministic flag grounding
    `-- submit only after verification

Per challenge parent
    |-- matching specialist (pwn/reverse/web/crypto/forensics)
    |-- distinct Intent worker lanes
    |-- hub: continue promising peer context
    |-- critic: fresh-context anti-stall
    `-- verifier: adversarial candidate validation

Persistent external state
    FACTS / REJECTED / ARTIFACTS / HANDOFF / rejected flags
```

The solver child never receives `WQ_TEAM_TOKEN`; only the controller can reset or submit.

## Bundled Skills

The standalone binary contains authored fast-path playbooks for:

```text
wanwandequ-pwn
wanwandequ-reverse
wanwandequ-web
wanwandequ-crypto
wanwandequ-forensics
wanwandequ-protocol
wanwandequ-incident
```

At solve start they are materialized into the isolated challenge workspace as normal OMP Skills, so the parent and delegated subagents discover the same category playbooks. A category hint routes to the relevant `skill://wanwandequ-*` playbook before deep analysis.

## Why specialist + Intent lanes

Running four cold full solvers wastes wall-clock on duplicate `file/strings/checksec`, duplicate route discovery, and repeated context setup. Wanwandequ instead spends concurrency on different causal branches. One category specialist carries a concise structured Skill; remaining lanes test mutually distinct hypotheses. A promising lane is continued with `hub` instead of discarded.

Bundled competition agents:

```text
wq-solver
wq-worker
wq-critic
wq-verifier
wq-pwn
wq-reverse
wq-web
wq-crypto
wq-forensics
```

## Platform integration

`omp-wanwandequ run` reads:

```text
WQ_TEAM_TOKEN        required
WQ_QUERY_URL         optional override
WQ_RESET_URL         optional override
WQ_SUBMIT_URL        optional override
WANWANDEQU_PROVIDER  optional organizer gateway provider id
WANWANDEQU_PRESET    safe|turbo|max
WANWANDEQU_THINKING  optional thinking override
```

The parser deliberately handles organizer quirks: `interactive` is a string, `connection` can be `[]` or an object, `file_url` may be empty, and `docker_url` may represent either an `nc` target or a Web endpoint. Reset is controller-only and used only for interactive/container tasks.

## Scheduling

The contest gives equal-value autonomous tasks and time matters, so the scheduler prioritizes expected points per minute. `solved_number` is treated as a live ease signal, while existing FACTS/artifacts increase the value of finishing a partially solved task. Repeated visits are penalized so one hard problem cannot consume the whole round. In the last five minutes, rescue mode favors problems with accumulated progress.

Starting presets:

| preset | active challenges | lanes / challenge | visit cap | intended use |
|---|---:|---:|---:|---|
| safe | 2 | 2 | 240 s | provider/tool validation |
| turbo | 4 | 4 | 300 s | default competition mode |
| max | 6 | 6 | 330 s | tested burst/rescue only |

Provider in-flight concurrency is bounded above the expected active lane count instead of using unbounded fan-out. The local memory guard prevents additional challenge parents when the laptop is under pressure.

## Failure recovery

Wanwandequ does not let model prose decide lifecycle. A visit has a hard wall-clock cap. OMP tool-loop protection catches repeated calls; the prompt forces a pivot after duplicated failures; partial state is externalized to `WQ_STATE.md`; the scheduler can start a fresh context from that state. Provider retry uses short exponential backoff and model fallback is forbidden.

A model saying "solved" is insufficient. The candidate must survive `wq-verifier`, the exact literal flag must occur in concrete evidence, rejected candidates are persisted, and final truth comes from the competition platform (`status == 1` / `is_solved`).

## Historical-task A/B

Use solved historical challenges before the final:

```powershell
omp-wanwandequ bench .\history\pwn1.zip --category pwn --expect "flag{known}" --repeat 5 --preset turbo
```

Compare solve rate and median time-to-flag for `safe/turbo/max`, inner lane counts, thinking levels and advisor on/off. Keep only changes that improve repeated runs; do not tune from a single lucky solve.

## Build and rolling release

Focused CI type-checks and tests WQ code, stages the matching Windows native addon, cross-builds `omp-wanwandequ-windows-x64.exe`, emits SHA-256, and publishes the successful branch build to the rolling prerelease tag `wq-dev`.

```bash
bun scripts/ci-release-build-wanwandequ.ts --targets win32-x64
```

The release binary is intentionally a separate executable named `omp-wanwandequ`, not a replacement for `omp`.
