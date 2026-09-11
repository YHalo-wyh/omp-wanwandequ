import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WqEventLog } from "./events";
import { WqPlatformClient, type WqChallenge } from "./platform";
import { challengePriority, mergeHandoffFile, WqStateStore, writeChallengeContext } from "./state";
import { resolveWqPreset, type WqPresetName } from "./preset";
import { spawnSelfCapture } from "./self";
import { parseWqResult, type WqResult } from "./system";

export interface WqRunOptions {
	token: string;
	queryUrl: string;
	resetUrl: string;
	submitUrl: string;
	root: string;
	preset?: WqPresetName;
	durationSeconds?: number;
	dryRun?: boolean;
	model?: string;
	provider?: string;
	thinking?: string;
	categoryFilter?: string[];
	questionFilter?: string[];
	maxVisits?: number;
}

interface VisitOutcome {
	challenge: WqChallenge;
	visit: number;
	workspace: string;
	result?: WqResult;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	elapsedMs: number;
}

function safeComponent(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "challenge";
}

function memoryHealthy(minFreeRatio: number): boolean {
	const total = os.totalmem();
	return total <= 0 || os.freemem() / total >= minFreeRatio;
}

function resultGrounded(result: WqResult, rejectedFlags: readonly string[]): boolean {
	if (result.status !== "solved") return false;
	const flag = result.flag.trim();
	if (!flag || flag.includes("\n") || flag.length > 512 || rejectedFlags.includes(flag)) return false;
	const lower = flag.toLowerCase();
	if (/example|fake[_-]?flag|not[_-]?the[_-]?flag|placeholder/.test(lower)) return false;
	return result.evidence.some(item => item.includes(flag));
}

function scoped(challenge: WqChallenge, options: WqRunOptions): boolean {
	if (options.questionFilter?.length && !options.questionFilter.includes(challenge.questionId)) return false;
	if (options.categoryFilter?.length && !options.categoryFilter.includes(challenge.category.toLowerCase())) return false;
	return true;
}

function solveObjective(challenge: WqChallenge): string {
	return [
		challenge.description,
		challenge.target ? `Target: ${challenge.target}` : "",
		challenge.interactive ? "Interactive/container challenge." : "Static challenge.",
	]
		.filter(Boolean)
		.join("\n");
}

async function runVisit(
	challenge: WqChallenge,
	visit: number,
	workspace: string,
	logsDir: string,
	presetName: WqPresetName,
	options: WqRunOptions,
): Promise<VisitOutcome> {
	const preset = resolveWqPreset(presetName);
	const args = [
		"wq",
		"solve",
		workspace,
		"--preset",
		presetName,
		"--category",
		challenge.category,
		"--visit",
		String(visit),
		"--timeout",
		String(preset.visitSeconds),
		"--objective",
		solveObjective(challenge),
	];
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	if (options.thinking) args.push("--thinking", options.thinking);

	const captured = await spawnSelfCapture(args, {
		cwd: workspace,
		timeoutMs: (preset.visitSeconds + 25) * 1000,
		stripEnv: ["WQ_TEAM_TOKEN"],
	});
	await fs.mkdir(logsDir, { recursive: true });
	const stem = `${safeComponent(challenge.questionId)}-visit-${visit}`;
	await Promise.all([
		fs.writeFile(path.join(logsDir, `${stem}.stdout.log`), captured.stdout, "utf8"),
		fs.writeFile(path.join(logsDir, `${stem}.stderr.log`), captured.stderr, "utf8"),
	]);
	return {
		challenge,
		visit,
		workspace,
		result: parseWqResult(captured.stdout),
		stdout: captured.stdout,
		stderr: captured.stderr,
		exitCode: captured.exitCode,
		timedOut: captured.timedOut,
		elapsedMs: captured.elapsedMs,
	};
}

