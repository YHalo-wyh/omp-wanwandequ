import * as fs from "node:fs/promises";
import * as path from "node:path";
import { VERSION } from "@oh-my-pi/pi-utils";
import { Settings } from "../config/settings";
import { loadBundledAgents } from "../task/agents";
import { runWqBench } from "./bench";
import { wanwandequModelSelector, wanwandequProvider, WANWANDEQU_MODEL_ID } from "./model";
import { listWqPresets, resolveWqPreset, wqRuntimeOverrides, type WqPresetName } from "./preset";
import { runWqCompetition } from "./scheduler";
import { runWqChat, runWqRuntime, runWqSolve } from "./solve";

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
	return resolveWqPreset(value(argv, "--preset") ?? process.env.WANWANDEQU_PRESET ?? process.env.WQ_PRESET).name;
}

function thinkingLevel(argv: string[]): string | undefined {
	return value(argv, "--thinking") ?? process.env.WANWANDEQU_THINKING ?? process.env.WQ_THINKING;
}

function rejectModelOverride(argv: string[]): void {
	for (const forbidden of ["--model", "--provider"]) {
		if (argv.includes(forbidden) || argv.some(item => item.startsWith(`${forbidden}=`))) {
			throw new Error(`${forbidden} is disabled: omp-wanwandequ is locked to ${wanwandequModelSelector()}`);
		}
	}
}

function printHelp(): void {
	process.stdout.write(`OMP-Wanwandequ ${VERSION}\n`);
	process.stdout.write(`Autonomous Bay Area Cup CTF agent; model locked to ${WANWANDEQU_MODEL_ID}.\n\n`);
	process.stdout.write(`Usage:\n`);
	process.stdout.write(`  omp-wanwandequ                         # chat if no team token; otherwise start unattended competition\n`);
	process.stdout.write(`  omp-wanwandequ chat [--preset turbo]  # native interactive OMP TUI\n`);
	process.stdout.write(`  omp-wanwandequ runtime [--preset turbo] # headless JSONL RPC runtime for Studio/embedders\n`);
	process.stdout.write(`  omp-wanwandequ doctor [--preset turbo]\n`);
	process.stdout.write(`  omp-wanwandequ agents\n`);
	process.stdout.write(`  omp-wanwandequ presets\n`);
	process.stdout.write(`  omp-wanwandequ solve <path> [--objective TEXT] [--category pwn] [--preset turbo] [--inner N] [--advisor] [--thinking LEVEL]\n`);
	process.stdout.write(`  omp-wanwandequ bench <path> [--repeat 3] [--expect flag{...}] [--inner 2|4|6] [--advisor] [--preset turbo]\n`);
	process.stdout.write(`  omp-wanwandequ run [--duration 1800] [--preset turbo] [--dry-run] [--root DIR] [--categories pwn,reverse] [--questions 1,2]\n\n`);
	process.stdout.write(`runtime uses OMP's native RPC protocol on stdin/stdout; it does not emulate or scrape the TUI.\n`);
	process.stdout.write(`All console output is mirrored to ./logs in the launch working directory.\n`);
	process.stdout.write(`Setting WQ_TEAM_TOKEN arms no-argument unattended competition mode. Organizer gateway provider may be selected only with WANWANDEQU_PROVIDER; the model id remains ${WANWANDEQU_MODEL_ID}.\n`);
}

async function doctor(argv: string[]): Promise<void> {
	const preset = resolveWqPreset(presetName(argv));
	const cwd = process.cwd();
	const settings = await Settings.init({ cwd, overrides: wqRuntimeOverrides(preset) });
	const agents = loadBundledAgents().filter(agent => agent.name.startsWith("wq-"));
	process.stdout.write(`[WQ] omp-wanwandequ ${VERSION}\n`);
	process.stdout.write(`[WQ] cwd=${cwd}\n`);
	process.stdout.write(`[WQ] model=${wanwandequModelSelector()} provider=${wanwandequProvider()} modelFallback=${settings.get("retry.modelFallback")}\n`);
	process.stdout.write(`[WQ] preset=${preset.name} activeChallenges=${preset.activeChallenges} inner=${settings.get("task.maxConcurrency")} recursion=${settings.get("task.maxRecursionDepth")}\n`);
	process.stdout.write(`[WQ] batch=${settings.get("task.batch")} effort=${settings.get("task.enableEffort")} advisor=${settings.get("advisor.enabled")}\n`);
	process.stdout.write(`[WQ] compaction=${settings.get("compaction.enabled")} asyncCompaction=${settings.get("compaction.asyncEnabled")} loopGuard=${settings.get("model.toolCallLoopGuard.enabled")}\n`);
	process.stdout.write(`[WQ] teamToken=${process.env.WQ_TEAM_TOKEN?.trim() ? "configured/ARMED" : "not-configured/test-mode"}\n`);
	process.stdout.write(`[WQ] bundledAgents=${agents.map(agent => agent.name).join(",")}\n`);
	const required = [
		"wq-worker",
		"wq-critic",
		"wq-verifier",
		"wq-solver",
		"wq-pwn",
		"wq-reverse",
		"wq-web",
		"wq-crypto",
		"wq-forensics",
	];
	const missing = required.filter(name => !agents.some(agent => agent.name === name));
	if (missing.length) throw new Error(`missing bundled WQ agents: ${missing.join(", ")}`);
	process.stdout.write("[WQ] doctor: ok\n");
}

