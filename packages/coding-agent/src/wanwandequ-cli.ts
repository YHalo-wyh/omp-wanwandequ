#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installWqAuditLogging } from "./wq/logging";

/**
 * PI_CONFIG_DIR is an OMP config *directory name/path relative to home*, not an
 * absolute config-root variable. Passing `C:\\Users\\...\\.omp-wanwandequ` on
 * Windows makes the core resolver do `path.join(os.homedir(), PI_CONFIG_DIR)`
 * and produces `C:\\Users\\...\\C:\\Users\\...\\.omp-wanwandequ`.
 *
 * Wanwandequ still exposes WANWANDEQU_CONFIG_DIR as an ergonomic config-root
 * override. Convert it to the relative form expected by OMP. A config root on a
 * different Windows drive cannot be represented by PI_CONFIG_DIR without
 * changing OMP's global path contract, so fail early with a useful message
 * instead of reaching storage initialization with a misleading ENOENT.
 */
function configureStandaloneRoot(): string {
	const home = path.resolve(os.homedir());
	const explicitPi = process.env.PI_CONFIG_DIR?.trim();
	const explicitWq = process.env.WANWANDEQU_CONFIG_DIR?.trim();
	const requested = explicitWq || explicitPi || path.join(home, ".omp-wanwandequ");
	const absolute = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(home, requested);
	const relative = path.relative(home, absolute) || ".";
	if (path.isAbsolute(relative)) {
		throw new Error(
			`Wanwandequ config root must be representable relative to the current home directory (${home}); ` +
				`cross-volume root is not supported by OMP PI_CONFIG_DIR: ${absolute}`,
		);
	}
	process.env.PI_CONFIG_DIR = relative;
	process.env.OMP_CONFIG_DIR ||= relative;
	return absolute;
}

const standaloneConfigRoot = configureStandaloneRoot();

/**
 * Load the standalone config-root .env before command routing. OMP itself also
 * understands .env files later in startup, but WQ needs WQ_TEAM_TOKEN early so
 * a bare `omp-wanwandequ` can decide between interactive test mode and fully
 * autonomous competition mode.
 */
function loadStandaloneEnv(configRoot: string): void {
	const file = path.join(configRoot, ".env");
	let text = "";
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		return;
	}
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

loadStandaloneEnv(standaloneConfigRoot);

const originalArgs = process.argv.slice(2);

/**
 * A console executable started by Explorer gets a transient console window.
 * If startup fails (missing credential/model config, etc.) that window vanishes
 * before the operator can read the error. Detect Explorer as the parent and
 * relaunch the exact same binary in a persistent PowerShell window. Normal
 * PowerShell/CMD/Windows Terminal invocations stay in the current terminal.
 */
function launchedFromWindowsExplorer(): boolean {
	if (process.platform !== "win32" || originalArgs.length !== 0 || process.env.WANWANDEQU_TERMINAL_RELAUNCH === "1") {
		return false;
	}
	try {
		const result = spawnSync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${process.ppid} -ErrorAction Stop).ProcessName`],
			{ encoding: "utf8", windowsHide: true },
		);
		return result.status === 0 && result.stdout.trim().toLowerCase() === "explorer";
	} catch {
		return false;
	}
}

if (launchedFromWindowsExplorer()) {
	const escapedExe = process.execPath.replace(/'/g, "''");
	const child = spawn("powershell.exe", ["-NoExit", "-NoProfile", "-Command", `& '${escapedExe}'`], {
		cwd: process.cwd(),
		detached: true,
		stdio: "ignore",
		env: { ...process.env, WANWANDEQU_TERMINAL_RELAUNCH: "1" },
	});
	child.unref();
	process.exit(0);
}

// Every invocation leaves an auditable transcript in the launch working
// directory. This is intentionally outside the private config root so a
// competition organizer can inspect/copy the run evidence directly.
const audit = installWqAuditLogging(process.cwd());
process.env.WANWANDEQU_LOG_DIR ||= audit.logDir;

function normalizeWanwanArgv(argv: string[]): string[] {
	const first = argv[0];
	// No-argument behavior is stateful by design:
	// - no team token => interactive testing/TUI
	// - team token configured => fully autonomous competition mode
	if (!first) return ["wq", "auto"];

	// Compiled OMP worker/subprocess selectors and root runtime flags must pass
	// through untouched; the underlying OMP engine re-enters this same binary.
	if (first.startsWith("__omp_") || first.startsWith("__pi_") || first.startsWith("-")) return argv;

	// Internal WQ child processes already carry the hidden/top-level `wq` prefix.
	if (first === "wq") return argv;

	// The public binary presents terminal-first WQ actions directly:
	//   omp-wanwandequ / chat / run / solve / bench / doctor / agents / presets
	return ["wq", ...argv];
}

const normalized = normalizeWanwanArgv(originalArgs);
process.argv.splice(2, process.argv.length - 2, ...normalized);

// In a compiled build, cli.ts recognizes PI_COMPILED and launches itself after
// this bootstrap has established the isolated config root and normalized argv.
// In source/dev mode it is only an imported module, so invoke runCli ourselves.
void import("./cli")
	.then(async ({ runCli }) => {
		if (process.env.PI_COMPILED !== "true") await runCli(normalized);
	})
	.catch(async error => {
		process.stderr.write(`omp-wanwandequ fatal: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
		process.exitCode = 1;
		// Last-resort safety for a directly opened console if Explorer detection is
		// unavailable on a particular Windows build. Never pause scripted/CI runs.
		if (process.platform === "win32" && originalArgs.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
			process.stderr.write("\nPress Enter to close...\n");
			await new Promise<void>(resolve => {
				process.stdin.resume();
				process.stdin.once("data", () => resolve());
			});
		}
	});
