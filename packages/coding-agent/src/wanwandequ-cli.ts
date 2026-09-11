#!/usr/bin/env bun

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installWqAuditLogging } from "./wq/logging";

// Wanwandequ is a separate installed agent, not an OMP profile. Keep its
// credentials, models.yml, sessions and caches isolated from a normal `omp`
// installation unless the operator explicitly chooses another config root.
process.env.PI_CONFIG_DIR ||= process.env.WANWANDEQU_CONFIG_DIR || path.join(os.homedir(), ".omp-wanwandequ");
process.env.OMP_CONFIG_DIR ||= process.env.PI_CONFIG_DIR;

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

loadStandaloneEnv(process.env.PI_CONFIG_DIR);

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

	// The public binary presents WQ actions directly:
	//   omp-wanwandequ / chat / run / solve / bench / doctor / agents / presets
	return ["wq", ...argv];
}

const normalized = normalizeWanwanArgv(process.argv.slice(2));
process.argv.splice(2, process.argv.length - 2, ...normalized);

// In a compiled build, cli.ts recognizes PI_COMPILED and launches itself after
// this bootstrap has established the isolated config root and normalized argv.
// In source/dev mode it is only an imported module, so invoke runCli ourselves.
void import("./cli")
	.then(async ({ runCli }) => {
		if (process.env.PI_COMPILED !== "true") await runCli(normalized);
	})
	.catch(error => {
		process.stderr.write(`omp-wanwandequ fatal: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
		process.exitCode = 1;
	});
