/**
 * Pick a bounded task-lane budget for one challenge parent.
 *
 * A challenge gets one authoritative parent session. Concurrency is spent on
 * differentiated specialist/intent lanes inside that parent rather than on a
 * swarm of independent full solvers that rediscover the same facts. Binary
 * challenges benefit from one extra first-pass lane (static/dynamic/exploit),
 * while later fresh-context visits ramp up only after prior evidence exists.
 * The preset remains a hard ceiling and an explicit --inner-concurrency still
 * overrides this policy.
 */
export function recommendedSolverLanes(category: string | undefined, visit: number | undefined, cap: number): number {
	const ceiling = Math.max(1, Math.floor(cap));
	const normalized = category?.trim().toLowerCase() ?? "";
	const binaryHeavy = /\b(pwn|binary exploit|binary exploitation|reverse|re|reversing|reverse engineering)\b/.test(
		normalized,
	);
	const baseline = binaryHeavy ? 3 : 2;
	const visitNumber = Math.max(1, Math.floor(visit ?? 1));
	const revisitBoost = Math.min(3, visitNumber - 1);
	return Math.min(ceiling, baseline + revisitBoost);
}

export type WqSolverAgent = "wq-pwn" | "wq-reverse" | "wq-web" | "wq-crypto" | "wq-forensics" | "wq-worker";

export interface WqSolverLaneIntent {
	agent: WqSolverAgent;
	intent: string;
}

type LaneProfile = {
	specialist?: Exclude<WqSolverAgent, "wq-worker">;
	intents: readonly string[];
};

const PWN_PROFILE: LaneProfile = {
	specialist: "wq-pwn",
	intents: [
		"Map mitigations, I/O surface, memory-corruption primitives, and the shortest plausible exploit chain.",
		"Trace static control/data flow around attacker-controlled input; extract offsets, object layouts, targets, and hard constraints.",
		"Probe runtime behavior and validate the strongest primitive with bounded dynamic experiments; record reproducible crashes, leaks, or writes.",
		"Build the smallest end-to-end exploit/solver artifact from confirmed primitives and test it locally before remote use.",
		"Falsify fragile assumptions in the current exploit chain and search for a different primitive or target class where evidence is weak.",
		"Harden the exploit for protocol, allocator/libc, timing, and local/remote differences so execution is reproducible.",
	],
};

const REVERSE_PROFILE: LaneProfile = {
	specialist: "wq-reverse",
	intents: [
		"Locate the real validation path, core algorithm/state machine, and the shortest route from input to accepted state or flag material.",
		"Trace static xrefs and data flow around comparisons, tables, constants, transforms, and indirect dispatch; name the important state.",
		"Use bounded dynamic tracing or instrumentation to validate control flow, peel obfuscation, and capture decisive intermediate values.",
		"Reimplement only the confirmed validation/decoding core in a compact solver and compare it against the binary on known inputs.",
		"Challenge the current decompilation assumptions and inspect alternate paths, anti-analysis behavior, or hidden state that could invalidate them.",
		"Turn the recovered logic into a deterministic extraction path with provenance for the final candidate.",
	],
};

const WEB_PROFILE: LaneProfile = {
	specialist: "wq-web",
	intents: [
		"Map reachable endpoints, trust boundaries, authentication/state, and the highest-signal attacker-controlled sinks without broad crawling.",
		"Follow the strongest concrete input-to-sink path and test one focused exploit hypothesis with minimal requests.",
		"Probe state, authorization, session, and business-logic transitions for an orthogonal path that does not duplicate the primary sink hypothesis.",
		"Construct the smallest reproducible exploit chain from confirmed behavior and capture exact request/response evidence.",
		"Falsify the current vulnerability class and inspect a different trust boundary or parser only if the leading route stalls.",
		"Harden the exploit against nonce/session/timing differences and make the final extraction deterministic.",
	],
};

