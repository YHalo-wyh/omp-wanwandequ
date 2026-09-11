import type { SettingPath } from "../config/settings";

export type WqPresetName = "safe" | "turbo" | "max";

export interface WqPreset {
	name: WqPresetName;
	/** Number of challenge parent sessions the controller may keep active. */
	activeChallenges: number;
	/** OMP task/workpool lanes available inside one challenge parent. */
	innerConcurrency: number;
	/** Hard wall-clock budget for one fresh challenge visit. */
	visitSeconds: number;
	/** No-progress window after which a visit should be replaced by a fresh context. */
	stallSeconds: number;
	/** Minimum free system memory ratio before launching another challenge parent. */
	minFreeMemoryRatio: number;
}

const PRESETS: Record<WqPresetName, WqPreset> = {
	safe: {
		name: "safe",
		activeChallenges: 2,
		innerConcurrency: 2,
		visitSeconds: 240,
		stallSeconds: 120,
		minFreeMemoryRatio: 0.16,
	},
	turbo: {
		name: "turbo",
		activeChallenges: 4,
		innerConcurrency: 4,
		visitSeconds: 300,
		stallSeconds: 90,
		minFreeMemoryRatio: 0.12,
	},
	max: {
		name: "max",
		activeChallenges: 6,
		innerConcurrency: 6,
		visitSeconds: 330,
		stallSeconds: 70,
		minFreeMemoryRatio: 0.1,
	},
};

export function resolveWqPreset(value: string | undefined): WqPreset {
	const name = (value ?? "turbo").trim().toLowerCase() as WqPresetName;
	const preset = PRESETS[name];
	if (!preset) {
		throw new Error(`Unknown WQ preset "${value}". Expected safe, turbo, or max.`);
	}
	return { ...preset };
}

/**
 * Runtime-only OMP overrides for a WQ challenge session.
 *
 * These are passed through Settings.init({ overrides }) and are never persisted
 * to the user's normal config. Provider/model/auth/MCP discovery therefore stays
 * exactly the same as normal OMP while the competition process gets an aggressive
 * but bounded search policy.
 */
export function wqRuntimeOverrides(
	preset: WqPreset,
	options: { advisor?: boolean; innerConcurrency?: number } = {},
): Partial<Record<SettingPath, unknown>> {
	const inner = Math.max(1, Math.floor(options.innerConcurrency ?? preset.innerConcurrency));
	return {
		"task.batch": true,
		"task.maxConcurrency": inner,
		"task.maxRecursionDepth": 2,
		"task.enableEffort": true,
		"task.maxRuntimeMs": Math.max(60_000, preset.visitSeconds * 1000 - 15_000),
		"task.softRequestBudget": 120,
		"task.softRequestBudgetNotice": true,
		"async.enabled": true,
		"async.maxJobs": Math.max(inner * 2, 8),
		"bash.autoBackground.enabled": true,
		"eval.autoBackground.enabled": true,
		"compaction.enabled": true,
		"compaction.asyncEnabled": true,
		"compaction.thresholdPercent": 72,
		"compaction.methodOrder": ["shake", "handoff", "soft"],
		"model.toolCallLoopGuard.enabled": true,
		"model.toolCallLoopGuard.threshold": 3,
		"model.toolCallLoopGuard.exemptTools": ["hub"],
		"advisor.enabled": options.advisor === true,
		"retry.enabled": true,
		"retry.maxRetries": 4,
		"retry.baseDelayMs": 400,
		"retry.maxDelayMs": 12_000,
		// The competition requires one organizer-selected model. Never silently
		// escape to a different configured model after a transient provider error.
		"retry.modelFallback": false,
	};
}

export function listWqPresets(): WqPreset[] {
	return (Object.keys(PRESETS) as WqPresetName[]).map(name => ({ ...PRESETS[name] }));
}
