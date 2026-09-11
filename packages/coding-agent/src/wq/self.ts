import * as path from "node:path";

/**
 * Command prefix that starts this same OMP fork in a child process.
 * Compiled binaries execute themselves directly; source/dev mode re-enters the
 * current Bun main module so `bun .../cli.ts wq ...` behaves identically.
 */
export function currentOmpCommand(): string[] {
	const execBase = path.basename(process.execPath).toLowerCase();
	const compiled = process.env.PI_COMPILED === "true" || execBase.startsWith("omp") || execBase.startsWith("pi");
	if (compiled) return [process.execPath];
	return [process.execPath, Bun.main];
}

export interface SpawnCaptureResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	elapsedMs: number;
}

export async function spawnSelfCapture(args: string[], options: { cwd: string; timeoutMs: number }): Promise<SpawnCaptureResult> {
	const started = Date.now();
	const proc = Bun.spawn([...currentOmpCommand(), ...args], {
		cwd: options.cwd,
		env: process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdoutPromise = new Response(proc.stdout).text();
	const stderrPromise = new Response(proc.stderr).text();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<number>(resolve => {
		timer = setTimeout(() => {
			timedOut = true;
			try {
				proc.kill("SIGKILL");
			} catch {}
			resolve(124);
		}, Math.max(1_000, options.timeoutMs));
	});
	const exitCode = await Promise.race([proc.exited, timeout]);
	if (timer) clearTimeout(timer);
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	return {
		exitCode,
		stdout,
		stderr,
		timedOut,
		elapsedMs: Date.now() - started,
	};
}
