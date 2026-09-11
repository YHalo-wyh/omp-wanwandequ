import { describe, expect, test } from "bun:test";
import {
  RuntimeRpcFrameDecoder,
  assistantTextFromFrame,
  contextFromState,
  parseRpcFrame,
  toolEventFromFrame,
} from "./runtime-protocol";

function base64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function chunkFrame(value: object, chunkBytes = 256 * 1024): string[] {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const count = Math.ceil(bytes.byteLength / chunkBytes);
  return Array.from({ length: count }, (_, index) => JSON.stringify({
    type: "rpc_chunk",
    chunkId: "test-chunk",
    index,
    count,
    byteLength: bytes.byteLength,
    data: base64(bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes)),
  }));
}

describe("Studio OMP RPC adapter", () => {
  test("parses JSONL and extracts assistant text", () => {
    const frame = parseRpcFrame(JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "flag found" }] },
    }));
    expect(frame).not.toBeNull();
    expect(assistantTextFromFrame(frame!)).toBe("flag found");
  });

  test("reads structured context usage", () => {
    expect(contextFromState({ contextUsage: { tokens: 7200 }, model: { contextWindow: 10000 } })).toEqual({
      used: 7200,
      limit: 10000,
      percent: 72,
    });
  });

  test("maps tool execution lifecycle without terminal text scraping", () => {
    const start = toolEventFromFrame({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "file ./chall" },
    });
    const end = toolEventFromFrame({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: { isError: false },
    });
    expect(start?.key).toBe("call-1");
    expect(start?.status).toBe("运行");
    expect(end?.status).toBe("完成");
  });

  test("reassembles native protocol v2 rpc_chunk frames", () => {
    const longText = `前缀-${"x".repeat(1024 * 1024 + 8192)}-后缀`;
    const logical = {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: longText }] },
    };
    const lines = chunkFrame(logical);
    expect(lines.length).toBeGreaterThan(1);

    const decoder = new RuntimeRpcFrameDecoder();
    let decoded = null;
    for (const line of lines) decoded = decoder.pushLine(line) ?? decoded;
    expect(decoded).not.toBeNull();
    expect(assistantTextFromFrame(decoded!)).toBe(longText);
  });

  test("fails closed when a chunk sequence is interrupted", () => {
    const logical = { type: "notice", message: "x".repeat(1024 * 1024 + 4096) };
    const lines = chunkFrame(logical);
    const decoder = new RuntimeRpcFrameDecoder();
    expect(decoder.pushLine(lines[0]!)).toBeNull();
    expect(() => decoder.pushLine(JSON.stringify({ type: "notice", message: "interrupt" }))).toThrow("中断");
  });
});
