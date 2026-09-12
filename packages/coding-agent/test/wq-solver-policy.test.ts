import { describe, expect, it } from "bun:test";
import { buildSolverLanePlan, recommendedSolverLanes } from "@oh-my-pi/pi-coding-agent/wq/solver-policy";
import { buildWqSolvePrompt } from "@oh-my-pi/pi-coding-agent/wq/system";

describe("WQ solver lane policy", () => {
	it("starts binary-heavy challenges wider without consuming the full preset", () => {
		expect(recommendedSolverLanes("pwn", 1, 6)).toBe(3);
		expect(recommendedSolverLanes("reverse engineering", 1, 6)).toBe(3);
		expect(recommendedSolverLanes("web", 1, 6)).toBe(2);
		expect(recommendedSolverLanes("crypto", 1, 6)).toBe(2);
	});

	it("ramps diversity on fresh-context revisits and never exceeds the preset ceiling", () => {
		expect(recommendedSolverLanes("pwn", 2, 6)).toBe(4);
		expect(recommendedSolverLanes("pwn", 4, 6)).toBe(6);
		expect(recommendedSolverLanes("web", 3, 4)).toBe(4);
		expect(recommendedSolverLanes("pwn", 4, 2)).toBe(2);
		expect(recommendedSolverLanes(undefined, 1, 1)).toBe(1);
	});

	it("assigns complementary task intents instead of duplicate full solvers", () => {
		const pwn = buildSolverLanePlan("pwn", 1, 3);
		expect(pwn).toHaveLength(3);
		expect(pwn.map(lane => lane.agent)).toEqual(["wq-pwn", "wq-worker", "wq-worker"]);
		expect(new Set(pwn.map(lane => lane.intent)).size).toBe(3);
		expect(pwn[1]?.intent).toContain("static control/data flow");
		expect(pwn[2]?.intent).toContain("runtime behavior");

		const web = buildSolverLanePlan("web", 1, 2);
		expect(web.map(lane => lane.agent)).toEqual(["wq-web", "wq-worker"]);
	});

	it("uses additional revisit lanes for construction and falsification work", () => {
		const revisit = buildSolverLanePlan("pwn", 2, 5);
		expect(revisit).toHaveLength(5);
		expect(revisit[1]?.intent).toContain("WQ_STATE.md");
		expect(revisit[3]?.intent).toContain("end-to-end exploit/solver");
		expect(revisit[4]?.intent).toContain("Falsify");
	});

	it("tells the parent that the lane count is a ceiling and includes explicit lane intents", () => {
		const lanePlan = buildSolverLanePlan("pwn", 2, 4);
		const prompt = buildWqSolvePrompt({
			challengePath: "/tmp/challenge",
			categoryHint: "pwn",
			visit: 2,
			innerConcurrency: 4,
			lanePlan,
		});
		expect(prompt).toContain("Solver lane budget: 4");
		expect(prompt).toContain("one authoritative parent");
		expect(prompt).toContain("Lane 1 -> wq-pwn");
		expect(prompt).toContain("Lane 4 -> wq-worker");
	});
});