const CRYPTO_PROFILE: LaneProfile = {
	specialist: "wq-crypto",
	intents: [
		"Model the primitive, equations, entropy/oracle surface, and violated security assumption before attempting expensive computation.",
		"Derive the cheapest mathematically distinct attack from the observed parameters and state the exact prerequisites that make it valid.",
		"Implement a minimal solver and validate the derivation against local samples, known relations, or round-trip checks.",
		"Falsify the leading algebraic assumptions and try an orthogonal attack class only where the current model leaves unexplained evidence.",
		"Optimize the confirmed attack enough to fit the visit budget while preserving checks that catch false positives.",
		"Produce a deterministic recovery script and provenance for the exact final plaintext/key/flag candidate.",
	],
};

const FORENSICS_PROFILE: LaneProfile = {
	specialist: "wq-forensics",
	intents: [
		"Inventory artifacts with provenance, identify the highest-signal evidence sources, and choose the shortest extraction path.",
		"Build a focused timeline or cross-artifact correlation around the suspicious event instead of exhaustively parsing everything.",
		"Decode, carve, decompress, or reconstruct the most promising embedded content with reproducible commands/scripts.",
		"Validate candidate provenance across independent metadata/content evidence and reject misleading strings or stale artifacts.",
		"Search an orthogonal artifact class only where the current evidence has a concrete gap or contradiction.",
		"Package the final extraction as a deterministic procedure that reproduces the candidate from the original evidence.",
	],
};

const GENERIC_PROFILE: LaneProfile = {
	intents: [
		"Classify the challenge bottleneck with the cheapest decisive inspection and turn observations into concrete facts.",
		"Test an orthogonal hypothesis against the current bottleneck; avoid duplicating reconnaissance already owned by another lane.",
		"Construct the smallest solver/exploit/decoder artifact that can validate the strongest confirmed route end to end.",
		"Falsify the leading assumptions and deliberately switch strategy class where evidence is weak or contradictory.",
		"Close remaining reproducibility gaps and gather literal provenance for any final candidate.",
		"Take a fresh evidence-driven branch against the unresolved bottleneck without repeating rejected actions.",
	],
};

function laneProfileForCategory(category: string | undefined): LaneProfile {
	const normalized = category?.trim().toLowerCase() ?? "";
	if (/\b(pwn|binary exploit|binary exploitation)\b/.test(normalized)) return PWN_PROFILE;
	if (/\b(reverse|re|reversing|reverse engineering)\b/.test(normalized)) return REVERSE_PROFILE;
	if (/\b(web|web security|web exploitation)\b/.test(normalized)) return WEB_PROFILE;
	if (/\b(crypto|cryptography)\b/.test(normalized)) return CRYPTO_PROFILE;
	if (/\b(forensics|forensic|dfir)\b/.test(normalized)) return FORENSICS_PROFILE;
	return GENERIC_PROFILE;
}

/**
 * Build differentiated subagent intents for one authoritative challenge parent.
 *
 * The returned entries describe Task lanes, not additional parent solvers. The
 * caller may launch fewer lanes when a cheap direct solve exists. On revisits,
 * the lane budget grows separately via recommendedSolverLanes; this function
 * makes those extra slots useful by assigning them non-overlapping work.
 */
export function buildSolverLanePlan(
	category: string | undefined,
	visit: number | undefined,
	budget: number,
): WqSolverLaneIntent[] {
	const count = Math.max(1, Math.floor(budget));
	const visitNumber = Math.max(1, Math.floor(visit ?? 1));
	const profile = laneProfileForCategory(category);
	const lanes: WqSolverLaneIntent[] = [];

	for (let index = 0; index < count; index++) {
		const baseIntent =
			profile.intents[index] ??
			`Take a fresh falsification branch against the current bottleneck; do not repeat an existing lane or a REJECTED action (visit ${visitNumber}).`;
		const resumePrefix =
			visitNumber > 1 && index > 0
				? `Resume from WQ_STATE.md on visit ${visitNumber}; preserve confirmed facts. `
				: "";
		lanes.push({
			agent: index === 0 && profile.specialist ? profile.specialist : "wq-worker",
			intent: `${resumePrefix}${baseIntent}`,
		});
	}

	return lanes;
}
