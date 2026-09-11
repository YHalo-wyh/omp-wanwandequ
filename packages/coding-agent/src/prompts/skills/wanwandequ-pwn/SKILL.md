---
name: wanwandequ-pwn
description: Fast-path CTF PWN workflow for turning an observed primitive into a reproducible exploit with minimal wasted reversing.
---

# Wanwandequ PWN Fast Path

Use this skill for authorized CTF binary exploitation. Optimize for time-to-working exploit and preserve evidence that a fresh context can reuse.

## First decisive pass

Establish only what changes exploit choice: architecture, PIE/NX/canary/RELRO, libc/loader availability, input/output contract, and the vulnerable primitive. Prefer `file`, `checksec`, `readelf`, `objdump`, `nm`, `strings`, targeted decompilation, and one controlled crash over broad reversing.

Write confirmed offsets, symbols, leaks, allocator/libc version, and remote target details to `WQ_STATE.md`. Distinguish PIE-relative offsets from absolute runtime addresses.

## Choose the shortest justified chain

Prefer the lowest-complexity exploit family supported by evidence: ret2win or logic abuse first; then ROP/ret2libc, format string, stack pivot, shellcode/SROP, or heap exploitation. Do not commit to a family before confirming its required primitive.

For stack bugs, determine exact overwrite offset and calling convention. For format strings, map argument positions and write/leak capability before constructing a full payload. For heap bugs, record glibc version, chunk sizes, bin transitions, tcache state, safe-linking assumptions, and the exact read/write/UAF primitive before trying a named house technique.

## Execution discipline

Use pwntools/Python for reproducibility. Keep local and remote modes in one exploit when practical. Dynamic checks should use noninteractive GDB batch commands. Every network/process interaction gets a timeout. Save working scripts as artifacts instead of rebuilding them in later visits.

After two failures with the same causal reason, mark the route rejected and switch primitive or chain. Do not brute-force ASLR, canaries, or libc guesses when a deterministic leak or ELF evidence is available.

## Flag standard

A candidate flag is valid only if it appears in actual process/network output or a reproducible extraction artifact. Preserve the command/script and relevant output line for the verifier.
