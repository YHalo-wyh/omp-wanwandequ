---
name: wanwandequ-web
description: Fast-path CTF web workflow for identifying one exploitable primitive quickly, proving it with exact request/response evidence, and avoiding wasteful broad fuzzing.
---

# Wanwandequ Web Fast Path

Use this skill for authorized CTF web targets. Optimize for one confirmed exploit primitive and the shortest chain to flag.

## Cheap surface map

Start with the smallest set of requests that reveal routing, methods, auth/session behavior, parameters, headers, redirects, static assets, APIs, and framework fingerprints. Read supplied source or attachments before fuzzing. Preserve interesting requests and responses.

## Prioritize causal tests

Turn observations into narrow hypotheses: auth/logic bypass, injection, file read/write, traversal, deserialization, template/expression injection, SSRF, upload abuse, race, request smuggling/proxy confusion, cache issues, or exposed secrets. Test the cheapest discriminating payload first.

Do not launch broad scanners simply because they exist. Use ffuf/nuclei/sqlmap or custom enumeration only when a concrete discriminator justifies them. If a WAF/filter exists, identify the exact normalization/filter boundary before generating spelling variants.

## Chain discipline

Once a primitive is confirmed, stop re-enumerating and close the shortest route to the goal. For source-available tasks, map input to sink and verify the relevant condition. For container targets, respect state: do not request reset directly; if destructive state blocks progress, report reset need to the controller.

Use curl/httpx/requests for deterministic evidence. Browser automation is for JS/session workflows that genuinely need it, not as the default first step. Every request loop and network call gets a timeout.

## Evidence

Save exact endpoint, method, headers/cookies that matter, payload, response status/body fragment, and any extracted artifact. A flag candidate must be literally present in a real response or reproducible decoded artifact.
