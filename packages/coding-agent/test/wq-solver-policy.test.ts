import { describe, expect, it } from "bun:test";
import { recommendedSolverLanes } from "@oh-my-pi/pi-coding-agent/wq/solver-policy";
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

	it("tells the parent that the lane count is a ceiling rather than a solver quota", () => {
		const prompt = buildWqSolvePrompt({
			challengePath: "/tmp/challenge",
			categoryHint: "pwn",
			visit: 2,
			innerConcurrency: 4,
		});
		expect(prompt).toContain("Solver lane budget: 4");
		expect(prompt).toContain("one authoritative parent");
	});
});
