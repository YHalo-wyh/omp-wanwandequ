import * as fs from "node:fs/promises";
import * as path from "node:path";
import { wanwandequModelSelector } from "./model";
import { resolveWqPreset, type WqPresetName } from "./preset";
import { spawnSelfCapture } from "./self";
import { parseWqResult } from "./system";

export interface WqBenchOptions {
	source: string;
	repeat?: number;
	expect?: string;
	objective?: string;
	category?: string;
	preset?: WqPresetName;
	innerConcurrency?: number;
	advisor?: boolean;
	thinking?: string;
	root?: string;
}

function safe(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "challenge";
}

async function copySource(source: string, workspace: string): Promise<string> {
	const stat = await fs.stat(source);
	await fs.mkdir(workspace, { recursive: true });
	const destination = path.join(workspace, safe(path.basename(source)));
	if (stat.isDirectory()) {
		await fs.cp(source, destination, { recursive: true });
	} else {
		await fs.copyFile(source, destination);
	}
	return destination;
}

export async function runWqBench(options: WqBenchOptions): Promise<void> {
	const source = path.resolve(options.source);
	await fs.access(source);
	const repeat = Math.max(1, Math.floor(options.repeat ?? 3));
	const preset = resolveWqPreset(options.preset);
	const root = path.resolve(options.root ?? ".wq-bench");
	const challengeRoot = path.join(root, safe(path.basename(source)));
	await fs.mkdir(challengeRoot, { recursive: true });
	const runs: Array<Record<string, unknown>> = [];

	for (let index = 1; index <= repeat; index++) {
		const workspace = path.join(challengeRoot, `${Date.now()}-r${index}`);
		const copied = await copySource(source, workspace);
		await fs.writeFile(
			path.join(workspace, "WQ_STATE.md"),
			"# WQ State\n\n## CONFIRMED FACTS\n- none yet\n\n## REJECTED\n- none yet\n\n## ARTIFACTS\n- none yet\n\n## CURRENT BOTTLENECK\nfresh independent benchmark attempt\n\n## NEXT INTENTS\n- determine challenge shape with the cheapest decisive test\n",
			"utf8",
		);
		const args = [
			"wq",
			"solve",
			workspace,
			"--preset",
			preset.name,
			"--timeout",
			String(preset.visitSeconds),
			"--objective",
			[options.objective, `Benchmark input copied as ${path.basename(copied)}`].filter(Boolean).join("\n"),
		];
		if (options.category) args.push("--category", options.category);
		if (options.innerConcurrency) args.push("--inner", String(options.innerConcurrency));
		if (options.advisor) args.push("--advisor");
		if (options.thinking) args.push("--thinking", options.thinking);

		const captured = await spawnSelfCapture(args, {
			cwd: workspace,
			timeoutMs: (preset.visitSeconds + 25) * 1000,
			stripEnv: ["WQ_TEAM_TOKEN"],
		});
		const result = parseWqResult(captured.stdout);
		const solved = result?.status === "solved" && !!result.flag;
		const correct = options.expect ? result?.flag === options.expect : solved;
		const record = {
			index,
			workspace,
			elapsed_ms: captured.elapsedMs,
			exit_code: captured.exitCode,
			timed_out: captured.timedOut,
			status: result?.status ?? "missing-result",
			flag: result?.flag ?? "",
			correct,
			facts: result?.facts.length ?? 0,
			artifacts: result?.artifacts.length ?? 0,
		};
		runs.push(record);
		await Promise.all([
			fs.writeFile(path.join(workspace, "stdout.log"), captured.stdout, "utf8"),
			fs.writeFile(path.join(workspace, "stderr.log"), captured.stderr, "utf8"),
			fs.writeFile(path.join(workspace, "result.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8"),
		]);
		process.stdout.write(
			`[WQ-BENCH ${index}/${repeat}] ${correct ? "PASS" : "MISS"} elapsed=${(captured.elapsedMs / 1000).toFixed(1)}s status=${record.status} flag=${record.flag || "-"}\n`,
		);
	}

	const successful = runs.filter(run => run.correct === true).length;
	const elapsed = runs.map(run => Number(run.elapsed_ms)).sort((a, b) => a - b);
	const median =
		elapsed.length % 2
			? elapsed[Math.floor(elapsed.length / 2)]
			: (elapsed[elapsed.length / 2 - 1] + elapsed[elapsed.length / 2]) / 2;
	const summary = {
		source,
		model: wanwandequModelSelector(),
		preset: preset.name,
		inner_concurrency: options.innerConcurrency ?? preset.innerConcurrency,
		advisor: options.advisor === true,
		thinking: options.thinking ?? "inherit",
		repeat,
		expected_flag: options.expect ?? null,
		successful,
		solve_rate: successful / repeat,
		median_elapsed_seconds: Math.round((median / 1000) * 1000) / 1000,
		runs,
	};
	const summaryPath = path.join(challengeRoot, "latest-summary.json");
	await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	process.stdout.write(
		`[WQ-BENCH] solve_rate=${successful}/${repeat} median=${summary.median_elapsed_seconds}s summary=${summaryPath}\n`,
	);
}
