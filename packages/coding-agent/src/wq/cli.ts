import * as fs from "node:fs/promises";
import * as path from "node:path";
import { VERSION } from "@oh-my-pi/pi-utils";
import { Settings } from "../config/settings";
import { loadBundledAgents } from "../task/agents";
import { runWqBench } from "./bench";
import { listWqPresets, resolveWqPreset, wqRuntimeOverrides, type WqPresetName } from "./preset";
import { runWqCompetition } from "./scheduler";
import { runWqSolve } from "./solve";

const DEFAULT_QUERY_URL = "https://apiterminator.ichunqiu.com/04cb510e425bd8f64fa97ba66f3935e1";
const DEFAULT_RESET_URL = "https://apiterminator.ichunqiu.com/deed3dba39e57b7cf95ea63ddd84e0c8";
const DEFAULT_SUBMIT_URL = "https://apiterminator.ichunqiu.com/ff874ef3172cbf4fd6ec2c5653a568e2";

function value(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index >= 0) return argv[index + 1];
	const prefix = `${name}=`;
	return argv.find(item => item.startsWith(prefix))?.slice(prefix.length);
}

function flag(argv: string[], name: string): boolean {
	return argv.includes(name);
}

function numberFlag(argv: string[], name: string): number | undefined {
	const raw = value(argv, name);
	if (raw === undefined) return undefined;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
	return parsed;
}

function listFlag(argv: string[], name: string): string[] | undefined {
	const raw = value(argv, name);
	if (!raw?.trim()) return undefined;
	return raw
		.split(",")
		.map(item => item.trim().toLowerCase())
		.filter(Boolean);
}

function presetName(argv: string[]): WqPresetName {
	return resolveWqPreset(value(argv, "--preset") ?? process.env.WQ_PRESET).name;
}

function printHelp(): void {
	process.stdout.write(`OMP-Wanwandequ competition mode\n\n`);
	process.stdout.write(`Usage:\n`);
	process.stdout.write(`  omp wq doctor [--preset turbo]\n`);
	process.stdout.write(`  omp wq agents\n`);
	process.stdout.write(`  omp wq solve <path> [--objective TEXT] [--category pwn] [--preset turbo] [--inner N] [--advisor] [--model MODEL] [--thinking LEVEL]\n`);
	process.stdout.write(`  omp wq bench <path> [--repeat 3] [--expect flag{...}] [--inner 2|4|6] [--advisor] [--preset turbo]\n`);
	process.stdout.write(`  omp wq run [--duration 1800] [--preset turbo] [--dry-run] [--root DIR] [--categories pwn,reverse] [--questions 1,2]\n\n`);
	process.stdout.write(`Platform run reads WQ_TEAM_TOKEN. Optional endpoint env vars: WQ_QUERY_URL, WQ_RESET_URL, WQ_SUBMIT_URL.\n`);
}

async function doctor(argv: string[]): Promise<void> {
	const preset = resolveWqPreset(presetName(argv));
	const cwd = process.cwd();
	const settings = await Settings.init({ cwd, overrides: wqRuntimeOverrides(preset) });
	const agents = loadBundledAgents().filter(agent => agent.name.startsWith("wq-"));
	process.stdout.write(`[WQ] OMP ${VERSION}\n`);
	process.stdout.write(`[WQ] cwd=${cwd}\n`);
	process.stdout.write(`[WQ] preset=${preset.name} activeChallenges=${preset.activeChallenges} inner=${settings.get("task.maxConcurrency")} recursion=${settings.get("task.maxRecursionDepth")}\n`);
	process.stdout.write(`[WQ] batch=${settings.get("task.batch")} effort=${settings.get("task.enableEffort")} advisor=${settings.get("advisor.enabled")} modelFallback=${settings.get("retry.modelFallback")}\n`);
	process.stdout.write(`[WQ] compaction=${settings.get("compaction.enabled")} asyncCompaction=${settings.get("compaction.asyncEnabled")} loopGuard=${settings.get("model.toolCallLoopGuard.enabled")}\n`);
	process.stdout.write(`[WQ] bundledAgents=${agents.map(agent => agent.name).join(",")}\n`);
	const missing = ["wq-worker", "wq-critic", "wq-verifier", "wq-solver"].filter(name => !agents.some(agent => agent.name === name));
	if (missing.length) throw new Error(`missing bundled WQ agents: ${missing.join(", ")}`);
	process.stdout.write("[WQ] doctor: ok\n");
}

