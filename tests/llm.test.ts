import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeSSE, normalizeBaseUrl } from "../src/llm.ts";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

test("normalizeBaseUrl strips trailing slashes", () => {
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1");
  assert.equal(normalizeBaseUrl(" http://localhost:1234/v1 "), "http://localhost:1234/v1");
});

test("consumeSSE parses deltas, split tool calls and finish reason", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" wor"}}]}\n',
    'data: {"choices":[{"delta":{"content":"ld"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_","arguments":""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"{\\"city\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const events: import("../src/llm.ts").StreamEvent[] = [];
  for await (const ev of consumeSSE(sseStream(chunks))) events.push(ev);

  const deltas = events.filter((e) => e.type === "delta");
  assert.equal(deltas.map((e) => e.text).join(""), "Hello world");

  const toolEvents = events.filter((e): e is Extract<(typeof events)[number], { type: "tool_calls" }> => e.type === "tool_calls");
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].toolCalls.length, 1);
  assert.equal(toolEvents[0].toolCalls[0].id, "c1");
  assert.equal(toolEvents[0].toolCalls[0].function.name, "get_weather");
  assert.equal(toolEvents[0].toolCalls[0].function.arguments, '{"city":');

  const done = events.find((e): e is Extract<(typeof events)[number], { type: "done" }> => e.type === "done")!;
  assert.equal(done.finishReason, "tool_calls");
});

test("consumeSSE handles chunk boundaries mid-line and multiple tool calls", async () => {
  // split one JSON payload across three arbitrary byte chunks
  const payload = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"f","arguments":"1"}},{"index":1,"id":"b","function":{"name":"g","arguments":"2"}}]}}]}\n\n';
  const enc = new TextEncoder();
  const bytes = enc.encode(payload);
  const third = Math.ceil(bytes.length / 3);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, third));
      controller.enqueue(bytes.slice(third, 2 * third));
      controller.enqueue(bytes.slice(2 * third));
      controller.close();
    },
  });
  const events: import("../src/llm.ts").StreamEvent[] = [];
  for await (const ev of consumeSSE(stream)) events.push(ev);
  const toolEvents = events.filter((e): e is Extract<(typeof events)[number], { type: "tool_calls" }> => e.type === "tool_calls");
  assert.equal(toolEvents.length, 1);
  assert.deepEqual(
    toolEvents[0].toolCalls.map((t) => [t.function.name, t.function.arguments]),
    [
      ["f", "1"],
      ["g", "2"],
    ],
  );
});
