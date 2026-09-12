import * as fs from "node:fs/promises";
import * as path from "node:path";
import coreSkill from "../prompts/skills/wanwandequ-ctf-core/SKILL.md" with { type: "text" };
import pwnSkill from "../prompts/skills/wanwandequ-pwn/SKILL.md" with { type: "text" };
import pwnHeapSkill from "../prompts/skills/wanwandequ-pwn-heap/SKILL.md" with { type: "text" };
import reverseSkill from "../prompts/skills/wanwandequ-reverse/SKILL.md" with { type: "text" };
import reverseSymbolicSkill from "../prompts/skills/wanwandequ-reverse-symbolic/SKILL.md" with { type: "text" };
import webSkill from "../prompts/skills/wanwandequ-web/SKILL.md" with { type: "text" };
import cryptoSkill from "../prompts/skills/wanwandequ-crypto/SKILL.md" with { type: "text" };
import forensicsSkill from "../prompts/skills/wanwandequ-forensics/SKILL.md" with { type: "text" };
import miscTriageSkill from "../prompts/skills/wanwandequ-misc-triage/SKILL.md" with { type: "text" };

export interface WqSkillDefinition {
	name: string;
	content: string;
}

export const WQ_SKILLS: readonly WqSkillDefinition[] = Object.freeze([
	{ name: "wanwandequ-ctf-core", content: coreSkill },
	{ name: "wanwandequ-pwn", content: pwnSkill },
	{ name: "wanwandequ-pwn-heap", content: pwnHeapSkill },
	{ name: "wanwandequ-reverse", content: reverseSkill },
	{ name: "wanwandequ-reverse-symbolic", content: reverseSymbolicSkill },
	{ name: "wanwandequ-web", content: webSkill },
	{ name: "wanwandequ-crypto", content: cryptoSkill },
	{ name: "wanwandequ-forensics", content: forensicsSkill },
	{ name: "wanwandequ-misc-triage", content: miscTriageSkill },
]);

const RETIRED_SKILLS = Object.freeze([
	"wanwandequ-web-matrix",
	"wanwandequ-crypto-matrix",
	"wanwandequ-protocol",
	"wanwandequ-incident",
]);

export function skillForCategory(category: string | undefined): string | undefined {
	return skillPackForCategory(category)[0];
}

export function skillPackForCategory(category: string | undefined): string[] {
	const normalized = category?.trim().toLowerCase() ?? "";
	const pack = ["wanwandequ-ctf-core"];
	if (!normalized) return [...pack, "wanwandequ-misc-triage"];
	if (/\b(pwn|binary exploit|binary exploitation|heap|stack|rop)\b/.test(normalized)) {
		return /heap|glibc|malloc|tcache|fastbin|unsorted|smallbin|largebin/.test(normalized)
			? [...pack, "wanwandequ-pwn", "wanwandequ-pwn-heap"]
			: [...pack, "wanwandequ-pwn"];
	}
	if (/\b(reverse|re|reversing|reverse engineering)\b/.test(normalized)) {
		return /symbolic|angr|z3|constraint|vm|virtual machine/.test(normalized)
			? [...pack, "wanwandequ-reverse", "wanwandequ-reverse-symbolic"]
			: [...pack, "wanwandequ-reverse"];
	}
	if (/\b(web|web security|web pentest|web penetration)\b/.test(normalized)) return [...pack, "wanwandequ-web"];
	if (/\b(crypto|cryptography|cipher)\b/.test(normalized)) return [...pack, "wanwandequ-crypto"];
	if (/\b(forensic|forensics|stego|memory)\b/.test(normalized)) return [...pack, "wanwandequ-forensics"];
	if (/\b(misc|encoding|archive|file format|protocol|network|incident|log)\b/.test(normalized) || /协议|应急|日志/.test(normalized)) {
		return [...pack, "wanwandequ-misc-triage", "wanwandequ-forensics"];
	}
	return [...pack, "wanwandequ-misc-triage"];
}

export async function materializeWqSkills(workspace: string): Promise<string[]> {
	const root = path.join(workspace, ".omp", "skills");
	await fs.mkdir(root, { recursive: true });
	await Promise.all(RETIRED_SKILLS.map(name => fs.rm(path.join(root, name), { recursive: true, force: true })));
	const written: string[] = [];
	for (const skill of WQ_SKILLS) {
		const dir = path.join(root, skill.name);
		const file = path.join(dir, "SKILL.md");
		await fs.mkdir(dir, { recursive: true });
		let current = "";
		try {
			current = await fs.readFile(file, "utf8");
		} catch {}
		if (current !== skill.content) await fs.writeFile(file, skill.content, "utf8");
		written.push(file);
	}
	return written;
}
