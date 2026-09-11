---
name: wanwandequ-reverse-symbolic
description: Symbolic-execution and constraint-recovery playbook for CTF reverse tasks using angr/Z3 only when they beat manual reversing.
---

# Wanwandequ Symbolic Reverse Fast Path

Use when validation is path-heavy, branchy, or naturally expressible as constraints. Do not start angr merely because a binary is stripped.

## Decide whether symbolic execution is justified

Good targets have a bounded input, a recognizable success/failure condition, manageable state, and limited interaction with unsupported syscalls/environment. Poor targets have huge loops, heavy threading, crypto implemented as long concrete loops, GUI/runtime glue, or a validation core that can be recovered faster by static slicing.

## Build the smallest model

Locate success and avoid addresses or equivalent predicates first. Constrain input length and character domain aggressively from real evidence. Disable irrelevant shared libraries where appropriate. Hook expensive deterministic helpers or model them with compact constraints instead of symbolically executing every instruction.

## Control path explosion

Use find/avoid sets, veritesting/selective stepping, state pruning, loop bounds, and concrete execution of irrelevant setup. If active states grow without yielding new information, stop and return to static analysis rather than increasing resource limits blindly.

## Constraint extraction alternative

If angr is overkill, lift only the relevant operations into Python/Z3. Preserve signedness, integer width, shifts/rotates, endianness, table indexing, and overflow semantics exactly. Validate recovered candidates against the original binary.

## Evidence and handoff

Persist success/avoid locations, input model, hooks, constraints, and the solver script. A symbolic result is not a flag until it is replayed against the actual program or otherwise validated by the original transformation.
