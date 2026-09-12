#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { COMPILED_EXTERNAL_DEPENDENCIES, compileCodingAgent } from "../packages/coding-agent/scripts/compile-binary";

interface BinaryTarget {
	id: string;
	platform: string;
	arch: string;
	target: Bun.Build.CompileTarget;
	outfile: string;
}

const repoRoot = path.join(import.meta.dir, "..");
const binariesDir = path.join(repoRoot, "packages", "coding-agent", "binaries");
const entrypoint = path.join(repoRoot, "packages", "coding-agent", "src", "wanwandequ-cli.ts");
const manifest: unknown = createRequire(import.meta.url)("@huggingface/transformers/package.json");
if (
	typeof manifest !== "object" ||
	manifest === null ||
	!("version" in manifest) ||
	typeof manifest.version !== "string"
) {
	throw new Error("@huggingface/transformers package manifest has no string version");
}
const transformersVersion = manifest.version;
const isDryRun = process.argv.includes("--dry-run");

const targets: BinaryTarget[] = [
	{
		id: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		target: "bun-darwin-arm64",
		outfile: "packages/coding-agent/binaries/omp-wanwandequ-darwin-arm64",
	},
	{
		id: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		target: "bun-darwin-x64",
		outfile: "packages/coding-agent/binaries/omp-wanwandequ-darwin-x64",
	},
	{
		id: "linux-x64",
		platform: "linux",
		arch: "x64",
		target: "bun-linux-x64-baseline",
		outfile: "packages/coding-agent/binaries/omp-wanwandequ-linux-x64",
	},
	{
		id: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		target: "bun-linux-arm64",
		outfile: "packages/coding-agent/binaries/omp-wanwandequ-linux-arm64",
	},
	{
		id: "win32-x64",
		platform: "win32",
		arch: "x64",
		target: "bun-windows-x64-baseline",
		outfile: "packages/coding-agent/binaries/omp-wanwandequ-windows-x64.exe",
	},
	{
		id: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		target: "bun-windows-arm64",
		outfile: "packages/coding-agent/binaries/omp-wanwandequ-windows-arm64.exe",
	},
];

function requestedTargets(): Set<string> | null {
	const index = process.argv.indexOf("--targets");
	const raw = index >= 0 ? process.argv[index + 1] : process.argv.find(arg => arg.startsWith("--targets="))?.slice(10);
	if (!raw) return null;
	return new Set(
		raw
			.split(",")
			.map(value => value.trim())
			.filter(Boolean),
	);
}

async function run(command: string[], env: NodeJS.ProcessEnv = Bun.env): Promise<void> {
	const proc = Bun.spawn(command, { cwd: repoRoot, env, stdout: "inherit", stderr: "inherit" });
	const code = await proc.exited;
	if (code !== 0) throw new Error(`Command failed (${code}): ${command.join(" ")}`);
}

async function generateBundle(): Promise<void> {
	if (isDryRun) return;
	await run(["bun", "run", "gen:stats"]);
	await run(["bun", "--cwd=packages/collab-web", "run", "gen:tool-views"]);
}

async function resetBundle(): Promise<void> {
	if (isDryRun) return;
	await run(["bun", "run", "gen:native:reset"]);
	await run(["bun", "run", "gen:stats:reset"]);
}

async function build(target: BinaryTarget): Promise<void> {
	console.log(`Building ${target.outfile}...`);
	if (isDryRun) {
		console.log(
			`DRY RUN target=${target.target} entry=${path.relative(repoRoot, entrypoint)} outfile=${target.outfile} external=${COMPILED_EXTERNAL_DEPENDENCIES.join(",")}`,
		);
		return;
	}
	await run(["bun", "run", "gen:native"], { ...Bun.env, TARGET_PLATFORM: target.platform, TARGET_ARCH: target.arch });
	await compileCodingAgent({
		repoRoot,
		entrypoint,
		outfile: path.join(repoRoot, target.outfile),
		transformersVersion,
		target: target.target,
		minifyIdentifiers: true,
		skipBuiltinCodesign: target.platform === "darwin" && process.platform === "darwin",
	});
}

const requested = requestedTargets();
const selected = requested ? targets.filter(target => requested.has(target.id)) : targets;
if (requested) {
	const unknown = [...requested].filter(id => !targets.some(target => target.id === id));
	if (unknown.length) throw new Error(`Unknown target(s): ${unknown.join(", ")}`);
}
if (!selected.length) throw new Error("No Wanwandequ release targets selected");

await fs.mkdir(binariesDir, { recursive: true });
try {
	await generateBundle();
	for (const target of selected) await build(target);
} finally {
	await resetBundle();
}
