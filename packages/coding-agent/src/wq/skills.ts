import * as fs from "node:fs/promises";
import * as path from "node:path";
import pwnSkill from "../prompts/skills/wanwandequ-pwn/SKILL.md" with { type: "text" };
import reverseSkill from "../prompts/skills/wanwandequ-reverse/SKILL.md" with { type: "text" };
import webSkill from "../prompts/skills/wanwandequ-web/SKILL.md" with { type: "text" };
import cryptoSkill from "../prompts/skills/wanwandequ-crypto/SKILL.md" with { type: "text" };
import forensicsSkill from "../prompts/skills/wanwandequ-forensics/SKILL.md" with { type: "text" };
import protocolSkill from "../prompts/skills/wanwandequ-protocol/SKILL.md" with { type: "text" };
import incidentSkill from "../prompts/skills/wanwandequ-incident/SKILL.md" with { type: "text" };

export interface WqSkillDefinition {
	name: string;
	content: string;
}

export const WQ_SKILLS: readonly WqSkillDefinition[] = Object.freeze([
	{ name: "wanwandequ-pwn", content: pwnSkill },
	{ name: "wanwandequ-reverse", content: reverseSkill },
	{ name: "wanwandequ-web", content: webSkill },
	{ name: "wanwandequ-crypto", content: cryptoSkill },
	{ name: "wanwandequ-forensics", content: forensicsSkill },
	{ name: "wanwandequ-protocol", content: protocolSkill },
	{ name: "wanwandequ-incident", content: incidentSkill },
]);

export function skillForCategory(category: string | undefined): string | undefined {
	const normalized = category?.trim().toLowerCase() ?? "";
	if (!normalized) return undefined;
	if (/\b(pwn|binary exploit|binary exploitation|heap|stack|rop)\b/.test(normalized)) return "wanwandequ-pwn";
	if (/\b(reverse|re|reversing|reverse engineering)\b/.test(normalized)) return "wanwandequ-reverse";
	if (/\b(web|web security|web pentest|web penetration)\b/.test(normalized)) return "wanwandequ-web";
	if (/\b(crypto|cryptography|cipher)\b/.test(normalized)) return "wanwandequ-crypto";
	if (/\b(forensic|forensics|misc|stego|memory)\b/.test(normalized)) return "wanwandequ-forensics";
	if (/\b(protocol|network protocol)\b/.test(normalized) || /协议/.test(normalized)) return "wanwandequ-protocol";
	if (/\b(incident|response|log)\b/.test(normalized) || /应急|日志/.test(normalized)) return "wanwandequ-incident";
	return undefined;
}

export async function materializeWqSkills(workspace: string): Promise<string[]> {
	const root = path.join(workspace, ".omp", "skills");
	await fs.mkdir(root, { recursive: true });
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
