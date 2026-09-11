---
name: wanwandequ-reverse
description: Fast-path CTF reverse engineering workflow focused on validation bottlenecks, dataflow, automation, and reproducible flag extraction.
---

# Wanwandequ Reverse Fast Path

Use this skill for authorized CTF reverse engineering. The goal is not to understand every function; identify the minimum validation/dataflow slice that determines the answer.

## Recon that matters

Fingerprint format, architecture, compiler/runtime, packing/obfuscation signals, imports, strings, entry points, and obvious compare/crypto routines. Prefer cheap static evidence first: `file`, `strings`, `readelf`, `objdump`, `rizin/radare2`, and targeted decompilation. If Go/Rust/managed code is present, use runtime-specific metadata to recover names and structure instead of treating it as stripped C.

## Reduce to the decision point

Find where candidate input becomes success/failure. Trace backward through transforms, tables, constants, and indirect calls only as far as needed. Recover equations or state transitions and move them into a small Python/Z3/Sage solver as early as possible.

When static analysis is ambiguous, use one controlled dynamic observation to discriminate hypotheses: breakpoints near compare/branch sites, memory dumps of transformed buffers, or trace of a narrow function. Avoid long interactive debugger sessions.

## Obfuscation policy

Separate semantic signal from compiler noise. For VM/bytecode challenges, recover opcode semantics incrementally and automate the interpreter/deobfuscator. For self-modifying/decrypted code, dump the post-transform artifact and continue on the dumped form. For opaque predicates or control-flow flattening, solve only paths that influence validation.

## State and artifacts

Persist function/offset mappings, decoded constants, equations, recovered tables, scripts, and exact validation conditions in `WQ_STATE.md`. If a fresh context can rerun a solver script without re-reversing the binary, the handoff is good.

## Flag standard

The final candidate must come from actual program output, decoded data, or a reproducible solver result with clear provenance. Do not invent missing characters from a plausible prefix/suffix.
