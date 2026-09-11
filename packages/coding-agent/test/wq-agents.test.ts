import { describe, expect, it } from "bun:test";
import * as path from "node:path";

const src = path.join(import.meta.dir, "..", "src");

async function text(relative: string): Promise<string> {
	return Bun.file(path.join(src, relative)).text();
}

describe("WQ native integration", () => {
	it("registers wq as a real top-level command", async () => {
		const source = await text("cli-commands.ts");
		expect(source).toContain('name: "wq"');
		expect(source).toContain('import("./commands/wq")');
	});

	it("ships all competition agents inside the binary", async () => {
		const source = await text("task/agents.ts");
		for (const name of [
			"wq-worker",
			"wq-critic",
			"wq-verifier",
			"wq-solver",
			"wq-pwn",
			"wq-reverse",
			"wq-web",
			"wq-crypto",
			"wq-forensics",
		]) {
			expect(source, `${name} missing from bundled agent table`).toContain(`${name}.md`);
			const prompt = await text(`prompts/agents/${name}.md`);
			expect(prompt).toContain(`name: ${name}`);
		}
	});

	it("prevents recursive specialist spawning", async () => {
		const solver = await text("prompts/agents/wq-solver.md");
		const worker = await text("prompts/agents/wq-worker.md");
		expect(solver).toContain("wq-pwn,wq-reverse,wq-web,wq-crypto,wq-forensics");
		expect(worker).toContain('spawns: ""');
	});
});
