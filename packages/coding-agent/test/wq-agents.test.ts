import { describe, expect, it } from "bun:test";
import { commands } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { loadBundledAgents } from "@oh-my-pi/pi-coding-agent/task/agents";

describe("WQ native integration", () => {
	it("registers wq as a real top-level command", () => {
		expect(commands.some(command => command.name === "wq")).toBe(true);
	});

	it("ships competition agents inside the binary", () => {
		const agents = loadBundledAgents();
		for (const name of ["wq-worker", "wq-critic", "wq-verifier", "wq-solver"]) {
			const agent = agents.find(item => item.name === name);
			expect(agent, `${name} missing`).toBeDefined();
			expect(agent?.source).toBe("bundled");
		}
	});

	it("prevents unlimited recursive WQ spawning", () => {
		const solver = loadBundledAgents().find(item => item.name === "wq-solver");
		const worker = loadBundledAgents().find(item => item.name === "wq-worker");
		expect(solver?.spawns).toContain("wq-worker");
		expect(worker?.spawns ?? "").toBe("");
	});
});
