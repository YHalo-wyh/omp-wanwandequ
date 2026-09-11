import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { materializeWqSkills, skillForCategory, WQ_SKILLS } from "@oh-my-pi/pi-coding-agent/wq/skills";

const cleanup: string[] = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("WQ authored skills", () => {
	it("routes core competition categories to stable skill names", () => {
		expect(skillForCategory("pwn")).toBe("wanwandequ-pwn");
		expect(skillForCategory("reverse engineering")).toBe("wanwandequ-reverse");
		expect(skillForCategory("web")).toBe("wanwandequ-web");
		expect(skillForCategory("crypto")).toBe("wanwandequ-crypto");
		expect(skillForCategory("forensics")).toBe("wanwandequ-forensics");
		expect(skillForCategory("protocol analysis")).toBe("wanwandequ-protocol");
		expect(skillForCategory("日志应急")).toBe("wanwandequ-incident");
	});

	it("materializes every bundled skill into the workspace OMP skill tree", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "wq-skills-"));
		cleanup.push(root);
		const files = await materializeWqSkills(root);
		expect(files).toHaveLength(WQ_SKILLS.length);
		const pwn = await fs.readFile(path.join(root, ".omp", "skills", "wanwandequ-pwn", "SKILL.md"), "utf8");
		expect(pwn).toContain("name: wanwandequ-pwn");
		expect(pwn).toContain("PWN Fast Path");
	});
});