async function solve(argv: string[]): Promise<void> {
	const targetArg = argv[1];
	if (!targetArg || targetArg.startsWith("-")) throw new Error("omp wq solve requires a challenge file/directory path");
	const target = path.resolve(targetArg);
	await fs.access(target);
	await runWqSolve({
		target,
		objective: value(argv, "--objective"),
		category: value(argv, "--category"),
		preset: presetName(argv),
		innerConcurrency: numberFlag(argv, "--inner"),
		advisor: flag(argv, "--advisor"),
		model: value(argv, "--model") ?? process.env.WQ_MODEL,
		provider: value(argv, "--provider") ?? process.env.WQ_PROVIDER,
		thinking: value(argv, "--thinking") ?? process.env.WQ_THINKING,
		visit: numberFlag(argv, "--visit"),
		timeoutSeconds: numberFlag(argv, "--timeout"),
		print: !flag(argv, "--interactive"),
		noSession: !flag(argv, "--keep-session"),
	});
}

async function bench(argv: string[]): Promise<void> {
	const source = argv[1];
	if (!source || source.startsWith("-")) throw new Error("omp wq bench requires a challenge file/directory path");
	await runWqBench({
		source,
		repeat: numberFlag(argv, "--repeat"),
		expect: value(argv, "--expect"),
		objective: value(argv, "--objective"),
		category: value(argv, "--category"),
		preset: presetName(argv),
		innerConcurrency: numberFlag(argv, "--inner"),
		advisor: flag(argv, "--advisor"),
		model: value(argv, "--model") ?? process.env.WQ_MODEL,
		provider: value(argv, "--provider") ?? process.env.WQ_PROVIDER,
		thinking: value(argv, "--thinking") ?? process.env.WQ_THINKING,
		root: value(argv, "--root"),
	});
}

async function run(argv: string[]): Promise<void> {
	const token = value(argv, "--token") ?? process.env.WQ_TEAM_TOKEN ?? "";
	if (!token.trim()) throw new Error("WQ_TEAM_TOKEN is required for `omp wq run`");
	await runWqCompetition({
		token,
		queryUrl: process.env.WQ_QUERY_URL || DEFAULT_QUERY_URL,
		resetUrl: process.env.WQ_RESET_URL || DEFAULT_RESET_URL,
		submitUrl: process.env.WQ_SUBMIT_URL || DEFAULT_SUBMIT_URL,
		root: value(argv, "--root") ?? process.cwd(),
		preset: presetName(argv),
		durationSeconds: numberFlag(argv, "--duration"),
		dryRun: flag(argv, "--dry-run"),
		model: value(argv, "--model") ?? process.env.WQ_MODEL,
		provider: value(argv, "--provider") ?? process.env.WQ_PROVIDER,
		thinking: value(argv, "--thinking") ?? process.env.WQ_THINKING,
		categoryFilter: listFlag(argv, "--categories"),
		questionFilter: value(argv, "--questions")
			?.split(",")
			.map(item => item.trim())
			.filter(Boolean),
		maxVisits: numberFlag(argv, "--max-visits"),
	});
}

export async function runWqCommand(argv: string[]): Promise<void> {
	const action = (argv[0] ?? "help").toLowerCase();
	switch (action) {
		case "help":
		case "--help":
		case "-h":
			printHelp();
			return;
		case "doctor":
			await doctor(argv);
			return;
		case "agents": {
			for (const agent of loadBundledAgents().filter(item => item.name.startsWith("wq-"))) {
				process.stdout.write(`${agent.name}\t${agent.description}\n`);
			}
			return;
		}
		case "presets":
			for (const preset of listWqPresets()) process.stdout.write(`${JSON.stringify(preset)}\n`);
			return;
		case "solve":
			await solve(argv);
			return;
		case "bench":
			await bench(argv);
			return;
		case "run":
			await run(argv);
			return;
		default:
			throw new Error(`unknown WQ action "${action}"; run 'omp wq help'`);
	}
}
