import path from "node:path";
import type { AppConfig } from "./config.ts";
import { streamChat, type LLMMessage, type ToolCall } from "./llm.ts";
import { systemPrompt } from "./prompts.ts";
import { saveConversation, type Conversation } from "./session.ts";
import { allTools, executeTool } from "./tools.ts";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean; output: string }
  | { type: "error"; message: string };

// World tools (bash, file edits) mean a single step of real work can take
// several rounds — write the example, run it, fix it, run it again.
const MAX_ROUNDS = 16;

// Runs one user turn: model calls (streamed to the client) interleaved with
// tool executions, until the model produces a reply without tool calls. The
// system prompt is rebuilt each round, so a digest or unit saved mid-turn is
// visible to the very next model call.
export async function runTurn(
  conversation: Conversation,
  opts: { dataDir: string; cfg: AppConfig },
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const { dataDir, cfg } = opts;
  const workspaceDir = path.join(dataDir, "workspaces", conversation.id);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const system: LLMMessage = { role: "system", content: systemPrompt(conversation) };
    const messages: LLMMessage[] = [system, ...conversation.messages];
    const tools = allTools();

    let text = "";
    let toolCalls: ToolCall[] | null = null;
    let failed = false;
    for await (const ev of streamChat(cfg, messages, tools)) {
      if (ev.type === "delta") {
        text += ev.text;
        emit(ev);
      } else if (ev.type === "tool_calls") {
        toolCalls = ev.toolCalls;
      } else if (ev.type === "error") {
        emit(ev);
        failed = true;
        break;
      } else if (ev.type === "done") {
        break;
      }
    }
    if (failed) {
      persistAssistant(conversation, text, dataDir);
      return;
    }

    if (toolCalls && toolCalls.length) {
      conversation.messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        emit({ type: "tool_start", name: call.function.name, args: safeParse(call.function.arguments) });
        const result = await executeTool(call.function.name, call.function.arguments, { dataDir, workspaceDir, cfg });
        emit({ type: "tool_result", name: call.function.name, ok: result.ok, output: result.output });
        conversation.messages.push({ role: "tool", tool_call_id: call.id, content: result.output });
      }
      saveConversation(conversation, dataDir);
      continue;
    }

    persistAssistant(conversation, text, dataDir);
    return;
  }

  emit({ type: "error", message: `Stopped after ${MAX_ROUNDS} tool rounds — possible tool loop.` });
}

function persistAssistant(conversation: Conversation, text: string, dataDir: string): void {
  if (text.trim()) conversation.messages.push({ role: "assistant", content: text });
  saveConversation(conversation, dataDir);
}

function safeParse(args: string): unknown {
  try {
    return JSON.parse(args || "{}");
  } catch {
    return args;
  }
}
