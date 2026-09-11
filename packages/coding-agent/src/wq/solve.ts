import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "../cli/args";
import { Settings } from "../config/settings";
import { runRootCommand } from "../main";
import { createAgentSession } from "../sdk";
import { resolveWqPreset, wqRuntimeOverrides, type WqPresetName } from "./preset";
import { buildWqSolvePrompt, WQ_SYSTEM_PROMPT } from "./system";

export interface WqSolveOptions {
	target: string;
	objective?: string;
	category?: string;
	preset?: WqPresetName;
	innerConcurrency?: number;
	advisor?: boolean;
	model?: string;
	provider?: string;
	thinking?: string;
	visit?: number;
	timeoutSeconds?: number;
	print?: boolean;
	noSession?: boolean;
}

function mergeAppendPrompt(existing: string | undefined): string {
	return existing?.trim() ? `${existing.trim()}\n\n${WQ_SYSTEM_PROMPT}` : WQ_SYSTEM_PROMPT;
}

/**
 * Run one challenge parent session through the normal OMP runtime with WQ's
 * native, non-persistent competition overrides. The user's auth/provider/MCP
 * configuration is still loaded by Settings.init; only this process receives
 * the WQ policy.
 */
export async function runWqSolve(options: WqSolveOptions): Promise<void> {
	const target = path.resolve(options.target);
	const stat = await fs.stat(target);
	const cwd = stat.isDirectory() ? target : path.dirname(target);
	const preset = resolveWqPreset(options.preset);
	const timeoutSeconds = Math.max(30, Math.floor(options.timeoutSeconds ?? preset.visitSeconds));
	const settings = await Settings.init({
		cwd,
		overrides: wqRuntimeOverrides(preset, {
			advisor: options.advisor,
			innerConcurrency: options.innerConcurrency,
		}),
	});

	const prompt = buildWqSolvePrompt({
		challengePath: target,
		objective: options.objective,
		categoryHint: options.category,
		visit: options.visit,
	});

	const rawArgs: string[] = ["--cwd", cwd, "--max-time", String(timeoutSeconds), "--auto-approve", "--no-title"];
	if (options.print !== false) rawArgs.push("--print");
	if (options.noSession !== false) rawArgs.push("--no-session");
	if (options.provider) rawArgs.push("--provider", options.provider);
	if (options.model) rawArgs.push("--model", options.model);
	if (options.thinking) rawArgs.push("--thinking", options.thinking);
	// Positional prompt comes last so flag-shaped challenge text can never be
	// parsed as an OMP option.
	rawArgs.push("--", prompt);
	const parsed = parseArgs(rawArgs);

	await runRootCommand(parsed, rawArgs, {
		settings,
		createAgentSession: async sessionOptions =>
			createAgentSession({
				...sessionOptions,
				appendSystemPrompt: mergeAppendPrompt(sessionOptions.appendSystemPrompt),
			}),
	});
}
