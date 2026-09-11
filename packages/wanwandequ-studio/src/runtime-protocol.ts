export type RpcObject = Record<string, unknown> & { type?: string; id?: string };

export type RuntimeContext = {
  used: number | null;
  limit: number | null;
  percent: number | null;
};

export type RuntimeToolEvent = {
  key: string;
  name: string;
  summary: string;
  status: "运行" | "完成" | "失败";
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRpcFrame(line: string): RpcObject | null {
  try {
    const value = JSON.parse(line) as unknown;
    return isObject(value) ? (value as RpcObject) : null;
  } catch {
    return null;
  }
}

export function textFromMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isObject(value)) return "";
  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(part => {
      if (typeof part === "string") return part;
      if (!isObject(part)) return "";
      return part.type === "text" && typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("");
}

export function assistantTextFromFrame(frame: RpcObject): string {
  const message = isObject(frame.message) ? frame.message : isObject(frame.payload) ? frame.payload : undefined;
  if (!message) return "";
  return message.role === "assistant" ? textFromMessage(message) : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function contextFromState(state: unknown): RuntimeContext {
  if (!isObject(state)) return { used: null, limit: null, percent: null };
  const usage = isObject(state.contextUsage) ? state.contextUsage : {};
  const model = isObject(state.model) ? state.model : {};

  let used = firstNumber(usage, ["tokens", "used", "totalTokens", "total", "contextTokens", "promptTokens"]);
  let limit = firstNumber(usage, ["contextWindow", "limit", "maxTokens", "capacity"]);
  if (limit === null) limit = firstNumber(model, ["contextWindow", "context_window", "maxTokens"]);

  if (used === null) {
    const input = firstNumber(usage, ["input", "inputTokens", "prompt"]);
    const output = firstNumber(usage, ["output", "outputTokens", "completion"]);
    if (input !== null || output !== null) used = (input ?? 0) + (output ?? 0);
  }

  const percent = used !== null && limit !== null && limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null;
  return { used, limit, percent };
}

function compactJson(value: unknown, max = 220): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value).slice(0, max);
  }
}

export function toolEventFromFrame(frame: RpcObject): RuntimeToolEvent | null {
  if (!frame.type?.startsWith("tool_")) return null;
  if (!frame.type.startsWith("tool_execution_") && frame.type !== "tool_stream_update") return null;

  const toolCall = isObject(frame.toolCall) ? frame.toolCall : isObject(frame.tool) ? frame.tool : {};
  const key = String(frame.toolCallId ?? toolCall.id ?? frame.id ?? `${Date.now()}`);
  const name = String(frame.toolName ?? toolCall.name ?? frame.name ?? "OMP 工具");
  const summarySource = frame.args ?? frame.arguments ?? frame.input ?? toolCall.arguments ?? frame.result ?? frame.partialResult;
  const summary = compactJson(summarySource) || frame.type;
  const failed = frame.isError === true || (isObject(frame.result) && frame.result.isError === true);
  const status: RuntimeToolEvent["status"] = frame.type === "tool_execution_end" ? (failed ? "失败" : "完成") : "运行";
  return { key, name, summary, status };
}

export function responseData(frame: RpcObject, command: string): Record<string, unknown> | null {
  if (frame.type !== "response" || frame.command !== command || frame.success !== true || !isObject(frame.data)) return null;
  return frame.data;
}

export function rpcError(frame: RpcObject): string | null {
  if (frame.type !== "response" || frame.success !== false) return null;
  return typeof frame.error === "string" ? frame.error : "OMP RPC 请求失败";
}
