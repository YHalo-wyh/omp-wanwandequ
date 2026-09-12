import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WqEventLog } from "../src/wq/events";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("WqEventLog", () => {
	test("appends JSONL records and resumes sequence numbers after reopen", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "wq-events-"));
		roots.push(root);
		const first = await WqEventLog.open(root);
		await first.emit("run.started", { preset: "turbo" });
		await first.emit("challenge.started", { questionId: "pwn-1" });
		await first.flush();

		const reopened = await WqEventLog.open(root);
		await reopened.emit("run.finished", { solved: 1 });
		await reopened.flush();

		const lines = (await fs.readFile(path.join(root, "events.jsonl"), "utf8"))
			.trim()
			.split(/\r?\n/)
			.map(
				line => JSON.parse(line) as { version: number; seq: number; type: string; data: Record<string, unknown> },
			);

		expect(lines).toHaveLength(3);
		expect(lines.map(item => item.seq)).toEqual([1, 2, 3]);
		expect(lines.map(item => item.type)).toEqual(["run.started", "challenge.started", "run.finished"]);
		expect(lines[0]?.version).toBe(1);
		expect(lines[1]?.data.questionId).toBe("pwn-1");
	});
});
