#!/usr/bin/env bun

import * as os from "node:os";
import * as path from "node:path";
import { installWqAuditLogging } from "./wq/logging";

// Wanwandequ is a separate installed agent, not an OMP profile. Keep its
// credentials, models.yml, sessions and caches isolated from a normal `omp`
// installation unless the operator explicitly chooses another config root.
process.env.PI_CONFIG_DIR ||= process.env.WANWANDEQU_CONFIG_DIR || path.join(os.homedir(), ".omp-wanwandequ");
process.env.OMP_CONFIG_DIR ||= process.env.PI_CONFIG_DIR;

// Every invocation leaves an auditable transcript in the launch working
// directory. This is intentionally outside the private config root so a
// competition organizer can inspect/copy the run evidence directly.
const audit = installWqAuditLogging(process.cwd());
process.env.WANWANDEQU_LOG_DIR ||= audit.logDir;

function normalizeWanwanArgv(argv: string[]): string[] {
	const first = argv[0];
	if (!first) return ["wq", "help"];

	// Compiled OMP worker/subprocess selectors and root runtime flags must pass
	// through untouched; the underlying OMP engine re-enters this same binary.
	if (first.startsWith("__omp_") || first.startsWith("__pi_") || first.startsWith("-")) return argv;

	// Internal WQ child processes already carry the hidden/top-level `wq` prefix.
	if (first === "wq") return argv;

	// The public binary presents WQ actions directly:
	//   omp-wanwandequ run / solve / bench / doctor / agents / presets
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
