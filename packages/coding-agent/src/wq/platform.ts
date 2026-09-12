import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface WqChallenge {
	questionId: string;
	title: string;
	category: string;
	score: number;
	realScore: number;
	fileUrl: string;
	isSolved: boolean;
	solvedNumber: number;
	interactive: boolean;
	capabilities: unknown;
	connection: unknown;
	description: string;
	attributes: unknown;
	extensions: unknown;
	target: string;
	raw: Record<string, unknown>;
}

export interface WqPlatformConfig {
	token: string;
	queryUrl: string;
	resetUrl: string;
	submitUrl: string;
	timeoutMs?: number;
	retries?: number;
}

export interface WqSubmitResult {
	correct: boolean;
	code?: number;
	status?: number;
	message: string;
	raw: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	const normalized = text(value).toLowerCase();
	return normalized === "true" || normalized === "1" || normalized === "yes";
}

function connectionTarget(connection: unknown): string {
	const obj = record(connection);
	if (!obj) return "";
	for (const key of ["docker_url", "url", "target", "address", "endpoint"]) {
		const value = text(obj[key]);
		if (value) return value;
	}
	const ip = text(obj.docker_ip ?? obj.ip);
	const port = text(obj.docker_port ?? obj.port);
	return ip && port ? `${ip}:${port}` : ip;
}

export function normalizeChallenge(value: unknown): WqChallenge | undefined {
	const obj = record(value);
	if (!obj) return undefined;
	const questionId = text(obj.question_id ?? obj.questionId ?? obj.id);
	if (!questionId) return undefined;
	const connection = obj.connection;
	return {
		questionId,
		title: text(obj.title),
		category: text(obj.category).toLowerCase() || "unknown",
		score: numberValue(obj.score),
		realScore: numberValue(obj.real_score ?? obj.realScore),
		fileUrl: text(obj.file_url ?? obj.fileUrl),
		isSolved: boolValue(obj.is_solved ?? obj.isSolved),
		solvedNumber: numberValue(obj.solved_number ?? obj.solvedNumber),
		interactive: boolValue(obj.interactive),
		capabilities: obj.capabilities,
		connection,
		description: text(obj.description),
		attributes: obj.attributes,
		extensions: obj.extensions,
		target: connectionTarget(connection),
		raw: obj,
	};
}

function findChallengeArray(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload;
	const obj = record(payload);
	if (!obj) return [];
	for (const key of ["data", "questions", "challenges", "items", "list", "result"]) {
		const value = obj[key];
		if (Array.isArray(value)) return value;
		const nested = record(value);
		if (nested) {
			for (const inner of ["list", "items", "questions", "challenges", "data"]) {
				if (Array.isArray(nested[inner])) return nested[inner] as unknown[];
			}
		}
	}
	// Some test/final endpoints return one challenge object directly.
	return obj.question_id !== undefined ? [obj] : [];
}

export function normalizeChallengeList(payload: unknown): WqChallenge[] {
	return findChallengeArray(payload)
		.map(normalizeChallenge)
		.filter((item): item is WqChallenge => item !== undefined);
}

function retryableStatus(status: number): boolean {
	return (
		status === 408 ||
		status === 425 ||
		status === 429 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504
	);
}

function jitterDelay(attempt: number, response?: Response): number {
	const retryAfter = response?.headers.get("retry-after");
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 20_000);
	}
	return Math.min(500 * 2 ** attempt, 10_000) + Math.floor(Math.random() * 250);
}

export class WqPlatformClient {
	readonly #config: Required<WqPlatformConfig>;

	constructor(config: WqPlatformConfig) {
		this.#config = {
			...config,
			timeoutMs: config.timeoutMs ?? 15_000,
			retries: config.retries ?? 4,
		};
		if (!this.#config.token.trim()) throw new Error("WQ team token is required for platform mode");
	}

	async #getJson(baseUrl: string, params: Record<string, string>): Promise<unknown> {
		const url = new URL(baseUrl);
		url.searchParams.set("token", this.#config.token);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

		let lastError: unknown;
		for (let attempt = 0; attempt <= this.#config.retries; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
			try {
				const response = await fetch(url, { signal: controller.signal });
				if (!response.ok) {
					if (attempt < this.#config.retries && retryableStatus(response.status)) {
						await Bun.sleep(jitterDelay(attempt, response));
						continue;
					}
					throw new Error(`competition API HTTP ${response.status}`);
				}
				return await response.json();
			} catch (error) {
				lastError = error;
				if (attempt >= this.#config.retries) break;
				await Bun.sleep(jitterDelay(attempt));
			} finally {
				clearTimeout(timer);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	async listChallenges(): Promise<WqChallenge[]> {
		return normalizeChallengeList(await this.#getJson(this.#config.queryUrl, {}));
	}

	async submit(questionId: string, answer: string): Promise<WqSubmitResult> {
		const raw = await this.#getJson(this.#config.submitUrl, { question_id: questionId, answer });
		const obj = record(raw) ?? {};
		const code = numberValue(obj.code);
		const status = numberValue(obj.status);
		const message = text(obj.message ?? obj.msg);
		return {
			correct: status === 1 || (code === 0 && /答案正确|correct/i.test(message)),
			code,
			status,
			message,
			raw,
		};
	}

	async reset(questionId: string): Promise<boolean> {
		const raw = await this.#getJson(this.#config.resetUrl, { question_id: questionId });
		const obj = record(raw) ?? {};
		return numberValue(obj.code) === 0;
	}

	async downloadAttachment(challenge: WqChallenge, workspace: string): Promise<string | undefined> {
		if (!challenge.fileUrl) return undefined;
		await fs.mkdir(workspace, { recursive: true });
		const url = new URL(challenge.fileUrl);
		const base = path.basename(url.pathname) || `challenge-${challenge.questionId}.bin`;
		const destination = path.join(workspace, base);
		try {
			await fs.access(destination);
			return destination;
		} catch {}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), Math.max(this.#config.timeoutMs, 30_000));
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error(`attachment HTTP ${response.status}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			await fs.writeFile(destination, bytes);
			return destination;
		} finally {
			clearTimeout(timer);
		}
	}
}
