---
name: wanwandequ-pwn-heap
description: Focused modern glibc heap exploitation playbook for CTF tasks, emphasizing allocator state, safe-linking, overlap/leak/write primitives, and reproducible pwntools exploits.
---

# Wanwandequ Modern Heap Fast Path

Use only after a heap-specific primitive is evidenced. Do not force a named technique onto a bug.

## Allocator fingerprint

Confirm glibc/loader version when possible, then record the relevant allocator rules: tcache availability and per-bin counts, safe-linking, fastbin/smallbin/unsorted behavior, consolidation conditions, top chunk constraints, and whether hooks are still present in that version.

## Primitive-first reasoning

Write the exact primitive before choosing a chain:
- UAF read / UAF write
- double free
- null/off-by-one/off-by-null
- overflow into next chunk metadata
- arbitrary free
- controlled size/index confusion
- overlap already obtained

Then derive the shortest useful capability: heap leak, libc leak, controlled allocation, overlap, arbitrary read, arbitrary write, or control-flow target.

## State accounting

Maintain a compact table in `WQ_STATE.md` for each important allocation: index, requested size, chunk size, address if known, in-use/free, current bin, fd/bk or protected next value, and relationship to top/neighbor chunks. Record every allocator transition that the exploit depends on.

For safe-linking, never guess. Derive or verify the protected pointer relation from an actual chunk address/leak before poisoning.

## Route selection

Prefer a route with fewer allocator-sensitive transitions. Typical building blocks include tcache poisoning after pointer recovery, fastbin duplication where version permits, unsorted-bin leak, overlap construction, consolidation abuse, large/small-bin metadata abuse, and top-chunk attacks only when the version and reachable size arithmetic actually allow them.

Avoid cargo-cult "house" names. State the invariant being violated and the resulting primitive.

## Exploit engineering

Use pwntools and keep local/remote modes together. Encode chunk sizes and menu actions in named helpers. Assert expected leaks/ranges during development so a bad allocator state fails early. Save one deterministic exploit script and the exact output that produced the candidate flag.
