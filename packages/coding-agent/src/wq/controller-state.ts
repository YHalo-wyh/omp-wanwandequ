import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const WQ_HEARTBEAT_FILE = "heartbeat.json";
export const WQ_CONTROL_FILE = "control.json";
export const WQ_CONTROLLER_STATE_VERSION = 1;

export type WqControllerPhase = "running" | "stopping";

export interface WqControllerHeartbeat {
	version: 1;
	runId: string;
	pid: number;
	root: string;
	startedAt: number;
	updatedAt: number;
	deadline: number;
	preset: string;
	activeChallenges: number;
	phase: WqControllerPhase;
}

export interface WqControllerControl {
	version: 1;
	runId: string;
	action: "stop";
	requestedAt: number;
	reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRunId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

export function createWqRunId(): string {
	return randomUUID();
}

export function heartbeatPath(runtimeRoot: string): string {
	return path.join(runtimeRoot, WQ_HEARTBEAT_FILE);
}

export function controlPath(runtimeRoot: string): string {
	return path.join(runtimeRoot, WQ_CONTROL_FILE);
}

/**
 * Write small controller-state files through a same-directory temporary file.
 * Readers therefore observe either the previous complete JSON document or the
 * next one, never a partially-written heartbeat/control record.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
	const text = `${JSON.stringify(value)}\n`;
	await fs.writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
	try {
		await fs.rename(temp, file);
	} catch (error) {
		// Windows can reject replacement rename when another process has the target
		// briefly open. Keep the normal path atomic and use a complete-file fallback
		// rather than reverting to incremental writes.
		try {
			await fs.copyFile(temp, file);
		} finally {
			await fs.rm(temp, { force: true }).catch(() => {});
		}
		if (!(error instanceof Error)) throw error;
	}
}

export async function writeWqHeartbeat(runtimeRoot: string, heartbeat: WqControllerHeartbeat): Promise<void> {
	await writeJsonAtomic(heartbeatPath(runtimeRoot), heartbeat);
}

export async function readWqControl(runtimeRoot: string, runId: string): Promise<WqControllerControl | undefined> {
	let value: unknown;
	try {
		value = JSON.parse(await fs.readFile(controlPath(runtimeRoot), "utf8"));
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	if (value.version !== WQ_CONTROLLER_STATE_VERSION || value.action !== "stop") return undefined;
	if (!validRunId(value.runId) || value.runId !== runId) return undefined;
	if (typeof value.requestedAt !== "number" || !Number.isFinite(value.requestedAt)) return undefined;
	return {
		version: 1,
		runId: value.runId,
		action: "stop",
		requestedAt: value.requestedAt,
		...(typeof value.reason === "string" && value.reason.trim() ? { reason: value.reason.slice(0, 512) } : {}),
	};
}

export async function clearWqControl(runtimeRoot: string, runId?: string): Promise<void> {
	const file = controlPath(runtimeRoot);
	if (runId) {
		const current = await readWqControl(runtimeRoot, runId);
		if (!current) return;
	}
	await fs.rm(file, { force: true }).catch(() => {});
}
