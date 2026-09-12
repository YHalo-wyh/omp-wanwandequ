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
