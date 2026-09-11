---
name: wanwandequ-crypto-matrix
description: Attack-selection matrix for CTF crypto, emphasizing explicit prerequisites, bounds, and validation before expensive algebra or lattice work.
---

# Wanwandequ Crypto Attack Matrix

Use after the challenge algorithm has been normalized into exact equations. Pick attacks by prerequisites, not by buzzwords.

## RSA family

Check cheap invariants first: gcd across moduli, reused modulus/exponents, low public exponent structure, broadcast relations, shared/related messages, leaked dp/dq or CRT fragments, close/structured primes, partial prime bits, common modulus, weak padding, and algebraic relations between p/q/n. Only move to Coppersmith/lattice methods when the unknown is provably small enough and the polynomial relation is correct.

## ECC / discrete-log family

Identify group, order, subgroup structure, point validation, nonce generation, repeated or biased nonce, invalid-curve/small-subgroup behavior, and any leakage of scalar bits. Confirm whether the weakness is protocol use rather than the curve itself.

## Symmetric / stream / PRNG

Check nonce/IV reuse, mode misuse, keystream reuse, padding oracle/error side channels, weak key derivation, predictable PRNG state, truncated state/output, and reversible custom round structures. Validate block boundaries and encoding before reasoning about cryptography.

## Lattice / small-root gate

Before LLL/BKZ/Coppersmith, write the unknown bound, modulus size, polynomial degree, expected root relation, and approximate lattice dimension. If the bound is not plausible, reject the route early. After reduction, verify every candidate in the original equation.

## LWE / linear systems

Record q, dimension, sample count, noise model, secret domain, and whether the equations leak exact/rounded inner products. Try linear algebra, nearest-plane/small-error enumeration, or problem-specific leakage before generic lattice escalation.

## Hash / MAC / protocol

Check length extension conditions, secret-prefix vs HMAC distinction, collision assumptions, truncated outputs, replay/state mistakes, signing ambiguity, serialization differences, and domain separation.

## Operational rule

Every expensive attack needs a small sanity test or calculated success condition first. Save the final solver plus the parameter/bound rationale in WQ_STATE.md.
