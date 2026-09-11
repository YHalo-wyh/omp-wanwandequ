import { describe, expect, test } from "bun:test";
import { assistantTextFromFrame, contextFromState, parseRpcFrame, toolEventFromFrame } from "./runtime-protocol";

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
});
