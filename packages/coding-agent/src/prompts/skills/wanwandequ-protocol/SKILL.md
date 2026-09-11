---
name: wanwandequ-protocol
description: Fast-path protocol-analysis skill for reconstructing message framing, state transitions, crypto/compression layers, and exploit-relevant invariants.
---

# Wanwandequ Protocol Fast Path

Use this skill for authorized CTF protocol-analysis tasks, especially mixed reverse/network challenges.

## Reconstruct the wire contract

Identify transport, framing, message boundaries, endian/length fields, message types, checksums/MACs, compression/encryption, session state, and any replay/nonces. Prefer a minimal parser over manual hex inspection once two or more messages share structure.

Correlate client/server code, captures, and observed traffic. Build a small script that can parse and emit one valid message before attempting exploit logic.

## Find the security invariant

Target mismatches between parser layers, state machines, length/offset validation, authentication coverage, nonce/replay rules, serialization, or version/feature negotiation. Test one invariant at a time with controlled mutations and compare responses.

If crypto is present, first determine whether the weakness is protocol use rather than the primitive itself. If reverse engineering is needed, isolate only the functions that encode/decode or transition protocol state.

## Reliability

Every network operation gets a timeout and bounded retry. Save packet samples, parser scripts, exact message layouts, and state-transition facts. Avoid destructive mutations until a valid baseline exchange is reproducible.

## Flag standard

A candidate flag must come from a reproducible protocol exchange, decoded frame, recovered artifact, or solver output with exact provenance.
