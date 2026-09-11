# Wanwandequ Skill Source Notes

Wanwandequ's bundled CTF skills are original, compact playbooks written for the OMP runtime. They are not vendored copies of upstream documentation or payload collections.

The playbooks were designed after reviewing widely used public security/CTF resources, especially:

- `swisskyrepo/PayloadsAllTheThings` (MIT): web exploit classes, parser/filter boundaries, payload-family organization.
- `danielmiessler/SecLists` (MIT): scoped discovery/fuzzing dictionaries and the principle of using targeted lists rather than blind exhaustive fuzzing.
- `ctf-wiki/ctf-wiki`: category taxonomy and CTF-oriented decision paths across PWN, reverse, crypto, web and misc.
- `Gallopsled/pwntools` (MIT): reproducible exploit scripting, ELF/ROP/process/network primitives, and exploit-development ergonomics.
- `angr/angr` (BSD-2-Clause): symbolic execution, constraint solving, path control, hooking and state-explosion considerations.
- `jvdsn/crypto-attacks` (MIT): prerequisite-driven cryptographic attack selection and validation.
- `zardus/ctf-tools` (BSD-3-Clause): practical CTF tool taxonomy and environment/tool-selection breadth.
- `HackTricks-wiki/hacktricks`: broad offensive-security technique taxonomy used only as conceptual coverage input.

## Integration policy

1. Do not copy upstream prose/payload databases into the binary.
2. Encode decision criteria, prerequisites, failure conditions and handoff state rather than giant technique lists.
3. Prefer a short skill that tells the model *when* to use a tool over a long skill that dumps commands into context.
4. Treat external tools as optional capabilities discovered at runtime; a missing tool must not stall the solver.
5. Keep challenge evidence and provenance in `WQ_STATE.md` so fresh contexts can continue without re-reading the entire knowledge base.

This approach keeps the competition binary small, avoids prompt/context bloat, and preserves clear licensing boundaries while still benefiting from mature public CTF methodology.
