import * as fs from "node:fs";
import * as path from "node:path";

export interface WqAuditLog {
	logDir: string;
	logFile: string;
}

let installed: WqAuditLog | undefined;

function stamp(date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function redactArgv(argv: readonly string[]): string[] {
	const result: string[] = [];
	let redactNext = false;
	for (const arg of argv) {
		if (redactNext) {
			result.push("<redacted>");
			redactNext = false;
			continue;
		}
		if (arg === "--token") {
			result.push(arg);
			redactNext = true;
			continue;
		}
		if (arg.startsWith("--token=")) {
			result.push("--token=<redacted>");
			continue;
		}
		result.push(arg);
	}
	return result;
}

function asText(chunk: unknown, encoding?: BufferEncoding): string {
	if (typeof chunk === "string") return chunk;
	if (Buffer.isBuffer(chunk)) return chunk.toString(encoding ?? "utf8");
	if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString(encoding ?? "utf8");
	return String(chunk);
}

/**
 * Tee stdout/stderr into <working-directory>/logs without changing normal terminal output.
 * The organizer can inspect a stable plaintext transcript after the run; per-challenge
 * visit logs and state are written by the competition scheduler into the same tree.
 */
export function installWqAuditLogging(cwd = process.cwd()): WqAuditLog {
	if (installed) return installed;
	const logDir = path.resolve(process.env.WANWANDEQU_LOG_DIR || path.join(cwd, "logs"));
	fs.mkdirSync(logDir, { recursive: true });
	const logFile = path.join(logDir, `omp-wanwandequ-${stamp()}.log`);
	const header = [
		"# OMP-Wanwandequ audit log",
		`# started=${new Date().toISOString()}`,
		`# cwd=${cwd}`,
		`# argv=${JSON.stringify(redactArgv(process.argv.slice(2)))}`,
		"",
	].join("\n");
	fs.writeFileSync(logFile, header, "utf8");

	const originalStdout = process.stdout.write.bind(process.stdout);
	const originalStderr = process.stderr.write.bind(process.stderr);
	const append = (stream: "stdout" | "stderr", chunk: unknown, encoding?: BufferEncoding) => {
		try {
			const text = asText(chunk, encoding);
			fs.appendFileSync(logFile, stream === "stderr" ? `[stderr] ${text}` : text, "utf8");
		} catch {
			// Logging must never take the solver down.
		}
	};

	(process.stdout.write as unknown as (...args: unknown[]) => boolean) = ((
		chunk: unknown,
		encoding?: BufferEncoding,
		cb?: () => void,
	) => {
		append("stdout", chunk, encoding);
		return originalStdout(chunk as never, encoding as never, cb as never);
	}) as never;
	(process.stderr.write as unknown as (...args: unknown[]) => boolean) = ((
		chunk: unknown,
		encoding?: BufferEncoding,
		cb?: () => void,
	) => {
		append("stderr", chunk, encoding);
		return originalStderr(chunk as never, encoding as never, cb as never);
	}) as never;

	const finish = (kind: string) => {
		try {
			fs.appendFileSync(logFile, `\n# ${kind}=${new Date().toISOString()}\n`, "utf8");
		} catch {}
	};
	process.once("beforeExit", () => finish("finished"));
	process.once("SIGINT", () => finish("sigint"));
	process.once("SIGTERM", () => finish("sigterm"));

	installed = { logDir, logFile };
	return installed;
}
