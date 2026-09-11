import { describe, expect, it } from "bun:test";
import { normalizeChallenge, normalizeChallengeList } from "@oh-my-pi/pi-coding-agent/wq/platform";

describe("WQ platform normalization", () => {
	it("does not treat string false as truthy", () => {
		const challenge = normalizeChallenge({
			question_id: "42",
			title: "static reverse",
			category: "REVERSE",
			interactive: "false",
			file_url: "https://example.invalid/a.zip",
			connection: [],
		});
		expect(challenge?.interactive).toBe(false);
		expect(challenge?.category).toBe("reverse");
		expect(challenge?.target).toBe("");
	});

	it("extracts nc and web container targets without assuming one shape", () => {
		const pwn = normalizeChallenge({
			question_id: 1,
			interactive: "true",
			connection: { docker_url: "nc 127.0.0.1 31337", docker_ip: "127.0.0.1", docker_port: 31337 },
		});
		const web = normalizeChallenge({
			question_id: 2,
			interactive: "true",
			connection: { docker_url: "challenge.example:80" },
		});
		expect(pwn?.target).toBe("nc 127.0.0.1 31337");
		expect(web?.target).toBe("challenge.example:80");
	});

	it("accepts nested list envelopes", () => {
		const list = normalizeChallengeList({ data: { list: [{ question_id: "a" }, { question_id: "b" }] } });
		expect(list.map(item => item.questionId)).toEqual(["a", "b"]);
	});
});
