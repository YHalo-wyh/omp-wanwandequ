import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "../cli/args";
import { Settings } from "../config/settings";
import { runRootCommand } from "../main";
import { createAgentSession, type CreateAgentSessionOptions } from "../sdk";
import { wqConfigExtension } from "./config-extension";
import { wanwandequModelSelector } from "./model";
import { resolveWqPreset, wqRuntimeOverrides, type WqPresetName } from "./preset";
import { materializeWqSkills } from "./skills";
import { recommendedSolverLanes } from "./solver-policy";
import { buildWqSolvePrompt, WQ_SYSTEM_PROMPT } from "./system";

export interface WqSolveOptions {
	target: string;
	objective?: string;
	category?: string;
	preset?: WqPresetName;
	innerConcurrency?: number;
	advisor?: boolean;
	thinking?: string;
	visit?: number;
	timeoutSeconds?: number;
	print?: boolean;
	noSession?: boolean;
}

export interface WqChatOptions {
	cwd?: string;
	preset?: WqPresetName;
	innerConcurrency?: number;
	advisor?: boolean;
	thinking?: string;
}

export type WqRuntimeOptions = WqChatOptions;

function mergeAppendPrompt(existing: string | undefined): string {
	return existing?.trim() ? `${existing.trim()}\n\n${WQ_SYSTEM_PROMPT}` : WQ_SYSTEM_PROMPT;
}

function wqSessionFactory() {
	return async (sessionOptions: CreateAgentSessionOptions | undefined) => {
		const base = (sessionOptions ?? {}) as CreateAgentSessionOptions;
		return createAgentSession({
			...base,
			appendSystemPrompt: mergeAppendPrompt(base.appendSystemPrompt),
			extensions: [wqConfigExtension, ...(base.extensions ?? [])],
		});
	};
}

async function createWqSettings(options: WqChatOptions, cwd: string) {
	const preset = resolveWqPreset(options.preset);
	const settings = await Settings.init({
		cwd,
		overrides: wqRuntimeOverrides(preset, {
			advisor: options.advisor,
			innerConcurrency: options.innerConcurrency,
		}),
	});
	return { preset, settings };
}

/** Open the native OMP interactive TUI with Wanwandequ policy and skills loaded. */
export async function runWqChat(options: WqChatOptions = {}): Promise<void> {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	await materializeWqSkills(cwd);
	const { settings } = await createWqSettings(options, cwd);
	const rawArgs: string[] = ["--cwd", cwd, "--auto-approve", "--model", wanwandequModelSelector()];
	if (options.thinking) rawArgs.push("--thinking", options.thinking);
	const parsed = parseArgs(rawArgs);
	await runRootCommand(parsed, rawArgs, { settings, createAgentSession: wqSessionFactory() });
}

/**
 * Run Wanwandequ as a structured headless runtime.
 *
 * stdin/stdout are OMP's native JSONL RPC protocol. No terminal emulation,
 * ANSI scraping, or synthetic tool proxy sits between the host and AgentSession.
 * The exact same WQ system prompt, skills, extensions, tools, MCP discovery,
 * subagents, compaction and model policy used by the native OMP runtime remain
 * active; only the presentation layer changes from TUI to RPC.
 */
export async function runWqRuntime(options: WqRuntimeOptions = {}): Promise<void> {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	await materializeWqSkills(cwd);
	const { settings } = await createWqSettings(options, cwd);
	const rawArgs: string[] = [
		"--cwd",
		cwd,
		"--mode",
		"rpc",
		"--auto-approve",
		"--no-title",
		"--model",
		wanwandequModelSelector(),
	];
	if (options.thinking) rawArgs.push("--thinking", options.thinking);
	const parsed = parseArgs(rawArgs);
	await runRootCommand(parsed, rawArgs, { settings, createAgentSession: wqSessionFactory() });
}

/** Run one challenge parent through the normal OMP runtime under WQ policy. */
export async function runWqSolve(options: WqSolveOptions): Promise<void> {
	const target = path.resolve(options.target);
	const stat = await fs.stat(target);
	const cwd = stat.isDirectory() ? target : path.dirname(target);
	const preset = resolveWqPreset(options.preset);
	const timeoutSeconds = Math.max(30, Math.floor(options.timeoutSeconds ?? preset.visitSeconds));
	const innerConcurrency =
		options.innerConcurrency ?? recommendedSolverLanes(options.category, options.visit, preset.innerConcurrency);

	// WQ ships authored OMP skills inside the standalone binary, then materializes
	// them into the isolated challenge workspace so normal OMP skill discovery and
	// every delegated subagent see the same competition playbooks.
	await materializeWqSkills(cwd);

	const settings = await Settings.init({
		cwd,
		overrides: wqRuntimeOverrides(preset, {
			advisor: options.advisor,
			innerConcurrency,
		}),
	});

	const prompt = buildWqSolvePrompt({
		challengePath: target,
		objective: options.objective,
		categoryHint: options.category,
		visit: options.visit,
		innerConcurrency,
	});

	const rawArgs: string[] = [
		"--cwd",
		cwd,
		"--max-time",
		String(timeoutSeconds),
		"--auto-approve",
		"--no-title",
		"--model",
		wanwandequModelSelector(),
	];
	if (options.print !== false) rawArgs.push("--print");
	if (options.noSession !== false) rawArgs.push("--no-session");
	if (options.thinking) rawArgs.push("--thinking", options.thinking);
	// Positional prompt comes last so flag-shaped challenge text can never be
	// parsed as an OMP option.
	rawArgs.push("--", prompt);
	const parsed = parseArgs(rawArgs);

	await runRootCommand(parsed, rawArgs, { settings, createAgentSession: wqSessionFactory() });
}
