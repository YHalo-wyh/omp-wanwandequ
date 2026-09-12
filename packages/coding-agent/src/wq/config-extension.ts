import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext, ExtensionFactory } from "../extensibility/extensions";

const API_KEY = "DEEPSEEK_API_KEY";
const TEAM_TOKEN = "WQ_TEAM_TOKEN";
const QUERY_URL = "WQ_QUERY_URL";
const RESET_URL = "WQ_RESET_URL";
const SUBMIT_URL = "WQ_SUBMIT_URL";

function configRoot(): string {
	return (
		process.env.WANWANDEQU_CONFIG_DIR?.trim() ||
		process.env.PI_CONFIG_DIR?.trim() ||
		path.join(os.homedir(), ".omp-wanwandequ")
	);
}

export function wqEnvPath(): string {
	return path.join(configRoot(), ".env");
}

function assertConfigValue(value: string): void {
	if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
		throw new Error("configuration values may not contain NUL/newline characters");
	}
}

function validateEndpoint(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error("endpoint must be an absolute URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("endpoint must use http or https");
	return url.toString();
}

async function readLines(file: string): Promise<string[]> {
	try {
		return (await fs.readFile(file, "utf8")).split(/\r?\n/);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export async function persistWqEnvValue(key: string, value: string): Promise<void> {
	assertConfigValue(value);
	const file = wqEnvPath();
	await fs.mkdir(path.dirname(file), { recursive: true });
	const lines = await readLines(file);
	const prefix = `${key}=`;
	let replaced = false;
	const next = lines.map(line => {
		if (line.startsWith(prefix)) {
			replaced = true;
			return `${prefix}${value}`;
		}
		return line;
	});
	if (!replaced) next.push(`${prefix}${value}`);
	if (!next.some(line => line.startsWith("WANWANDEQU_PRESET="))) next.push("WANWANDEQU_PRESET=turbo");
	const normalized = next.filter((line, index) => !(index === next.length - 1 && line === "")).join("\n") + "\n";
	const tmp = `${file}.tmp-${process.pid}`;
	await fs.writeFile(tmp, normalized, { encoding: "utf8", mode: 0o600 });
	await fs.rename(tmp, file);
	try {
		await fs.chmod(file, 0o600);
	} catch {
		// Windows ACLs do not map cleanly to POSIX chmod; install location remains user-scoped.
	}
}

function maskedStatus(value: string | undefined): string {
	return value?.trim() ? "configured" : "not configured";
}

function endpointStatus(): string {
	return `Query: ${maskedStatus(process.env[QUERY_URL])} · Reset: ${maskedStatus(process.env[RESET_URL])} · Submit: ${maskedStatus(process.env[SUBMIT_URL])}`;
}

async function setSecret(kind: "api" | "token", ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("This command requires the interactive TUI.", "warning");
		return;
	}
	const isApi = kind === "api";
	const title = isApi ? "DeepSeek API Key" : "Competition Team Token";
	const placeholder = isApi ? "Paste key (not written to WQ logs)" : "Paste team token (not written to WQ logs)";
	const secret = await ctx.ui.input(title, placeholder);
	if (secret === undefined) return;
	const trimmed = secret.trim();
	if (!trimmed) {
		ctx.ui.notify(`${title} unchanged.`, "info");
		return;
	}
	const envKey = isApi ? API_KEY : TEAM_TOKEN;
	await persistWqEnvValue(envKey, trimmed);
	process.env[envKey] = trimmed;
	ctx.ui.notify(
		isApi
			? "DeepSeek API key saved for omp-wanwandequ."
			: "Team token saved. Wanwandequ is ARMED when all competition endpoints are configured.",
		"info",
	);
}

async function setEndpoint(key: string, title: string, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("This command requires the interactive TUI.", "warning");
		return;
	}
	const input = await ctx.ui.input(title, process.env[key] || "https://...");
	if (input === undefined) return;
	const normalized = validateEndpoint(input);
	await persistWqEnvValue(key, normalized);
	if (normalized) process.env[key] = normalized;
	else delete process.env[key];
	ctx.ui.notify(`${title} ${normalized ? "saved" : "cleared"}.`, "info");
}

async function clearSecret(kind: "api" | "token", ctx: ExtensionContext): Promise<void> {
	const envKey = kind === "api" ? API_KEY : TEAM_TOKEN;
	await persistWqEnvValue(envKey, "");
	delete process.env[envKey];
	ctx.ui.notify(
		kind === "api" ? "DeepSeek API key cleared." : "Team token cleared; bare launch returns to test chat mode.",
		"info",
	);
}

export const wqConfigExtension: ExtensionFactory = pi => {
	pi.setLabel("Wanwandequ configuration");

	pi.registerCommand("wq-status", {
		description: "Show Wanwandequ credential/platform status without revealing secrets",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`DeepSeek key: ${maskedStatus(process.env[API_KEY])} · Team token: ${maskedStatus(process.env[TEAM_TOKEN])} · ${endpointStatus()} · ${process.env[TEAM_TOKEN]?.trim() ? "ARMED" : "TEST MODE"}`,
				"info",
			);
		},
	});

	pi.registerCommand("wq-key", {
		description: "Set/replace the DeepSeek API key for Wanwandequ",
		handler: async (_args, ctx) => setSecret("api", ctx),
	});

	pi.registerCommand("wq-token", {
		description: "Set/replace the competition team token",
		handler: async (_args, ctx) => setSecret("token", ctx),
	});

	pi.registerCommand("wq-config", {
		description: "Open Wanwandequ credentials and competition platform configuration",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/wq-config requires the interactive TUI.", "warning");
				return;
			}
			const armed = Boolean(process.env[TEAM_TOKEN]?.trim());
			const choice = await ctx.ui.select("Wanwandequ configuration", [
				`Status (${armed ? "ARMED" : "TEST MODE"})`,
				"Set/replace DeepSeek API key",
				"Set/replace competition team token",
				"Set question query endpoint",
				"Set environment reset endpoint",
				"Set flag submit endpoint",
				"Clear competition team token",
				"Clear DeepSeek API key",
			]);
			if (!choice) return;
			if (choice.startsWith("Status")) {
				ctx.ui.notify(
					`DeepSeek key: ${maskedStatus(process.env[API_KEY])} · Team token: ${maskedStatus(process.env[TEAM_TOKEN])} · ${endpointStatus()}`,
					"info",
				);
				return;
			}
			if (choice === "Set/replace DeepSeek API key") return setSecret("api", ctx);
			if (choice === "Set/replace competition team token") return setSecret("token", ctx);
			if (choice === "Set question query endpoint") return setEndpoint(QUERY_URL, "Question query endpoint", ctx);
			if (choice === "Set environment reset endpoint")
				return setEndpoint(RESET_URL, "Environment reset endpoint", ctx);
			if (choice === "Set flag submit endpoint") return setEndpoint(SUBMIT_URL, "Flag submit endpoint", ctx);
			if (choice === "Clear competition team token") return clearSecret("token", ctx);
			if (choice === "Clear DeepSeek API key") return clearSecret("api", ctx);
		},
	});
};
