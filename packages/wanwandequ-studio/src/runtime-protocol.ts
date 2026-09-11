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

const MAX_RPC_FRAME_BYTES = 1024 * 1024;
const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;

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

type PendingChunks = {
  chunkId: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  receivedBytes: number;
  chunks: Uint8Array[];
};

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("RPC chunk data 不是合法 base64");
  }
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new Error("RPC chunk data 不是合法 base64");
  }
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

/**
 * Browser-side counterpart of OMP's RpcFrameDecoder.
 *
 * Protocol v1 frames pass through directly. After Studio negotiates protocol v2,
 * OMP may split a logical frame larger than 1 MiB into rpc_chunk JSONL lines;
 * this decoder validates ordering/length and returns only the fully reassembled
 * logical object. It intentionally fails closed on interrupted/mismatched chunk
 * sequences so a corrupted tool/message frame is never presented as valid state.
 */
export class RuntimeRpcFrameDecoder {
  #pending: PendingChunks | null = null;

  reset() {
    this.#pending = null;
  }

  pushLine(line: string): RpcObject | null {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("Runtime stdout 出现非 JSON RPC 帧");
    }
    if (!isObject(value)) throw new Error("RPC 帧必须是 JSON 对象");
    return this.push(value as RpcObject);
  }

  push(frame: RpcObject): RpcObject | null {
    if (frame.type !== "rpc_chunk") {
      if (this.#pending) {
        this.#pending = null;
        throw new Error("RPC chunk 序列被普通帧中断");
      }
      return frame;
    }

    const chunkId = typeof frame.chunkId === "string" ? frame.chunkId : "";
    const index = finiteInteger(frame.index);
    const count = finiteInteger(frame.count);
    const byteLength = finiteInteger(frame.byteLength);
    if (
      !chunkId || chunkId.length > 128 || index === null || count === null || byteLength === null ||
      index < 0 || count < 2 || index >= count ||
      count > Math.ceil(MAX_RPC_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES) ||
      byteLength < MAX_RPC_FRAME_BYTES || byteLength > MAX_RPC_REASSEMBLED_BYTES
    ) {
      this.#pending = null;
      throw new Error("RPC chunk 元数据非法");
    }

    const bytes = decodeBase64(frame.data);
    if (bytes.byteLength > RPC_CHUNK_PAYLOAD_BYTES) {
      this.#pending = null;
      throw new Error("RPC chunk 超过单块大小限制");
    }

    if (!this.#pending) {
      if (index !== 0) throw new Error("RPC chunk 序列必须从 0 开始");
      this.#pending = { chunkId, count, byteLength, nextIndex: 0, receivedBytes: 0, chunks: [] };
    }
    const pending = this.#pending;
    if (
      pending.chunkId !== chunkId || pending.count !== count || pending.byteLength !== byteLength || pending.nextIndex !== index
    ) {
      this.#pending = null;
      throw new Error("RPC chunk 序列不匹配");
    }

    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex += 1;
    if (pending.receivedBytes > pending.byteLength) {
      this.#pending = null;
      throw new Error("RPC chunk 实际长度超过声明长度");
    }
    if (pending.nextIndex < pending.count) return null;

    this.#pending = null;
    if (pending.receivedBytes !== pending.byteLength) throw new Error("RPC chunk 重组长度不一致");
    const merged = new Uint8Array(pending.byteLength);
    let offset = 0;
    for (const chunk of pending.chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
    } catch {
      throw new Error("RPC chunk 重组后不是合法 UTF-8");
    }
    const decoded = parseRpcFrame(text);
    if (!decoded) throw new Error("RPC chunk 重组后不是合法 JSON 对象");
    return decoded;
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
  const summarySource = frame.args ?? frame.arguments ?? frame.input ?? toolCall.arguments ?? frame.result ?? frame.partialResult ?? frame.update;
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
