import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WqChallenge } from "./platform";
import type { WqResult } from "./system";

export interface WqChallengeState {
	visits: number;
	solved: boolean;
	lastStatus?: WqResult["status"];
	lastAttemptAt?: number;
	lastElapsedMs?: number;
	facts: string[];
	rejected: string[];
	artifacts: string[];
	rejectedFlags: string[];
	lastHandoff?: string;
}

export interface WqControllerState {
	version: 1;
	startedAt: number;
	challenges: Record<string, WqChallengeState>;
}

function emptyChallenge(): WqChallengeState {
	return {
		visits: 0,
		solved: false,
		facts: [],
		rejected: [],
		artifacts: [],
		rejectedFlags: [],
	};
}

function unique(items: readonly string[], limit = 200): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		const normalized = item.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
		if (out.length >= limit) break;
	}
	return out;
}

export class WqStateStore {
	readonly file: string;
	state: WqControllerState;

	private constructor(file: string, state: WqControllerState) {
		this.file = file;
		this.state = state;
	}

	static async open(root: string): Promise<WqStateStore> {
		await fs.mkdir(root, { recursive: true });
		const file = path.join(root, "state.json");
		try {
			const parsed = JSON.parse(await fs.readFile(file, "utf8")) as WqControllerState;
			if (parsed?.version === 1 && parsed.challenges && typeof parsed.challenges === "object") {
				return new WqStateStore(file, parsed);
			}
		} catch {}
		return new WqStateStore(file, { version: 1, startedAt: Date.now(), challenges: {} });
	}

	challenge(questionId: string): WqChallengeState {
		return (this.state.challenges[questionId] ??= emptyChallenge());
	}

	markVisitStarted(questionId: string): number {
		const entry = this.challenge(questionId);
		entry.visits += 1;
		entry.lastAttemptAt = Date.now();
		return entry.visits;
	}

	mergeResult(questionId: string, result: WqResult, elapsedMs: number): void {
		const entry = this.challenge(questionId);
		entry.lastStatus = result.status;
		entry.lastElapsedMs = elapsedMs;
		entry.facts = unique([...result.facts, ...entry.facts]);
		entry.rejected = unique([...result.rejected, ...entry.rejected]);
		entry.artifacts = unique([...result.artifacts, ...entry.artifacts]);
		entry.lastHandoff = result.handoff.trim() || entry.lastHandoff;
	}

	markSolved(questionId: string): void {
		this.challenge(questionId).solved = true;
	}

	rejectFlag(questionId: string, flag: string): void {
		const entry = this.challenge(questionId);
		entry.rejectedFlags = unique([flag, ...entry.rejectedFlags], 50);
	}

	async save(): Promise<void> {
		const tmp = `${this.file}.${process.pid}.tmp`;
		await fs.writeFile(tmp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
		await fs.rename(tmp, this.file);
	}
}

export function challengePriority(
	challenge: WqChallenge,
	state: WqChallengeState,
	options: { rescue?: boolean } = {},
): number {
	if (challenge.isSolved || state.solved) return -Infinity;
	const score = Math.max(1, challenge.realScore || challenge.score || 1);
	const ease = 1 + Math.log2(2 + Math.max(0, challenge.solvedNumber));
	const progress = 1 + Math.min(1.5, state.facts.length * 0.08 + state.artifacts.length * 0.12);
	const visitPenalty = 1 + state.visits * 0.32;
	const blockedPenalty = state.lastStatus === "blocked" ? 0.72 : 1;
	const rescueBoost = options.rescue
		? 1 + Math.min(2.5, state.facts.length * 0.18 + state.artifacts.length * 0.25)
		: 1;
	return (score * ease * progress * blockedPenalty * rescueBoost) / visitPenalty;
}

export async function writeChallengeContext(
	workspace: string,
	challenge: WqChallenge,
	state: WqChallengeState,
): Promise<void> {
	await fs.mkdir(workspace, { recursive: true });
	const metadata = {
		question_id: challenge.questionId,
		title: challenge.title,
		category: challenge.category,
		description: challenge.description,
		interactive: challenge.interactive,
		target: challenge.target,
		capabilities: challenge.capabilities,
		connection: challenge.connection,
		extensions: challenge.extensions,
		score: challenge.score,
		real_score: challenge.realScore,
		solved_number: challenge.solvedNumber,
	};
	await fs.writeFile(path.join(workspace, "WQ_CHALLENGE.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

	const stateFile = path.join(workspace, "WQ_STATE.md");
	try {
		await fs.access(stateFile);
		return;
	} catch {}
	const initial = [
		"# WQ State",
		"",
		"## CONFIRMED FACTS",
		...(state.facts.length ? state.facts.map(item => `- ${item}`) : ["- none yet"]),
		"",
		"## REJECTED",
		...(state.rejected.length ? state.rejected.map(item => `- ${item}`) : ["- none yet"]),
		"",
		"## ARTIFACTS",
		...(state.artifacts.length ? state.artifacts.map(item => `- ${item}`) : ["- none yet"]),
		"",
		"## CURRENT BOTTLENECK",
		state.lastHandoff || "fresh challenge",
		"",
		"## NEXT INTENTS",
		"- establish the cheapest decisive next experiment",
		"",
	].join("\n");
	await fs.writeFile(stateFile, initial, "utf8");
}

export async function mergeHandoffFile(workspace: string, state: WqChallengeState, result: WqResult): Promise<void> {
	const content = [
		"# WQ State",
		"",
		"## CONFIRMED FACTS",
		...(state.facts.length ? state.facts.map(item => `- ${item}`) : ["- none yet"]),
		"",
		"## REJECTED",
		...(state.rejected.length ? state.rejected.map(item => `- ${item}`) : ["- none yet"]),
		...(state.rejectedFlags.length ? state.rejectedFlags.map(item => `- rejected flag candidate: ${item}`) : []),
		"",
		"## ARTIFACTS",
		...(state.artifacts.length ? state.artifacts.map(item => `- ${item}`) : ["- none yet"]),
		"",
		"## CURRENT BOTTLENECK",
		result.handoff.trim() || state.lastHandoff || "unknown",
		"",
		"## NEXT INTENTS",
		"- fresh context: derive materially distinct next tests from the confirmed facts and rejected routes above",
		"",
	].join("\n");
	await fs.writeFile(path.join(workspace, "WQ_STATE.md"), content, "utf8");
}
