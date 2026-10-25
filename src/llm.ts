// Hand-rolled OpenAI-compatible client (streaming + tool calls). No SDK, so any
// gateway that speaks the OpenAI chat-completions API works: OpenAI, OpenRouter,
// DeepSeek, Groq, LM Studio, Azure-style enterprise proxies, ...

import { mockMode } from "./config.ts";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LLMMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; toolCalls: ToolCall[] }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; message: string };

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function* streamChat(
  cfg: LLMConfig,
  messages: LLMMessage[],
  tools?: ToolSpec[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  if (mockMode()) {
    yield* mockChat(messages, tools);
    return;
  }
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
        ...extraHeaders(cfg),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
      }),
      signal,
    });
  } catch (err) {
    yield { type: "error", message: `Could not reach ${url}: ${(err as Error).message}` };
    return;
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    yield { type: "error", message: `Provider error ${res.status}: ${detail.slice(0, 400) || res.statusText}` };
    return;
  }
  yield* consumeSSE(res.body);
}

function extraHeaders(cfg: LLMConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cfg.baseUrl.includes("openrouter")) {
    headers["http-referer"] = "http://localhost:5188";
    headers["x-title"] = "Drongo";
  }
  return headers;
}

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export async function* consumeSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  const pending = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;

  function* handleLine(line: string): Generator<StreamEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: ChatChunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return; // keep-alives and partial lines are ignored
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (delta.content) yield { type: "delta", text: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        const cur = pending.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        pending.set(tc.index, cur);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        yield* handleLine(line);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) yield* handleLine(buf);
  } finally {
    reader.releaseLock();
  }

  const toolCalls = [...pending.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args || "{}" },
    }));
  if (toolCalls.length) yield { type: "tool_calls", toolCalls };
  yield { type: "done", finishReason };
}

// ---------------------------------------------------------------------------
// Mock provider for development and tests (DRONGO_MOCK=1). Scripted turns
// keyed on which phase tools are offered, so the whole loop can be exercised
// with no API key and no network.
// ---------------------------------------------------------------------------

async function* mockChat(messages: LLMMessage[], tools?: ToolSpec[]): AsyncGenerator<StreamEvent> {
  const names = new Set((tools ?? []).map((t) => t.function.name));
  const system = messages.find((m) => m.role === "system")?.content ?? "";

  async function* say(text: string): AsyncGenerator<StreamEvent> {
    for (const piece of text.match(/.{1,28}(\s|$)/g) ?? [text]) {
      yield { type: "delta", text: piece };
      await new Promise((r) => setTimeout(r, 6));
    }
  }

  // Keyed on record_assessment (measure-only): update_plan is also offered in
  // the teach phase, so it can no longer identify the measure phase.
  if (names.has("record_assessment")) {
    yield* say(
      "I've probed the edge of your understanding. You have a solid base with a few clear gaps — let me record that and lay out a plan.",
    );
    yield {
      type: "tool_calls",
      toolCalls: [
        {
          id: "mock_a",
          type: "function",
          function: {
            name: "record_assessment",
            arguments: JSON.stringify({
              solid: ["Comfortable with the basics from probing"],
              gaps: ["One prerequisite is shaky"],
              notes: "Mock assessment",
            }),
          },
        },
        {
          id: "mock_b",
          type: "function",
          function: {
            name: "update_plan",
            arguments: JSON.stringify({
              steps: [
                { title: "Step 1: Foundations", description: "Mock step one" },
                { title: "Step 2: Mechanism", description: "Mock step two" },
                { title: "Step 3: Application", description: "Mock step three" },
              ],
            }),
          },
        },
      ],
    };
    yield { type: "done", finishReason: "tool_calls" };
    return;
  }

  if (names.has("save_propositions")) {
    yield* say(
      "Good prediction — mostly right, with one correction. Here is the mechanism from first principles. (mock explanation)",
    );
    const stepId = /step_[a-z0-9_]+/i.exec(system)?.[0] ?? "step_1";
    yield {
      type: "tool_calls",
      toolCalls: [
        {
          id: "mock_c",
          type: "function",
          function: {
            name: "save_propositions",
            arguments: JSON.stringify({
              propositions: [
                { text: "Mock proposition A demonstrated in teaching" },
                {
                  text: "Mock proposition B builds on A",
                  prereqTexts: ["Mock proposition A demonstrated in teaching"],
                },
              ],
            }),
          },
        },
        { id: "mock_d", type: "function", function: { name: "mark_step_done", arguments: JSON.stringify({ stepId }) } },
      ],
    };
    yield { type: "done", finishReason: "tool_calls" };
    return;
  }

  if (names.has("schedule_review")) {
    const alreadyReviewed = messages.some(
      (m) => m.role === "tool" && /→ due \d{4}-\d{2}-\d{2}/.test(m.content ?? ""),
    );
    if (alreadyReviewed) {
      yield* say("That's the workout — nice recall. Summary: strongest on the fundamentals, keep revisiting the edge cases.");
      yield { type: "done", finishReason: "stop" };
      return;
    }
    yield* say("Problem 1 (mock): explain the core idea in your own words... Grading that as a pass. Logging the review.");
    const ids = [...system.matchAll(/p_[a-z0-9]+/gi)].map((m) => m[0]);
    const results = ids.slice(0, 2).map((id) => ({ propositionId: id, passed: true }));
    yield {
      type: "tool_calls",
      toolCalls: [
        { id: "mock_e", type: "function", function: { name: "schedule_review", arguments: JSON.stringify({ results }) } },
      ],
    };
    yield { type: "done", finishReason: "tool_calls" };
    return;
  }

  yield* say("Session complete. Ask me anything about what you learned, or start a new topic from the dashboard.");
  yield { type: "done", finishReason: "stop" };
}
