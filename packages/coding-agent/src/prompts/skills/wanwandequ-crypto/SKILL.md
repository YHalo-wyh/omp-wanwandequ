---
name: wanwandequ-crypto
description: Fast-path CTF crypto workflow for formalizing the math early, selecting the cheapest valid attack, and producing a reproducible solver.
---

# Wanwandequ Crypto Fast Path

Use this skill for authorized CTF cryptography. Convert prose and code into exact equations before trying attacks.

## Normalize the problem

Record primitives, parameters, modulus/group sizes, public/private relations, leak structure, randomness assumptions, encoding, padding, and every known sample. Reimplement the challenge transform in a small script and verify it against at least one provided sample when possible.

## Attack selection

Choose the cheapest mathematically justified route. Examples include weak RSA relations, low exponent/padding mistakes, shared factors, partial key exposure, lattice/small-root structure, nonce reuse, linear algebra/LWE leakage, biased randomness, algebraic recovery, hash/MAC misuse, stream reuse, and protocol state mistakes. Do not jump to brute force or a lattice solely because the numbers look large.

When an attack has bounds or success conditions, calculate them explicitly before spending time. For lattice work, state unknown bounds and dimensions. For modular/root attacks, verify candidate roots against the original equations. For probabilistic attacks, use small validation experiments before scaling.

## Tool policy

Prefer Python/PyCryptodome, z3, Sage, gmpy2, and purpose-built scripts. Keep expensive jobs bounded and checkpointable. If a tool is unavailable, implement the narrow required operation rather than blocking the whole solve.

## Artifacts and flag

Save the final solver and recovered intermediate values needed to reproduce the result. A candidate flag must be produced by the solver/decoder or by actual protocol output; verify it by rerunning the minimal derivation.
