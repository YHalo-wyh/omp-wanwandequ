---
name: wanwandequ-incident
description: Fast-path CTF incident-response and log-forensics workflow for building a compact timeline, extracting indicators, and answering the challenge objective reproducibly.
---

# Wanwandequ Incident Fast Path

Use this skill for authorized incident-response, log-analysis, and mixed forensic tasks.

## Start from the objective

Translate the challenge question into the smallest required evidence set: initial access, attacker IP/domain, account, command, persistence, exfiltration, affected host, timestamp, or final flag. Do not parse every log field when the objective needs only one causal chain.

## Normalize and correlate

Identify log sources and timestamps/timezones, then normalize key fields. Use grep/jq/awk/Python or source-specific tools to extract candidate events. Correlate authentication, process creation, network, web/proxy, DNS, file, and endpoint events around confirmed pivots.

Build a compact timeline with evidence references. When an IOC is found, pivot outward only far enough to establish cause/effect or the requested answer.

## Distinguish signal from background

Confirm suspicious events with at least one contextual clue: impossible sequence, unusual parent/child, rare destination, encoded command, privilege transition, persistence location, or matching activity across sources. Avoid treating a single keyword hit as compromise without context.

## Artifacts and flag

Save filters/scripts, normalized event snippets, key timestamps, IOCs, and the final causal chain. A candidate flag must be extracted from actual logs/artifacts or produced by a reproducible decode/derivation, with exact provenance for the verifier.
