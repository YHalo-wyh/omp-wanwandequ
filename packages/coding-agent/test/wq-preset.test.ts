import { describe, expect, it } from "bun:test";
import { resolveWqPreset, wqRuntimeOverrides } from "@oh-my-pi/pi-coding-agent/wq/preset";

describe("WQ competition presets", () => {
	it("keeps turbo bounded but highly parallel", () => {
		const preset = resolveWqPreset("turbo");
		const overrides = wqRuntimeOverrides(preset);
		expect(preset.activeChallenges).toBe(4);
		expect(overrides["task.maxConcurrency"]).toBe(4);
		expect(overrides["task.maxRecursionDepth"]).toBe(2);
		expect(overrides["task.batch"]).toBe(true);
		expect(overrides["task.enableEffort"]).toBe(true);
		expect(overrides["retry.modelFallback"]).toBe(false);
		expect(overrides["model.toolCallLoopGuard.exemptTools"]).toEqual(["hub"]);
	});

	it("max increases state-space coverage over turbo", () => {
		const turbo = resolveWqPreset("turbo");
		const maximum = resolveWqPreset("max");
		expect(maximum.activeChallenges).toBeGreaterThan(turbo.activeChallenges);
		expect(maximum.innerConcurrency).toBeGreaterThan(turbo.innerConcurrency);
		expect(maximum.stallSeconds).toBeLessThan(turbo.stallSeconds);
	});

	it("supports trial-only concurrency and advisor overrides", () => {
		const overrides = wqRuntimeOverrides(resolveWqPreset("safe"), { innerConcurrency: 7, advisor: true });
		expect(overrides["task.maxConcurrency"]).toBe(7);
		expect(overrides["advisor.enabled"]).toBe(true);
	});
});
