import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const WQ_HEARTBEAT_FILE = "heartbeat.json";
export const WQ_CONTROL_FILE = "control.json";
export const WQ_LEASE_FILE = "controller.lock";
export const WQ_CONTROLLER_STATE_VERSION = 1;

const CONTROLLER_FRESH_MS = 15_000;

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

interface WqControllerLease {
	version: 1;
	runId: string;
	pid: number;
	startedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRunId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function leasePath(runtimeRoot: string): string {
	return path.join(runtimeRoot, WQ_LEASE_FILE);
}

async function readJson(file: string): Promise<unknown> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8"));
	} catch {
		return undefined;
	}
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recent(timestamp: number | undefined, now = Date.now()): boolean {
	return timestamp !== undefined && timestamp <= now + 30_000 && now - timestamp <= CONTROLLER_FRESH_MS;
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
	} catch {
		// Windows can reject replacement rename when another process has the target
		// briefly open. Keep the normal path atomic and use a complete-file fallback
		// rather than reverting to incremental writes.
		try {
			await fs.copyFile(temp, file);
		} finally {
			await fs.rm(temp, { force: true }).catch(() => {});
		}
	}
}

export async function writeWqHeartbeat(runtimeRoot: string, heartbeat: WqControllerHeartbeat): Promise<void> {
	await writeJsonAtomic(heartbeatPath(runtimeRoot), heartbeat);
}

/**
 * Acquire one controller slot for a competition root. The lock is created with
 * O_EXCL so Studio checks are not the only duplicate-run defense. A stale lock
 * left by a crash is reclaimed only when both its lease and heartbeat are old.
 */
export async function acquireWqControllerLease(runtimeRoot: string, runId: string): Promise<void> {
	await fs.mkdir(runtimeRoot, { recursive: true });
	const file = leasePath(runtimeRoot);
	const lease: WqControllerLease = {
		version: 1,
		runId,
		pid: process.pid,
		startedAt: Date.now(),
	};

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await fs.open(file, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify(lease)}\n`, "utf8");
			} finally {
				await handle.close();
			}
			return;
		} catch (error) {
			if (!isRecord(error) || error.code !== "EEXIST") throw error;
			const [existingLease, existingHeartbeat] = await Promise.all([
				readJson(file),
				readJson(heartbeatPath(runtimeRoot)),
			]);
			const leaseStarted = isRecord(existingLease) ? finiteNumber(existingLease.startedAt) : undefined;
			const heartbeatUpdated = isRecord(existingHeartbeat) ? finiteNumber(existingHeartbeat.updatedAt) : undefined;
			const owner = isRecord(existingLease) && validRunId(existingLease.runId) ? existingLease.runId : "unknown";
			if (recent(leaseStarted) || recent(heartbeatUpdated)) {
				throw new Error(`competition controller already active for this root (run=${owner})`);
			}
			await fs.rm(file, { force: true });
		}
	}
	throw new Error("failed to acquire competition controller lease");
}

export async function releaseWqControllerLease(runtimeRoot: string, runId: string): Promise<void> {
	const file = leasePath(runtimeRoot);
	const existing = await readJson(file);
	if (!isRecord(existing) || existing.runId !== runId) return;
	await fs.rm(file, { force: true }).catch(() => {});
}

export async function readWqControl(runtimeRoot: string, runId: string): Promise<WqControllerControl | undefined> {
	const value = await readJson(controlPath(runtimeRoot));
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
