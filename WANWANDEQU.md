# OMP-Wanwandequ

`omp-wanwandequ` is a standalone competition agent derived from OMP v18.1.17 for the 2026 Bay Area Cup autonomous CTF challenge. It installs beside normal OMP and uses its own config root (`~/.omp-wanwandequ`), so `omp` and `omp-wanwandequ` do not overwrite each other's sessions or credentials.

## Public command

The user-facing command is **not** `omp wq`:

```text
omp-wanwandequ doctor
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

## Install

After a GitHub Release contains the branded binaries, Windows PowerShell installation is:

```powershell
irm https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/main/scripts/install-wanwandequ.ps1 | iex
```

Linux/macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/main/scripts/install-wanwandequ.sh | bash
```

The release assets are named `omp-wanwandequ-windows-x64.exe`, `omp-wanwandequ-linux-x64`, and corresponding ARM/macOS variants. Development is currently on `wq/competition-v1`; do not use the install one-liners until that branch is merged/released.

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

This is intentionally aligned with the contest's Web, PWN, reverse, crypto and forensics coverage and with its explicit emphasis on prompt engineering, RAG/knowledge organization and structured Skill development.

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

## Build

Focused CI type-checks and tests WQ code, validates the branded release build plan, and then cross-builds a Windows x64 artifact from `packages/coding-agent/src/wanwandequ-cli.ts`:

```bash
bun scripts/ci-release-build-wanwandequ.ts --targets win32-x64
```

The release binary is intentionally a separate executable named `omp-wanwandequ`, not a replacement for `omp`.
