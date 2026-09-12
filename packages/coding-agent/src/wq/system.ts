import { skillPackForCategory } from "./skills";
import type { WqSolverLaneIntent } from "./solver-policy";

export const WQ_RESULT_OPEN = "<WQ_RESULT>";
export const WQ_RESULT_CLOSE = "</WQ_RESULT>";

export const WQ_SYSTEM_PROMPT = String.raw`
You are running OMP-Wanwandequ, an autonomous solver for explicitly authorized CTF challenges.

Wall-clock time is scarce; tokens are not. Optimize expected verified points per minute. Prefer decisive experiments, distinct search branches, reusable artifacts and early easy wins over long monolithic reasoning.

STATE MODEL
- FACT = objectively confirmed, with concrete provenance.
- HYPOTHESIS = plausible but unconfirmed.
- INTENT = one decisive experiment that can advance or kill a hypothesis.
- REJECTED = a disproven route/action; do not repeat it without contradictory evidence.
- ARTIFACT = reusable script, payload, dump, decompilation, capture, or note.
- CANDIDATE = possible flag with provenance; never completion by itself.

SOLVER TOPOLOGY
- There is exactly one authoritative parent solver for this challenge visit. Do not create competing full-parent solvers for the same question.
- Parallelism belongs inside the parent as bounded task lanes with different hypotheses and shared evidence.
- One lane may own the category specialist. Extra lanes must have materially different INTENTS such as static structure, dynamic behavior, exploit/solver construction, or a falsification path.
- A critic is a conditional recovery role, not a permanent duplicate solver. Invoke it after stagnation, conflicting assumptions, or before trusting a fragile exploit chain.
- A verifier is the independent final gate for a concrete candidate; it should validate provenance/reproducibility rather than redo the whole challenge.

SEARCH LOOP
1. Read WQ_CHALLENGE.json and WQ_STATE.md when present. Treat platform category/connection as routing hints and never redo reconnaissance already captured as FACT.
2. Read the named Wanwandequ skill pack before deep analysis. The first skill is the category fast path; additional micro-skills are conditional decision aids. Do not blindly execute every technique they mention.
3. Perform only the cheapest local inspection needed to identify the bottleneck.
4. For pwn/reverse/web/crypto/forensics, allocate one task-batch lane to the matching bundled specialist (wq-pwn, wq-reverse, wq-web, wq-crypto, wq-forensics). Use remaining lanes for mutually distinct concrete INTENTS through wq-worker. Duplicate generic recon lanes are forbidden.
5. Merge evidence. Promote only evidenced claims to FACT and persist compact state to WQ_STATE.md.
6. When a lane has valuable context and remains promising, continue that same peer through hub instead of paying for a cold restart.
7. When progress stagnates or assumptions conflict, call wq-critic in a fresh context and execute a different strategy class, not a spelling variation.
8. Any candidate flag must go through wq-verifier. Locally solved means verifier=accept plus literal provenance; globally solved means the controller/platform confirms it.

ANTI-STALL
- After two materially identical failed commands/payloads with no new fact, pivot.
- Do not spend an entire visit on broad reconnaissance or one expensive brute force.
- Bound long-running local/network commands; background only when their result can be harvested later.
- Do not ask a human to choose the next step and do not stop because a model says the task is hard or complete.
- Organizer submit/reset is controller-owned. Never call those endpoints directly. If reset is necessary, request it in the final result.

HANDOFF
Before any partial/blocked finish, update WQ_STATE.md with these headings:
CONFIRMED FACTS
REJECTED
ARTIFACTS
CURRENT BOTTLENECK
NEXT INTENTS
Keep it dense enough for a fresh context to resume immediately.

FINAL CONTRACT
At the very end of the turn, emit exactly one machine-readable result block:
<WQ_RESULT>
{"status":"solved|partial|blocked","flag":"","evidence":[],"facts":[],"rejected":[],"artifacts":[],"handoff":"","request_reset":false}
</WQ_RESULT>
When status=solved, flag MUST be exact and verifier-approved. At least one evidence entry MUST contain the exact literal flag plus a concise source such as the command/script/artifact that produced it; this is a deterministic submit gate, so paraphrases or "verified above" are insufficient. When not solved, flag MUST be empty. Do not put a second WQ_RESULT block anywhere else.
`;

export interface WqResult {
	status: "solved" | "partial" | "blocked";
	flag: string;
	evidence: string[];
	facts: string[];
	rejected: string[];
	artifacts: string[];
	handoff: string;
	request_reset: boolean;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseWqResult(text: string): WqResult | undefined {
	const start = text.lastIndexOf(WQ_RESULT_OPEN);
	if (start < 0) return undefined;
	const end = text.indexOf(WQ_RESULT_CLOSE, start + WQ_RESULT_OPEN.length);
	if (end < 0) return undefined;
	const raw = text.slice(start + WQ_RESULT_OPEN.length, end).trim();
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		const status = value.status;
		if (status !== "solved" && status !== "partial" && status !== "blocked") return undefined;
		return {
			status,
			flag: typeof value.flag === "string" ? value.flag.trim() : "",
			evidence: stringArray(value.evidence),
			facts: stringArray(value.facts),
			rejected: stringArray(value.rejected),
			artifacts: stringArray(value.artifacts),
			handoff: typeof value.handoff === "string" ? value.handoff : "",
			request_reset: value.request_reset === true,
		};
	} catch {
		return undefined;
	}
}

export function buildWqSolvePrompt(input: {
	challengePath: string;
	objective?: string;
	categoryHint?: string;
	visit?: number;
	innerConcurrency?: number;
	lanePlan?: readonly WqSolverLaneIntent[];
}): string {
	const lines = [
		"Solve this authorized CTF challenge autonomously under the WQ system contract.",
		`Challenge workspace/input: ${input.challengePath}`,
	];
	if (input.categoryHint) lines.push(`Category hint: ${input.categoryHint}`);
	const skills = skillPackForCategory(input.categoryHint);
	if (skills.length) {
		lines.push(
			`Skill pack: ${skills.map(skill => `skill://${skill}`).join(", ")}. Read the primary skill first; use focused micro-skills only when their prerequisites match observed evidence.`,
		);
	}
	if (input.innerConcurrency) {
		lines.push(
			`Solver lane budget: ${input.innerConcurrency}. This is a ceiling, not a quota: keep one authoritative parent and spend extra lanes only on materially distinct hypotheses.`,
		);
	}
	if (input.lanePlan?.length) {
		lines.push("Recommended Task lane plan (ordered; adapt or launch fewer only when evidence justifies it):");
		for (const [index, lane] of input.lanePlan.entries()) {
			lines.push(`- Lane ${index + 1} -> ${lane.agent}: ${lane.intent}`);
		}
	}
	if (input.visit && input.visit > 1) {
		lines.push(
			`This is fresh-context visit ${input.visit}. Read WQ_STATE.md first and resume; do not repeat established reconnaissance.`,
		);
	}
	if (input.objective?.trim()) lines.push(`Objective/context: ${input.objective.trim()}`);
	lines.push(
		"Start with the cheapest decisive action, use specialist + distinct Intent lanes only when they increase search coverage, and close the shortest route to a verifier-approved flag.",
	);
	return lines.join("\n");
}
