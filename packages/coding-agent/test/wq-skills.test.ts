import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	materializeWqSkills,
	skillForCategory,
	skillPackForCategory,
	WQ_SKILLS,
} from "@oh-my-pi/pi-coding-agent/wq/skills";

const cleanup: string[] = [];

async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("WQ authored skills", () => {
	it("routes competition categories to focused primary skills", () => {
		expect(skillForCategory("pwn")).toBe("wanwandequ-pwn");
		expect(skillForCategory("reverse engineering")).toBe("wanwandequ-reverse");
		expect(skillForCategory("web")).toBe("wanwandequ-web");
		expect(skillForCategory("crypto")).toBe("wanwandequ-crypto");
		expect(skillForCategory("forensics")).toBe("wanwandequ-forensics");
		expect(skillForCategory("protocol analysis")).toBe("wanwandequ-misc-triage");
		expect(skillForCategory("日志应急")).toBe("wanwandequ-misc-triage");
	});

	it("combines the evidence loop with only relevant CTF micro-skills", () => {
		expect(skillPackForCategory("heap pwn glibc")).toEqual([
			"wanwandequ-ctf-core",
			"wanwandequ-pwn",
			"wanwandequ-pwn-heap",
		]);
		expect(skillPackForCategory("reverse symbolic angr")).toEqual([
			"wanwandequ-ctf-core",
			"wanwandequ-reverse",
			"wanwandequ-reverse-symbolic",
		]);
		expect(skillPackForCategory("web")).toEqual(["wanwandequ-ctf-core", "wanwandequ-web"]);
		expect(skillPackForCategory("crypto")).toEqual(["wanwandequ-ctf-core", "wanwandequ-crypto"]);
		expect(skillPackForCategory(undefined)).toEqual(["wanwandequ-ctf-core", "wanwandequ-misc-triage"]);
	});

	it("materializes every bundled skill and omits retired generic packs", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "wq-skills-"));
		cleanup.push(root);
		const retired = ["wanwandequ-web-matrix", "wanwandequ-crypto-matrix", "wanwandequ-protocol", "wanwandequ-incident"];
		for (const name of retired) {
			const dir = path.join(root, ".omp", "skills", name);
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(path.join(dir, "SKILL.md"), "legacy", "utf8");
		}
		const files = await materializeWqSkills(root);
		expect(files).toHaveLength(WQ_SKILLS.length);
		const core = await fs.readFile(path.join(root, ".omp", "skills", "wanwandequ-ctf-core", "SKILL.md"), "utf8");
		const pwn = await fs.readFile(path.join(root, ".omp", "skills", "wanwandequ-pwn", "SKILL.md"), "utf8");
		const heap = await fs.readFile(path.join(root, ".omp", "skills", "wanwandequ-pwn-heap", "SKILL.md"), "utf8");
		expect(core).toContain("Evidence-driven autonomous CTF solving loop");
		expect(pwn).toContain("name: wanwandequ-pwn");
		expect(pwn).toContain("PWN Fast Path");
		expect(heap).toContain("Modern Heap Fast Path");
		for (const name of retired) {
			expect(await exists(path.join(root, ".omp", "skills", name))).toBe(false);
		}
	});
});
