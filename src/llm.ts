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
// Mock provider for development (DRONGO_MOCK=1): one scripted reply, no
// network. The digest/unit script arrives with those tools.
// ---------------------------------------------------------------------------

async function* mockChat(_messages: LLMMessage[], _tools?: ToolSpec[]): AsyncGenerator<StreamEvent> {
  yield { type: "delta", text: "Mock provider — no network calls are being made." };
  yield { type: "done", finishReason: "stop" };
}
