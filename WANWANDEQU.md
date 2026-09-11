# OMP-Wanwandequ

`omp-wanwandequ` is a competition-focused fork of OMP v18.1.17 for the 2026 Bay Area Cup autonomous CTF challenge.

The fork intentionally keeps OMP's normal auth/provider/MCP configuration model. WQ is a native top-level command and applies competition tuning only to WQ processes; normal `omp` usage remains normal OMP behavior.

## What is different from upstream OMP

WQ combines three ideas inside OMP's existing runtime:

- **OMP-native parallelism**: `task` batch + persistent `hub` peers + high-effort per-intent workers.
- **Fact/Intent state-space search**: confirmed facts are separated from hypotheses, rejected paths and next intents. Parallel workers receive distinct concrete intents rather than duplicating full reconnaissance.
- **Deterministic competition control**: challenge polling, scheduling, reset arbitration, candidate grounding and final submit are controlled by code rather than the model's natural-language decision.

Bundled agents:

```text
wq-solver     end-to-end solver/orchestrator
wq-worker     exactly one concrete search intent
wq-critic     fresh-context anti-stall critic
wq-verifier   adversarial flag provenance verifier
```

The normal OMP `scout`, `task`, MCP, browser, debugger/LSP and other installed capabilities remain available according to the user's existing OMP configuration.

## Build/run from source

Prerequisite: Bun 1.4.0 (the version pinned by this repository).

```bash
bun install --frozen-lockfile
bun packages/coding-agent/src/cli.ts wq doctor
```

List the embedded WQ agents and presets:

```bash
bun packages/coding-agent/src/cli.ts wq agents
bun packages/coding-agent/src/cli.ts wq presets
```

## Test one historical CTF task

Run a single local challenge through the real WQ solver:

```bash
bun packages/coding-agent/src/cli.ts wq solve ./challenge \
  --category pwn \
  --preset turbo
```

For A/B testing, use a challenge whose answer is already known:

```bash
bun packages/coding-agent/src/cli.ts wq bench ./history/pwn1.zip \
  --category pwn \
  --expect 'flag{known_answer}' \
  --repeat 3 \
  --inner 4 \
  --preset turbo
```

Compare settings rather than arguing from intuition:

```bash
# Fan-out
... wq bench ./history/pwn1.zip --expect 'flag{...}' --repeat 3 --inner 2
... wq bench ./history/pwn1.zip --expect 'flag{...}' --repeat 3 --inner 4
... wq bench ./history/pwn1.zip --expect 'flag{...}' --repeat 3 --inner 6

# Event-independent advisor A/B
... wq bench ./history/pwn1.zip --expect 'flag{...}' --repeat 3 --inner 4
... wq bench ./history/pwn1.zip --expect 'flag{...}' --repeat 3 --inner 4 --advisor
```

The primary metrics are **solve rate** and **median time-to-flag**. The benchmark writes independent workspaces and `latest-summary.json` under `.wq-bench/`.

## Competition mode

Use environment variables for organizer/model details. Never commit the team token.

```bash
export WQ_TEAM_TOKEN='...'
# Optional: pin the exact organizer-mandated model route if normal OMP defaults differ.
export WQ_PROVIDER='...'
export WQ_MODEL='deepseek-v4.1'
export WQ_THINKING='high'
```

Dry-run first (candidate flags are verified but not submitted):

```bash
omp wq run --preset turbo --duration 1800 --dry-run
```

Live round:

```bash
omp wq run --preset turbo --duration 1800
```

Final rescue/burst can use `--preset max` after local A/B testing proves the host/provider stays stable.

Organizer endpoint overrides are supported when the onsite platform changes:

```text
WQ_QUERY_URL
WQ_RESET_URL
WQ_SUBMIT_URL
```

## Why one parent per challenge

The default architecture does **not** launch several cold full solvers for one task. Instead:

```text
Challenge parent
    |
    +-- Intent A -> wq-worker
    +-- Intent B -> wq-worker
    +-- Intent C -> wq-worker
    +-- Intent D -> wq-worker
           |
         facts
           |
      promising peer --hub--> continue same context
           |
       candidate --wq-verifier--> grounded result
```

This spends model concurrency on different search branches instead of repeatedly paying for `file/strings/checksec` or the same web reconnaissance.

A stalled visit writes `WQ_STATE.md`; a later visit is a fresh parent context that resumes from confirmed facts, rejected routes and artifacts. Useful state survives, stale model context does not.

## Presets

Current starting points (to be tuned on the team's historical challenge suite):

| preset | active challenges | intent lanes / parent | visit budget | stall target |
|---|---:|---:|---:|---:|
| safe | 2 | 2 | 240 s | 120 s |
| turbo | 4 | 4 | 300 s | 90 s |
| max | 6 | 6 | 330 s | 70 s |

WQ also enables batch tasking, per-task effort, async compaction, tool-call loop protection and short provider retries, while disabling automatic model fallback so a competition-mandated model cannot silently switch to another configured model.

## Safety/reliability boundaries

- The solver child never receives `WQ_TEAM_TOKEN`.
- Solver agents are instructed not to call organizer submit/reset endpoints.
- Reset and submit are controller-owned.
- A `solved` model result is insufficient: the exact flag must appear in the result's concrete evidence/provenance, and the controller still relies on the platform response as final truth.
- Wrong submitted candidates are persisted as rejected so fresh contexts do not retry them.
- The controller uses a local memory guard and bounded challenge/intent concurrency rather than unbounded process fan-out.

## Current development branch

Until WQ CI is green and the first release artifact is built, active development lives on:

```text
wq/competition-v1
```

Do not use it for the official round before running historical-task A/B tests on the exact competition model route.