async function chat(argv: string[]): Promise<void> {
	rejectModelOverride(argv);
	await runWqChat({
		cwd: value(argv, "--cwd") ?? process.cwd(),
		preset: presetName(argv),
		innerConcurrency: numberFlag(argv, "--inner"),
		advisor: flag(argv, "--advisor"),
		thinking: thinkingLevel(argv),
	});
}

async function runtime(argv: string[]): Promise<void> {
	rejectModelOverride(argv);
	await runWqRuntime({
		cwd: value(argv, "--cwd") ?? process.cwd(),
		preset: presetName(argv),
		innerConcurrency: numberFlag(argv, "--inner"),
		advisor: flag(argv, "--advisor"),
		thinking: thinkingLevel(argv),
	});
}

async function solve(argv: string[]): Promise<void> {
	rejectModelOverride(argv);
	const targetArg = argv[1];
	if (!targetArg || targetArg.startsWith("-")) throw new Error("omp-wanwandequ solve requires a challenge file/directory path");
	const target = path.resolve(targetArg);
	await fs.access(target);
	await runWqSolve({
		target,
		objective: value(argv, "--objective"),
		category: value(argv, "--category"),
		preset: presetName(argv),
		innerConcurrency: numberFlag(argv, "--inner"),
		advisor: flag(argv, "--advisor"),
		thinking: thinkingLevel(argv),
		visit: numberFlag(argv, "--visit"),
		timeoutSeconds: numberFlag(argv, "--timeout"),
		print: !flag(argv, "--interactive"),
		noSession: !flag(argv, "--keep-session"),
	});
}

async function bench(argv: string[]): Promise<void> {
	rejectModelOverride(argv);
	const source = argv[1];
	if (!source || source.startsWith("-")) throw new Error("omp-wanwandequ bench requires a challenge file/directory path");
	await runWqBench({
		source,
		repeat: numberFlag(argv, "--repeat"),
		expect: value(argv, "--expect"),
		objective: value(argv, "--objective"),
		category: value(argv, "--category"),
		preset: presetName(argv),
		innerConcurrency: numberFlag(argv, "--inner"),
		advisor: flag(argv, "--advisor"),
		thinking: thinkingLevel(argv),
		root: value(argv, "--root"),
	});
}

async function run(argv: string[]): Promise<void> {
	rejectModelOverride(argv);
	const token = value(argv, "--token") ?? process.env.WQ_TEAM_TOKEN ?? "";
	if (!token.trim()) throw new Error("WQ_TEAM_TOKEN is required for autonomous competition mode");
	await runWqCompetition({
		token,
		queryUrl: process.env.WQ_QUERY_URL || DEFAULT_QUERY_URL,
		resetUrl: process.env.WQ_RESET_URL || DEFAULT_RESET_URL,
		submitUrl: process.env.WQ_SUBMIT_URL || DEFAULT_SUBMIT_URL,
		root: value(argv, "--root") ?? process.cwd(),
		preset: presetName(argv),
		durationSeconds: numberFlag(argv, "--duration"),
		dryRun: flag(argv, "--dry-run"),
		thinking: thinkingLevel(argv),
		categoryFilter: listFlag(argv, "--categories"),
		questionFilter: value(argv, "--questions")
			?.split(",")
			.map(item => item.trim())
			.filter(Boolean),
		maxVisits: numberFlag(argv, "--max-visits"),
	});
}

async function auto(argv: string[]): Promise<void> {
	if (process.env.WQ_TEAM_TOKEN?.trim()) {
		process.stdout.write("[WQ] team token configured -> ARMED unattended competition mode\n");
		await run(["run", ...argv.slice(1)]);
		return;
	}
	process.stdout.write("[WQ] no team token -> interactive test mode (run installer again and set the token to arm competition mode)\n");
	await chat(["chat", ...argv.slice(1)]);
}

export async function runWqCommand(argv: string[]): Promise<void> {
	const action = (argv[0] ?? "auto").toLowerCase();
	switch (action) {
		case "help":
		case "--help":
		case "-h":
			printHelp();
			return;
		case "auto":
			await auto(argv);
			return;
		case "chat":
			await chat(argv);
			return;
		case "runtime":
		case "rpc":
			await runtime(argv);
			return;
		case "doctor":
			await doctor(argv);
			return;
		case "model":
			process.stdout.write(`${wanwandequModelSelector()}\n`);
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
			throw new Error(`unknown omp-wanwandequ action "${action}"; run 'omp-wanwandequ help'`);
	}
}
