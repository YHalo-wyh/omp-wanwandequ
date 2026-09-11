---
name: wanwandequ-web-matrix
description: Evidence-driven web exploit decision matrix distilled for CTF use from common payload repositories and web-security playbooks.
---

# Wanwandequ Web Exploit Matrix

Use after the initial endpoint/parameter map. The objective is to test the smallest payload family that can discriminate a real sink or parser boundary.

## Input-to-sink matrix

For each controllable input, classify where it plausibly lands: SQL/query builder, template/expression engine, shell/process invocation, filesystem/path, URL fetcher, serializer/deserializer, XML parser, browser/HTML/JS context, header/proxy/cache layer, upload pipeline, authentication/authorization decision, or internal API object binding.

Do not spray every payload family. Pick one family whose observable result distinguishes the hypothesis.

## High-yield discriminators

- SQL: syntax/boolean/time/error behavior before automated dumping.
- SSTI/expression: harmless arithmetic/property access before RCE payloads.
- Command injection: delimiter/latency/output markers before full shell chains.
- Traversal/file read: normalization and root boundary before deep wordlists.
- SSRF: controlled callback/internal metadata reachability before chaining.
- Deserialization: identify serializer and gadget surface before generating blobs.
- XSS: determine exact HTML/attribute/JS/URL context and escaping before payload selection.
- Upload: extension, MIME, magic, storage path, execution/parse behavior as separate gates.
- Auth/IDOR: compare object ownership and server-side authorization, not just hidden UI controls.
- Request smuggling/proxy issues: prove parser disagreement with minimal requests before long sequences.

## Bypass policy

When a filter/WAF blocks the baseline, identify the transformation boundary: URL decode count, Unicode/case normalization, path normalization, parser differential, quote/comment handling, content type, transfer encoding, or framework binding. Generate variants only for the confirmed boundary; avoid blind mutation storms.

## Wordlists and scanners

Use SecLists-style discovery lists or automated tools only after narrowing scope (specific extension, parameter family, directory prefix, or vulnerability class). Keep concurrency bounded to avoid self-inflicted target instability. Save exact commands and meaningful responses.

## Evidence standard

A route becomes FACT only with a reproducible request/response pair. Preserve method, endpoint, key headers/cookies, body, status, and a concise response fragment or timing measurement.
