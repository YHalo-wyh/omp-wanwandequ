import { describe, expect, it } from "bun:test";
import { parseWqResult } from "@oh-my-pi/pi-coding-agent/wq/system";

describe("WQ result contract", () => {
	it("parses a grounded solved result", () => {
		const flag = "flag{native_omp_search}";
		const result = parseWqResult(
			`noise\n<WQ_RESULT>{"status":"solved","flag":"${flag}","evidence":["solver.py stdout => ${flag}"],"facts":["check inverted"],"rejected":[],"artifacts":["solver.py"],"handoff":"done","request_reset":false}</WQ_RESULT>`,
		);
		expect(result?.status).toBe("solved");
		expect(result?.flag).toBe(flag);
		expect(result?.evidence[0]).toContain(flag);
	});

	it("uses the last result block after a model self-correction", () => {
		const result = parseWqResult(
			'<WQ_RESULT>{"status":"partial","flag":"","evidence":[],"facts":[],"rejected":[],"artifacts":[],"handoff":"old","request_reset":false}</WQ_RESULT>\n' +
				'<WQ_RESULT>{"status":"blocked","flag":"","evidence":[],"facts":[],"rejected":[],"artifacts":[],"handoff":"new","request_reset":true}</WQ_RESULT>',
		);
		expect(result?.status).toBe("blocked");
		expect(result?.handoff).toBe("new");
		expect(result?.request_reset).toBe(true);
	});

	it("rejects malformed blocks", () => {
		expect(parseWqResult("<WQ_RESULT>not-json</WQ_RESULT>")).toBeUndefined();
		expect(parseWqResult('{"status":"solved"}')).toBeUndefined();
	});
});
