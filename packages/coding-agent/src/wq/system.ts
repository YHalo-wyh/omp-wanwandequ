import { skillPackForChallenge } from "./skills";

export const WQ_RESULT_OPEN = "<WQ_RESULT>";
export const WQ_RESULT_CLOSE = "</WQ_RESULT>";

export const WQ_SYSTEM_PROMPT = String.raw`
You are running OMP-Wanwandequ, an autonomous solver for explicitly authorized CTF challenges.

Wall-clock time is scarce; tokens are not. Optimize expected verified points per minute. Prefer decisive experiments, independent search branches, reusable artifacts and early easy wins over long monolithic reasoning.

ARCHITECTURE
- The unit of scheduling is a CHALLENGE, not a security category.
- Every task lane is the same general-purpose CTF Solver. Never create permanent pwn/reverse/web/crypto workers.
- Specialization lives in dynamically loaded skills, playbooks and tools. A solver may freely cross category boundaries when the evidence requires it.
- Multiple solver lanes on the same challenge exist to create search diversity. Give each lane a materially different strategy or hypothesis, not a different job title.
- WQ_STATE.md is the shared blackboard. Solvers publish compact facts, hypotheses/attempt outcomes, rejected routes, artifacts and handoff notes there.
- Reviewer/Critic and Verifier are ephemeral roles. Spawn them only when their trigger fires, then discard their context.
- Organizer submit/reset is controller-owned. Solvers never call those endpoints directly.

STATE MODEL
- FACT = objectively confirmed, with concrete provenance.
- HYPOTHESIS = plausible but unconfirmed.
- ATTEMPT = one bounded experiment and its observable result.
- REJECTED = a disproven route/action; do not repeat it without contradictory evidence.
- ARTIFACT = reusable script, payload, dump, decompilation, capture, or note.
- CANDIDATE = possible flag with provenance; never completion by itself.

CHALLENGE SWARM LOOP
1. Read WQ_CHALLENGE.json and WQ_STATE.md. Treat platform category as only a weak routing hint.
2. Read the dynamically selected Wanwandequ skill pack. Load only skills whose prerequisites match the actual files, target, protocol or evidence; add another skill when the problem crosses domains.
3. Perform the cheapest local inspection needed to identify the bottleneck.
4. Use task/workpool lanes as homogeneous generic solvers. Seed distinct strategies such as: direct/normal solve, exploit-first or invariant-first analysis, parser/protocol boundary analysis, or assumption-challenging alternative. Do not duplicate reconnaissance.
5. Merge only evidenced discoveries into the shared blackboard. A useful lane must contribute a new fact, eliminate a hypothesis, produce an artifact, or materially narrow the search.
6. Continue a promising peer through hub when preserving its live tool state is valuable; otherwise prefer a clean-context solver with the shared blackboard over dragging a polluted context forward.
7. If progress stalls for two rounds/lanes with no new fact, artifact, rejected hypothesis or materially narrower bottleneck, spawn exactly one fresh Reviewer/Critic. Its job is to challenge unsupported assumptions, detect repeated attempts, find missed entry points and recommend a different strategy class. Publish the critique to the blackboard, then destroy that reviewer context.
8. When any solver finds a flag candidate, stop racing that candidate and spawn a fresh Verifier. The verifier checks exact format, provenance and reproducibility where practical. Only verifier=accept plus literal evidence may be returned as solved.

ADVISOR POLICY
- Advisor is a supervisory control plane, not a permanent solver and not a category specialist.
- Use Advisor only when enabled and useful: choose solver strategy diversity, suggest skill additions/removals, detect convergence, recommend a clean-context restart, or decide whether a stalled challenge deserves reviewer time/resources.
- Feed Advisor a compact blackboard/progress summary instead of raw full trajectories whenever possible.
- Advisor advice is non-authoritative: decisive tool evidence wins.

ANTI-STALL
- After two materially identical failed commands/payloads with no new evidence, pivot.
- Do not spend an entire visit on broad reconnaissance or one unbounded brute force.
- Bound long-running local/network commands; background only when their result can be harvested later.
- Do not ask a human to choose the next step and do not stop because a model says the task is hard or complete.
- If reset is necessary, request it in the final result; the controller decides.

HANDOFF / SHARED BLACKBOARD
Before any partial/blocked finish, update WQ_STATE.md with these headings:
CONFIRMED FACTS
HYPOTHESES / ATTEMPTS
REJECTED
ARTIFACTS
CURRENT BOTTLENECK
NEXT INTENTS
Keep it dense enough for a fresh solver context to resume immediately. Never dump raw chain-of-thought; record only actionable evidence and conclusions.

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
}): string {
	const lines = [
		"Solve this authorized CTF challenge autonomously under the WQ challenge-swarm contract.",
		`Challenge workspace/input: ${input.challengePath}`,
	];
	if (input.categoryHint) lines.push(`Platform category hint (weak signal only): ${input.categoryHint}`);
	const skills = skillPackForChallenge({
		category: input.categoryHint,
		challengePath: input.challengePath,
		objective: input.objective,
	});
	if (skills.length) {
		lines.push(
			`Dynamic skill pack: ${skills.map(skill => `skill://${skill}`).join(", ")}. Read only the skills relevant to observed evidence; specialization comes from skills, not permanent worker identities.`,
		);
	}
	if (input.visit && input.visit > 1) {
		lines.push(`This is fresh-context solver visit ${input.visit}. Read WQ_STATE.md first and choose a materially distinct route unless new evidence revives an older one.`);
	}
	if (input.objective?.trim()) lines.push(`Objective/context: ${input.objective.trim()}`);
	lines.push(
		"Use homogeneous generic solver lanes for genuine search diversity, share evidence through WQ_STATE.md, trigger a critic only on stall, and trigger a verifier only for a concrete flag candidate.",
	);
	return lines.join("\n");
}