export async function runWqCompetition(options: WqRunOptions): Promise<void> {
	const basePreset = resolveWqPreset(options.preset);
	const root = path.resolve(options.root);
	const runtimeRoot = path.join(root, ".wq");
	const workspaceRoot = path.join(root, "workspaces");
	const logsDir = path.join(runtimeRoot, "logs");
	await Promise.all([fs.mkdir(runtimeRoot, { recursive: true }), fs.mkdir(workspaceRoot, { recursive: true })]);
	const stateStore = await WqStateStore.open(runtimeRoot);
	const events = await WqEventLog.open(runtimeRoot);
	const platform = new WqPlatformClient({
		token: options.token,
		queryUrl: options.queryUrl,
		resetUrl: options.resetUrl,
		submitUrl: options.submitUrl,
	});
	const durationSeconds = Math.max(30, Math.floor(options.durationSeconds ?? 30 * 60));
	const deadline = Date.now() + durationSeconds * 1000;
	const active = new Map<string, Promise<VisitOutcome>>();
	let lastRemote: WqChallenge[] = [];

	await events.emit("run.started", {
		preset: basePreset.name,
		activeChallenges: basePreset.activeChallenges,
		innerConcurrency: basePreset.innerConcurrency,
		durationSeconds,
		dryRun: options.dryRun === true,
	});
	process.stdout.write(
		`[WQ] competition mode preset=${basePreset.name} active=${basePreset.activeChallenges} inner=${basePreset.innerConcurrency} duration=${durationSeconds}s dryRun=${options.dryRun === true}\n`,
	);

	while (Date.now() < deadline) {
		try {
			lastRemote = await platform.listChallenges();
			await events.emit("platform.polled", {
				visible: lastRemote.length,
				solved: lastRemote.filter(item => item.isSolved).length,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`[WQ] platform poll failed: ${message}\n`);
			await events.emit("platform.poll_failed", { message });
		}

		for (const challenge of lastRemote) {
			if (challenge.isSolved) stateStore.markSolved(challenge.questionId);
		}
		await stateStore.save();

		const remainingMs = deadline - Date.now();
		const rescue = remainingMs <= 5 * 60_000;
		const launchPreset: WqPresetName = rescue && basePreset.name !== "safe" ? "max" : basePreset.name;
		const currentPreset = resolveWqPreset(launchPreset);
		const candidates = lastRemote
			.filter(challenge => scoped(challenge, options))
			.filter(challenge => !challenge.isSolved && !stateStore.challenge(challenge.questionId).solved)
			.filter(challenge => !active.has(challenge.questionId))
			.filter(challenge => !options.maxVisits || stateStore.challenge(challenge.questionId).visits < options.maxVisits)
			.sort(
				(a, b) =>
					challengePriority(b, stateStore.challenge(b.questionId), { rescue }) -
					challengePriority(a, stateStore.challenge(a.questionId), { rescue }),
			);

		while (
			active.size < currentPreset.activeChallenges &&
			candidates.length > 0 &&
			memoryHealthy(currentPreset.minFreeMemoryRatio)
		) {
			const challenge = candidates.shift();
			if (!challenge) break;
			const workspace = path.join(workspaceRoot, safeComponent(challenge.questionId));
			const localState = stateStore.challenge(challenge.questionId);
			await writeChallengeContext(workspace, challenge, localState);
			try {
				const attachment = await platform.downloadAttachment(challenge, workspace);
				if (attachment) process.stdout.write(`[WQ] ${challenge.questionId} attachment=${path.basename(attachment)}\n`);
			} catch (error) {
				process.stderr.write(`[WQ] ${challenge.questionId} attachment failed: ${error instanceof Error ? error.message : String(error)}\n`);
			}
			const visit = stateStore.markVisitStarted(challenge.questionId);
			await stateStore.save();
			await events.emit("challenge.started", {
				questionId: challenge.questionId,
				title: challenge.title,
				category: challenge.category,
				visit,
				preset: launchPreset,
				solvedNumber: challenge.solvedNumber,
			});
			process.stdout.write(
				`[WQ] launch q=${challenge.questionId} cat=${challenge.category} visit=${visit} preset=${launchPreset} solvedBy=${challenge.solvedNumber}\n`,
			);
			active.set(challenge.questionId, runVisit(challenge, visit, workspace, logsDir, launchPreset, options));
		}

		if (active.size === 0) {
			const visibleScope = lastRemote.filter(challenge => scoped(challenge, options));
			if (
				visibleScope.length > 0 &&
				visibleScope.every(challenge => challenge.isSolved || stateStore.challenge(challenge.questionId).solved)
			) {
				process.stdout.write("[WQ] all visible in-scope challenges solved\n");
				await events.emit("run.scope_solved", { visible: visibleScope.length });
				break;
			}
			await Bun.sleep(memoryHealthy(currentPreset.minFreeMemoryRatio) ? 1800 : 3500);
			continue;
		}

		const completions = Array.from(active.entries(), async ([questionId, promise]) => ({
			questionId,
			outcome: await promise,
		}));
		const completion = await Promise.race([...completions, Bun.sleep(1800).then(() => undefined)]);
		if (!completion) continue;
		active.delete(completion.questionId);
		const { outcome } = completion;
		const localState = stateStore.challenge(outcome.challenge.questionId);
		const result = outcome.result;
		if (!result) {
			process.stderr.write(
				`[WQ] q=${outcome.challenge.questionId} visit=${outcome.visit} no structured result exit=${outcome.exitCode} timeout=${outcome.timedOut}\n`,
			);
			await events.emit("visit.unstructured", {
				questionId: outcome.challenge.questionId,
				visit: outcome.visit,
				exitCode: outcome.exitCode,
				timedOut: outcome.timedOut,
				elapsedMs: outcome.elapsedMs,
			});
			continue;
		}
		stateStore.mergeResult(outcome.challenge.questionId, result, outcome.elapsedMs);
		await mergeHandoffFile(outcome.workspace, localState, result);
		await events.emit("visit.completed", {
			questionId: outcome.challenge.questionId,
			visit: outcome.visit,
			status: result.status,
			elapsedMs: outcome.elapsedMs,
			facts: result.facts.length,
			artifacts: result.artifacts.length,
			requestReset: result.request_reset,
		});

		if (result.request_reset && outcome.challenge.interactive && !resultGrounded(result, localState.rejectedFlags)) {
			try {
				const reset = await platform.reset(outcome.challenge.questionId);
				process.stdout.write(`[WQ] q=${outcome.challenge.questionId} controller reset=${reset}\n`);
				await events.emit("challenge.reset", { questionId: outcome.challenge.questionId, reset });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(`[WQ] q=${outcome.challenge.questionId} reset failed: ${message}\n`);
				await events.emit("challenge.reset_failed", { questionId: outcome.challenge.questionId, message });
			}
		}

		if (result.status === "solved") {
			if (!resultGrounded(result, localState.rejectedFlags)) {
				process.stderr.write(`[WQ] q=${outcome.challenge.questionId} candidate rejected by deterministic grounding gate\n`);
				if (result.flag) stateStore.rejectFlag(outcome.challenge.questionId, result.flag);
				await events.emit("candidate.rejected", { questionId: outcome.challenge.questionId, reason: "grounding" });
			} else if (options.dryRun) {
				process.stdout.write(`[WQ] DRY-RUN q=${outcome.challenge.questionId} verified-candidate=${result.flag}\n`);
				await events.emit("candidate.verified", { questionId: outcome.challenge.questionId, dryRun: true });
			} else {
				try {
					await events.emit("submit.started", { questionId: outcome.challenge.questionId });
					const submitted = await platform.submit(outcome.challenge.questionId, result.flag);
					if (submitted.correct) {
						stateStore.markSolved(outcome.challenge.questionId);
						process.stdout.write(`[WQ] SOLVED q=${outcome.challenge.questionId} flag=${result.flag}\n`);
						await events.emit("submit.accepted", { questionId: outcome.challenge.questionId });
					} else {
						stateStore.rejectFlag(outcome.challenge.questionId, result.flag);
						const message = submitted.message || `status=${submitted.status}`;
						process.stderr.write(`[WQ] q=${outcome.challenge.questionId} submit rejected: ${message}\n`);
						await events.emit("submit.rejected", { questionId: outcome.challenge.questionId, message });
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					process.stderr.write(`[WQ] q=${outcome.challenge.questionId} submit error: ${message}\n`);
					await events.emit("submit.error", { questionId: outcome.challenge.questionId, message });
				}
			}
		}
		await stateStore.save();
	}

	if (active.size > 0) {
		process.stdout.write(`[WQ] deadline reached; waiting briefly for ${active.size} active visit(s) to terminate by their own budgets\n`);
		await Promise.allSettled(active.values());
	}
	await stateStore.save();
	const solvedCount = Object.values(stateStore.state.challenges).filter(item => item.solved).length;
	await events.emit("run.finished", { solved: solvedCount, challenges: Object.keys(stateStore.state.challenges).length });
	await events.flush();
	process.stdout.write(`[WQ] finished solved=${solvedCount} state=${stateStore.file}\n`);
}
