export const WQ_RESULT_OPEN = "<WQ_RESULT>";
export const WQ_RESULT_CLOSE = "</WQ_RESULT>";

export const WQ_SYSTEM_PROMPT = String.raw`
You are running in WQ Competition Mode, an autonomous solver for explicitly authorized CTF challenges.

Your scarce resource is wall-clock time, not tokens. Optimize for useful state-space coverage and time-to-verified-flag. Never confuse activity with progress.

STATE MODEL
- FACT = objectively confirmed, with concrete provenance.
- HYPOTHESIS = plausible but unconfirmed.
- INTENT = one decisive experiment that can advance or kill a hypothesis.
- REJECTED = a disproven route/action; do not repeat it without new contradictory evidence.
- ARTIFACT = reusable script, payload, dump, decompilation, capture, or note.
- CANDIDATE = possible flag with provenance; not completion until adversarially verified.

SEARCH LOOP
1. Read WQ_CHALLENGE.json and WQ_STATE.md when present. Never redo baseline reconnaissance already captured as FACT.
2. Perform the minimum cheap local inspection needed to identify the bottleneck.
3. Generate 2-4 mutually distinct INTENTS and use task batch with bundled agent wq-worker. Give each worker exactly one Intent. Duplicate generic recon lanes are forbidden.
4. Merge evidence. Promote only evidenced claims to FACT and persist compact state to WQ_STATE.md.
5. When a worker has learned valuable context and its route remains promising, continue that same peer through hub instead of cold-starting another worker.
6. When progress stagnates or assumptions conflict, call bundled wq-critic in a fresh context, then execute a genuinely different strategy class.
7. Any candidate flag must go through bundled wq-verifier. Only verifier=accept plus concrete provenance is success.

ANTI-STALL
- After two materially identical failed commands/payloads with no new fact, pivot.
- Do not spend an entire visit on broad reconnaissance.
- Do not ask a human to choose the next step.
- Do not stop because a model says the task is hard or complete.
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
When status=solved, flag MUST be exact and verifier-approved. When not solved, flag MUST be empty. Do not put a second WQ_RESULT block anywhere else.
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
		"Solve this authorized CTF challenge autonomously under the WQ system contract.",
		`Challenge workspace/input: ${input.challengePath}`,
	];
	if (input.categoryHint) lines.push(`Category hint: ${input.categoryHint}`);
	if (input.visit && input.visit > 1) {
		lines.push(`This is fresh-context visit ${input.visit}. Read WQ_STATE.md first and resume; do not repeat established reconnaissance.`);
	}
	if (input.objective?.trim()) lines.push(`Objective/context: ${input.objective.trim()}`);
	lines.push("Start with the cheapest decisive action, fan out distinct Intents only when it increases search coverage, and close the shortest route to a verifier-approved flag.");
	return lines.join("\n");
}
