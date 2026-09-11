import { afterEach, describe, expect, it } from "bun:test";
import { resolveWqPreset, wqRuntimeOverrides } from "@oh-my-pi/pi-coding-agent/wq/preset";

const previousProvider = process.env.WANWANDEQU_PROVIDER;
afterEach(() => {
	if (previousProvider === undefined) delete process.env.WANWANDEQU_PROVIDER;
	else process.env.WANWANDEQU_PROVIDER = previousProvider;
});

describe("WQ competition presets", () => {
	it("keeps turbo bounded but highly parallel", () => {
		delete process.env.WANWANDEQU_PROVIDER;
		const preset = resolveWqPreset("turbo");
		const overrides = wqRuntimeOverrides(preset);
		expect(preset.activeChallenges).toBe(4);
		expect(overrides["task.maxConcurrency"]).toBe(4);
		expect(overrides["task.maxRecursionDepth"]).toBe(2);
		expect(overrides["task.batch"]).toBe(true);
		expect(overrides["task.enableEffort"]).toBe(true);
		expect(overrides["retry.modelFallback"]).toBe(false);
		expect(overrides["model.toolCallLoopGuard.exemptTools"]).toEqual(["hub"]);
		expect(overrides.enabledModels).toEqual(["deepseek/deepseek-v4-flash"]);
		const roles = overrides.modelRoles as Record<string, string>;
		for (const role of ["default", "smol", "slow", "vision", "plan", "commit", "tiny", "task", "advisor"]) {
			expect(roles[role]).toBe("deepseek/deepseek-v4-flash");
		}
	});

	it("allows only the transport provider to change", () => {
		process.env.WANWANDEQU_PROVIDER = "organizer";
		const overrides = wqRuntimeOverrides(resolveWqPreset("safe"));
		expect(overrides.enabledModels).toEqual(["organizer/deepseek-v4-flash"]);
		expect((overrides.modelRoles as Record<string, string>).task).toBe("organizer/deepseek-v4-flash");
		expect(overrides["retry.modelFallback"]).toBe(false);
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
