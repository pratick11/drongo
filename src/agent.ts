import type { AppConfig } from "./config.ts";
import { streamChat, type LLMMessage, type ToolCall } from "./llm.ts";
import { systemPrompt } from "./prompts.ts";
import { loadGraph } from "./graph.ts";
import { saveSession, type Phase, type Session } from "./session.ts";
import { executeTool, toolsForPhase } from "./tools.ts";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean; output: string }
  | { type: "phase"; phase: Phase }
  | { type: "step"; stepId: string | null }
  | { type: "error"; message: string };

const MAX_ROUNDS = 8;

// Runs one user turn: model calls (streamed to the client) interleaved with
// tool executions, until the model produces a reply without tool calls. The
// system prompt is rebuilt each round, so a phase flip mid-turn applies to the
// very next model call.
export async function runTurn(
  session: Session,
  opts: { dataDir: string; cfg: AppConfig },
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const { dataDir, cfg } = opts;
  let phaseAtStart = session.phase;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const graph = loadGraph(dataDir);
    const system: LLMMessage = { role: "system", content: systemPrompt(session, graph) };
    const messages: LLMMessage[] = [system, ...session.messages];
    const tools = toolsForPhase(session.phase);

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
      persistAssistant(session, text, dataDir);
      return;
    }

    if (toolCalls && toolCalls.length) {
      session.messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        emit({ type: "tool_start", name: call.function.name, args: safeParse(call.function.arguments) });
        const result = await executeTool(call.function.name, call.function.arguments, { dataDir, session });
        emit({ type: "tool_result", name: call.function.name, ok: result.ok, output: result.output });
        session.messages.push({ role: "tool", tool_call_id: call.id, content: result.output });
      }
      saveSession(session, dataDir);
      if (session.phase !== phaseAtStart) {
        phaseAtStart = session.phase;
        emit({ type: "phase", phase: session.phase });
        emit({ type: "step", stepId: session.currentStepId });
      }
      continue;
    }

    persistAssistant(session, text, dataDir);
    return;
  }

  emit({ type: "error", message: `Stopped after ${MAX_ROUNDS} tool rounds — possible tool loop.` });
}

function persistAssistant(session: Session, text: string, dataDir: string): void {
  if (text.trim()) session.messages.push({ role: "assistant", content: text });
  saveSession(session, dataDir);
}

function safeParse(args: string): unknown {
  try {
    return JSON.parse(args || "{}");
  } catch {
    return args;
  }
}
