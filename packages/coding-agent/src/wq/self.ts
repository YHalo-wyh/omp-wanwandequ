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
	aborted: boolean;
	elapsedMs: number;
}

export async function spawnSelfCapture(
	args: string[],
	options: { cwd: string; timeoutMs: number; stripEnv?: string[]; signal?: AbortSignal },
): Promise<SpawnCaptureResult> {
	const started = Date.now();
	const env: Record<string, string | undefined> = { ...process.env };
	for (const key of options.stripEnv ?? []) delete env[key];
	const proc = Bun.spawn([...currentOmpCommand(), ...args], {
		cwd: options.cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdoutPromise = new Response(proc.stdout).text();
	const stderrPromise = new Response(proc.stderr).text();
	let timedOut = false;
	let aborted = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let detachAbort: (() => void) | undefined;

	const kill = () => {
		try {
			proc.kill("SIGKILL");
		} catch {}
	};
	const timeout = new Promise<number>(resolve => {
		timer = setTimeout(
			() => {
				timedOut = true;
				kill();
				resolve(124);
			},
			Math.max(1_000, options.timeoutMs),
		);
	});
	const abort = new Promise<number>(resolve => {
		const signal = options.signal;
		if (!signal) return;
		const onAbort = () => {
			aborted = true;
			kill();
			resolve(130);
		};
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		detachAbort = () => signal.removeEventListener("abort", onAbort);
	});
	const exitCode = await Promise.race([proc.exited, timeout, abort]);
	if (timer) clearTimeout(timer);
	detachAbort?.();
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	return {
		exitCode,
		stdout,
		stderr,
		timedOut,
		aborted,
		elapsedMs: Date.now() - started,
	};
}
