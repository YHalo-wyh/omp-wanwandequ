import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	clearWqControl,
	controlPath,
	createWqRunId,
	heartbeatPath,
	readWqControl,
	writeJsonAtomic,
	writeWqHeartbeat,
} from "../src/wq/controller-state";

const roots: string[] = [];

async function tempRuntime(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wq-controller-state-"));
	roots.push(root);
	return path.join(root, ".wq");
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("WQ controller state", () => {
	test("publishes a complete heartbeat document", async () => {
		const runtime = await tempRuntime();
		const runId = createWqRunId();
		await writeWqHeartbeat(runtime, {
			version: 1,
			runId,
			pid: 123,
			root: "C:/ctf",
			startedAt: 10,
			updatedAt: 20,
			deadline: 30,
			preset: "turbo",
			activeChallenges: 2,
			phase: "running",
		});
		const parsed = JSON.parse(await fs.readFile(heartbeatPath(runtime), "utf8"));
		expect(parsed.runId).toBe(runId);
		expect(parsed.phase).toBe("running");
		expect(parsed.activeChallenges).toBe(2);
	});

	test("accepts stop control only for the matching controller id", async () => {
		const runtime = await tempRuntime();
		const runId = createWqRunId();
		await writeJsonAtomic(controlPath(runtime), {
			version: 1,
			runId,
			action: "stop",
			requestedAt: Date.now(),
			reason: "Studio requested stop",
		});
		expect((await readWqControl(runtime, runId))?.action).toBe("stop");
		expect(await readWqControl(runtime, createWqRunId())).toBeUndefined();
	});

	test("clears only a control request addressed to the active run", async () => {
		const runtime = await tempRuntime();
		const runId = createWqRunId();
		await writeJsonAtomic(controlPath(runtime), {
			version: 1,
			runId,
			action: "stop",
			requestedAt: Date.now(),
		});
		await clearWqControl(runtime, createWqRunId());
		expect(await fs.readFile(controlPath(runtime), "utf8")).toContain(runId);
		await clearWqControl(runtime, runId);
		await expect(fs.readFile(controlPath(runtime), "utf8")).rejects.toBeDefined();
	});
});
