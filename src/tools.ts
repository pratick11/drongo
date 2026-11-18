import path from "node:path";
import type { ToolSpec } from "./llm.ts";
import type { AppConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { WORLD_TOOLS } from "./world.ts";

// The harness's tool registry. Today it holds only the world tools (bash,
// file edits) jailed to a per-conversation workspace; the blog and digest tools
// join them here. Every mutation lands in plain files the learner can read and
// edit.

export interface ToolContext {
  dataDir: string;
  workspaceDir?: string;
  cfg?: AppConfig;
}

// What tools actually execute against: optional fields resolved by executeTool.
interface ResolvedContext extends ToolContext {
  workspaceDir: string;
  cfg: AppConfig;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ResolvedContext): string | Promise<string>;
}

const TOOLS: ToolDef[] = [...WORLD_TOOLS];

function toSpec(tool: ToolDef): ToolSpec {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

export function allTools(): ToolSpec[] {
  return TOOLS.map(toSpec);
}

export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<{ ok: boolean; output: string }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, output: `Unknown tool "${name}".` };
  // World tools execute against a per-conversation workspace unless the caller
  // provides one; config comes from disk when not handed in.
  const resolved: ResolvedContext = {
    ...ctx,
    workspaceDir: ctx.workspaceDir ?? path.join(ctx.dataDir, "workspaces", "scratch"),
    cfg: ctx.cfg ?? loadConfig(ctx.dataDir),
  };
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return { ok: false, output: `Arguments were not valid JSON: ${argsJson.slice(0, 200)}` };
  }
  try {
    return { ok: true, output: await tool.execute(args, resolved) };
  } catch (err) {
    return { ok: false, output: `Tool "${name}" failed: ${(err as Error).message}` };
  }
}
