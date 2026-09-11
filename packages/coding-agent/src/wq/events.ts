import * as fs from "node:fs/promises";
import * as path from "node:path";

export const WQ_EVENT_VERSION = 1 as const;

export interface WqEventRecord {
	version: typeof WQ_EVENT_VERSION;
	seq: number;
	ts: number;
	type: string;
	data: Record<string, unknown>;
}

/**
 * Append-only machine-readable competition event stream.
 *
 * This is intentionally separate from human console/audit logs. Studio and
 * other observers can rebuild transient runtime state from events.jsonl without
 * parsing ANSI terminal output or coupling themselves to log wording.
 */
export class WqEventLog {
	readonly file: string;
	#seq = 0;
	#writeChain: Promise<void> = Promise.resolve();

	private constructor(file: string, seq: number) {
		this.file = file;
		this.#seq = seq;
	}

	static async open(runtimeRoot: string): Promise<WqEventLog> {
		await fs.mkdir(runtimeRoot, { recursive: true });
		const file = path.join(runtimeRoot, "events.jsonl");
		let seq = 0;
		try {
			const text = await fs.readFile(file, "utf8");
			for (const line of text.split(/\r?\n/)) {
				if (!line.trim()) continue;
				try {
					const parsed = JSON.parse(line) as Partial<WqEventRecord>;
					if (typeof parsed.seq === "number" && Number.isFinite(parsed.seq)) seq = Math.max(seq, parsed.seq);
				} catch {}
			}
		} catch {}
		return new WqEventLog(file, seq);
	}

	emit(type: string, data: Record<string, unknown> = {}): Promise<void> {
		const record: WqEventRecord = {
			version: WQ_EVENT_VERSION,
			seq: ++this.#seq,
			ts: Date.now(),
			type,
			data,
		};
		const line = `${JSON.stringify(record)}\n`;
		this.#writeChain = this.#writeChain.then(() => fs.appendFile(this.file, line, "utf8"));
		return this.#writeChain;
	}

	flush(): Promise<void> {
		return this.#writeChain;
	}
}
