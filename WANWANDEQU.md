# OMP-Wanwandequ

`omp-wanwandequ` is a standalone competition agent derived from OMP v18.1.17 for the 2026 Bay Area Cup autonomous CTF challenge. It installs beside normal OMP and uses its own config root (`~/.omp-wanwandequ`), so `omp` and `omp-wanwandequ` do not overwrite each other's sessions.

The fork is maintained only in `YHalo-wyh/omp-wanwandequ`; Wanwandequ development does not push branches or pull requests to the upstream OMP repository.

Wanwandequ is terminal-only. There is no desktop/WebView GUI: interactive work uses the native OMP TUI, while unattended competition uses the headless controller and its persistent state/log files.

## Install like normal OMP

### macOS / Linux / WSL

The installer detects Darwin/Linux and x64/arm64 automatically:

```sh
curl -fsSL https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/main/install-wanwandequ.sh | sh
```

It installs one command at `~/.local/bin/omp-wanwandequ`, verifies SHA-256, preserves an existing `~/.omp-wanwandequ` config, and adds `~/.local/bin` to future bash/zsh shells.

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/main/install-wanwandequ.ps1 | iex
```

The PowerShell installer detects x64/arm64, verifies SHA-256, installs `%LOCALAPPDATA%\Programs\omp-wanwandequ\omp-wanwandequ.exe`, and adds it to the user PATH without replacing normal `omp`.

### Windows click installer

The rolling release also publishes:

```text
OMP-Wanwandequ-Setup-Windows-x64.exe
```

Double-click it to install the native Windows build and register `omp-wanwandequ` in PATH. WSL is not required. Linux/WSL and macOS use their own native binaries rather than a Windows bridge.

After installation on any platform:

```text
omp-wanwandequ
```

opens the native Wanwandequ OMP TUI when no competition team token is configured.

Inside the Agent use:

```text
/wq-config    configuration menu
/wq-key       set/replace DeepSeek API key
/wq-token     set/replace competition team token
/wq-status    show configured/ARMED state without revealing secrets
```

Credentials live only under the standalone Wanwandequ config root. Configuring a team token arms unattended competition mode for the next bare launch; clearing the token returns bare launch to interactive test mode.

## Audit logs

Every standalone invocation mirrors console output into the **launch working directory**:

```text
<workdir>/logs/omp-wanwandequ-YYYYMMDD-HHMMSS.log
```

The header records start time, working directory and redacted command-line arguments. Secret values are not printed into the audit header. Competition mode additionally preserves per-challenge visit stdout/stderr and persistent state under the run root, so the original solving trail can be inspected after the round.

Launch the final competition from the directory you want the organizer to inspect:

```text
cd <competition-workdir>
omp-wanwandequ
```

When `/wq-token` has configured the organizer token, that bare command enters ARMED unattended mode automatically. The resulting `logs/`, `workspaces/` and `.wq/` state stay under the launch directory.

## Public commands

```text
omp-wanwandequ                         interactive TUI in TEST MODE; autonomous run when ARMED
omp-wanwandequ chat                    force interactive TUI
omp-wanwandequ doctor
omp-wanwandequ agents
omp-wanwandequ presets
omp-wanwandequ solve <challenge>
omp-wanwandequ bench <historical-challenge>
omp-wanwandequ run                     explicit autonomous form
```

The internal `wq` prefix exists only so worker subprocesses can re-enter the same compiled binary safely.

## Model lock

The competition build exposes one model only:

```text
deepseek-v4-flash
```

All OMP roles (`default`, `task`, `smol`, `slow`, `plan`, `vision`, `tiny`, `advisor`, `commit`) are forced to the same model and automatic model fallback is disabled. `--model` and `--provider` are rejected by the Wanwandequ competition CLI.

Default transport provider is `deepseek`. If the organizer supplies a custom compatible gateway, only the provider transport may be changed; the model identity remains `deepseek-v4-flash`.

## Competition architecture

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

The standalone binary contains original compact playbooks which are materialized as normal OMP Skills inside every challenge workspace:

```text
wanwandequ-pwn
wanwandequ-pwn-heap
wanwandequ-reverse
wanwandequ-reverse-symbolic
wanwandequ-web
wanwandequ-web-matrix
wanwandequ-crypto
wanwandequ-crypto-matrix
wanwandequ-forensics
wanwandequ-protocol
wanwandequ-incident
wanwandequ-misc-triage
```

The skill design was informed by mature public CTF/security resources such as PayloadsAllTheThings, SecLists, CTF Wiki, pwntools, angr, crypto-attacks, ctf-tools and HackTricks. The upstream prose/payload databases are **not** copied into the binary; Wanwandequ keeps original prerequisite/decision-oriented summaries so context remains small and licensing boundaries remain clear. See `docs/WQ_SKILL_SOURCES.md`.

A category hint selects a primary skill plus focused micro-skills only where they can change the decision path. Example: a generic PWN task gets `wanwandequ-pwn`; a heap-labelled task also gets `wanwandequ-pwn-heap`.

## Why specialist + Intent lanes

Running four cold full solvers wastes wall-clock on duplicate `file/strings/checksec`, duplicate route discovery, and repeated context setup. Wanwandequ instead spends concurrency on different causal branches. One category specialist carries the main Skill; remaining lanes test mutually distinct hypotheses. A promising lane is continued with `hub` instead of discarded.

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

Competition mode uses the organizer API endpoints compiled into the controller and reads `WQ_TEAM_TOKEN` from the isolated Wanwandequ configuration. Optional runtime settings include:

```text
WQ_QUERY_URL         optional override
WQ_RESET_URL         optional override
WQ_SUBMIT_URL        optional override
WANWANDEQU_PROVIDER  optional organizer gateway provider id
WANWANDEQU_PRESET    safe|turbo|max
WANWANDEQU_THINKING  optional thinking override
```

The parser deliberately handles organizer quirks: `interactive` is a string, `connection` can be `[]` or an object, `file_url` may be empty, and `docker_url` may represent either an `nc` target or a Web endpoint. Reset is controller-only and used only for interactive/container tasks.

## Scheduling

The scheduler prioritizes expected verified points per minute. `solved_number` is treated as a live ease signal, existing FACTS/artifacts increase the value of finishing a partially solved task, and repeated visits are penalized so one hard problem cannot consume the whole round. In the last five minutes, rescue mode favors problems with accumulated progress.

| preset | active challenges | lanes / challenge | visit cap | intended use |
|---|---:|---:|---:|---|
| safe | 2 | 2 | 240 s | provider/tool validation |
| turbo | 4 | 4 | 300 s | default competition mode |
| max | 6 | 6 | 330 s | tested burst/rescue only |

Provider in-flight concurrency is bounded above the expected active lane count instead of using unbounded fan-out. The local memory guard prevents additional challenge parents when the machine is under pressure.

## Failure recovery

Wanwandequ does not let model prose decide lifecycle. A visit has a hard wall-clock cap. OMP tool-loop protection catches repeated calls; the prompt forces a pivot after duplicated failures; partial state is externalized to `WQ_STATE.md`; the scheduler can start a fresh context from that state. Provider retry uses short exponential backoff and model fallback is forbidden.

A model saying `solved` is insufficient. The candidate must survive `wq-verifier`, the exact literal flag must occur in concrete evidence, rejected candidates are persisted, and final truth comes from the competition platform (`status == 1` / `is_solved`).

## Historical-task A/B

Use solved historical challenges before the final:

```text
omp-wanwandequ bench <challenge> --category pwn --expect "flag{known}" --repeat 5 --preset turbo
```

Compare solve rate and median time-to-flag for `safe/turbo/max`, inner lane counts, thinking levels and advisor on/off. Keep only changes that improve repeated runs; do not tune from a single lucky solve.

## Builds and release

WQ CI type-checks/tests the fork and builds native standalone binaries for:

```text
Windows x64 / arm64
macOS x64 / arm64
Linux x64 / arm64
```

The rolling prerelease tag is `wq-dev`. Windows x64 additionally gets a click-to-install setup EXE. All published binaries have SHA-256 sidecars.

The release binary is intentionally named `omp-wanwandequ`, not `omp`, and is maintained only in the Wanwandequ fork.