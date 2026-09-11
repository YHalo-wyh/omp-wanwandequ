export const WANWANDEQU_MODEL_ID = "deepseek-v4-flash";
export const WANWANDEQU_DEFAULT_PROVIDER = "deepseek";

/**
 * The competition handbook fixes the model family to DeepSeek V4 Flash.
 * The provider may be changed only to point at an organizer-supplied gateway;
 * the model id itself is intentionally not configurable.
 */
export function wanwandequProvider(): string {
	return process.env.WANWANDEQU_PROVIDER?.trim() || WANWANDEQU_DEFAULT_PROVIDER;
}

export function wanwandequModelSelector(): string {
	return `${wanwandequProvider()}/${WANWANDEQU_MODEL_ID}`;
}

export function wanwandequModelRoles(): Record<string, string> {
	const selector = wanwandequModelSelector();
	return {
		default: selector,
		smol: selector,
		slow: selector,
		vision: selector,
		plan: selector,
		commit: selector,
		tiny: selector,
		task: selector,
		advisor: selector,
	};
}
