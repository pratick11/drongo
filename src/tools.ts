import type { ToolSpec } from "./llm.ts";
import type { Phase, PlanStep, Session } from "./session.ts";
import { nextOpenStep, REPAIR_CAP, saveSession } from "./session.ts";
import { addPropositions, findPropositions, loadGraph, saveGraph, upsertTopic } from "./graph.ts";
import { applyReview } from "./schedule.ts";

// The harness's tool registry. The LLM can only touch memory through these —
// every mutation lands in plain files the learner can read and edit.

export interface ToolContext {
  dataDir: string;
  session: Session;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  phases: Phase[];
  execute(args: Record<string, unknown>, ctx: ToolContext): string | Promise<string>;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

const TOOLS: ToolDef[] = [
  {
    name: "read_memory",
    description:
      "Search the learner's knowledge graph of verified propositions. Returns lines of: id | text | builds-on ids.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to match against proposition texts. Empty or omitted returns everything." },
      },
    },
    phases: ["measure", "teach", "practice", "done"],
    execute(args, ctx) {
      const graph = loadGraph(ctx.dataDir);
      const props = findPropositions(graph, str(args.query)).slice(0, 100);
      const lines = props.map(
        (p) => `${p.id} | ${p.text}${p.prereqs.length ? ` | builds on: ${p.prereqs.join(", ")}` : ""}`,
      );
      return lines.join("\n") || "No matching propositions.";
    },
  },
  {
    name: "record_assessment",
    description:
      "Record the measure-phase verdict: what the learner verifiably holds (solid), which prerequisites are missing or broken (gaps), and notes on their reasoning style.",
    parameters: {
      type: "object",
      properties: {
        solid: { type: "array", items: { type: "string" }, description: "Prerequisite ideas the learner demonstrably holds." },
        gaps: { type: "array", items: { type: "string" }, description: "Missing or broken prerequisite ideas." },
        notes: { type: "string", description: "Observations about how the learner reasons." },
      },
      required: ["solid", "gaps"],
    },
    phases: ["measure"],
    execute(args, ctx) {
      const s = ctx.session;
      s.assessment = {
        solid: strArray(args.solid),
        gaps: strArray(args.gaps),
        notes: str(args.notes),
        at: new Date().toISOString(),
      };
      saveSession(s, ctx.dataDir);
      return "Assessment recorded. Now call update_plan with steps that start just past the solid base and end at the goal.";
    },
  },
  {
    name: "update_plan",
    description:
      "Create the dependency-ordered teaching plan for this topic (3-8 steps, first step just past the measured base, last step is the goal). In the measure phase this creates the plan and switches to teach. In the teach phase it REVISES the plan: completed steps are frozen — they must all stay, in order, and are kept verbatim; carry an open step's id to keep it (editing its text resets its repair count), omit the id for new steps.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Existing open step id to carry over. Omit for a new step; never invent ids." },
              title: { type: "string", description: "Concept name, e.g. 'Rotations as local surgery'." },
              description: { type: "string", description: "What understanding must be reached in this step." },
            },
            required: ["title", "description"],
          },
        },
        reason: { type: "string", description: "Teach-phase revisions only: one line on why the plan changes. Recorded in the decision log." },
      },
      required: ["steps"],
    },
    phases: ["measure", "teach"],
    execute(args, ctx) {
      const s = ctx.session;
      const raw = Array.isArray(args.steps) ? args.steps : [];

      if (s.phase === "teach") return revisePlan(s, raw, str(args.reason), ctx.dataDir);

      const steps = raw.slice(0, 12).map((st: unknown, i: number) => {
        const obj = (st ?? {}) as Record<string, unknown>;
        return {
          id: `step_${i + 1}`,
          title: str(obj.title, `Step ${i + 1}`),
          description: str(obj.description),
          doneAt: null,
          attemptCount: 0,
          blockedAt: null,
        };
      });
      if (steps.length < 2) return "A plan needs at least 2 steps. Call update_plan again with more steps.";
      s.plan = { steps };
      s.phase = "teach";
      s.currentStepId = steps[0].id;
      const graph = loadGraph(ctx.dataDir);
      upsertTopic(graph, s.topicName, s.goal);
      saveGraph(graph, ctx.dataDir);
      saveSession(s, ctx.dataDir);
      return `Plan saved with ${steps.length} steps; the session is now in the teach phase. Current step: ${steps[0].id} — ${steps[0].title}. Ask for the learner's prediction on it now.`;
    },
  },
  {
    name: "save_propositions",
    description:
      "Persist propositions the learner has demonstrated in verification — single claims they now hold. Each claim must be one the learner could demonstrate on a small concrete example, not one they merely agreed with. prereqTexts must quote texts of propositions this builds on (existing ones or earlier entries in this same call).",
    parameters: {
      type: "object",
      properties: {
        propositions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "One crisp claim, phrased so it can be recalled and checked later." },
              prereqTexts: { type: "array", items: { type: "string" }, description: "Texts of supporting propositions." },
            },
            required: ["text"],
          },
        },
      },
      required: ["propositions"],
    },
    phases: ["teach"],
    execute(args, ctx) {
      const graph = loadGraph(ctx.dataDir);
      const inputs = Array.isArray(args.propositions) ? (args.propositions as never[]) : [];
      const { added, skipped } = addPropositions(graph, ctx.session.topicId, ctx.session.id, inputs);
      saveGraph(graph, ctx.dataDir);
      const ids = added.map((p) => p.id).join(", ");
      return `Saved ${added.length} proposition(s): ${ids || "none"}.${skipped.length ? ` Skipped ${skipped.length} duplicate(s).` : ""}`;
    },
  },
  {
    name: "mark_step_done",
    description:
      "Mark the current plan step as completed and move to the next one. Only call this after a verification has passed.",
    parameters: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Id of the completed step, e.g. step_2." },
      },
      required: ["stepId"],
    },
    phases: ["teach"],
    execute(args, ctx) {
      const s = ctx.session;
      if (!s.plan) return "No plan exists yet.";
      const stepId = str(args.stepId);
      const step = s.plan.steps.find((x) => x.id === stepId);
      if (!step) return `Unknown stepId "${stepId}". Valid ids: ${s.plan.steps.map((x) => x.id).join(", ")}`;
      if (step.doneAt) return `Step ${step.id} is already done.`;
      step.doneAt = new Date().toISOString();
      step.blockedAt = null;
      s.moves.push({ at: step.doneAt, stepId: step.id, move: "promote", note: "" });
      const next = nextOpenStep(s.plan);
      s.currentStepId = next?.id ?? null;
      let tail = "";
      if (!next) {
        s.phase = "done";
        const graph = loadGraph(ctx.dataDir);
        const topic = graph.topics.find((t) => t.id === s.topicId);
        if (topic) topic.active = false;
        saveGraph(graph, ctx.dataDir);
        tail = " That was the final step — the plan is complete. Close with a short summary of what the learner now holds.";
      } else {
        tail = ` Next step: ${next.id} — ${next.title}.`;
      }
      saveSession(s, ctx.dataDir);
      return `Step ${step.id} marked done.${tail}`;
    },
  },
  {
    name: "report_move",
    description:
      'Record a decision-point move after a failed verification on a plan step. move="repair": you will re-teach this step differently — the harness counts repairs and refuses beyond the cap. move="block": the step is genuinely stuck — mark it blocked and record it as a gap. (Promote is mark_step_done; refill is update_plan in the teach phase.)',
    parameters: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Id of the step this move concerns, e.g. step_2." },
        move: { type: "string", enum: ["repair", "block"] },
        note: {
          type: "string",
          description: 'repair: what is different AND more concrete about this attempt. block: what exactly is blocking.',
        },
      },
      required: ["stepId", "move", "note"],
    },
    phases: ["teach"],
    execute(args, ctx) {
      const s = ctx.session;
      if (!s.plan) return "No plan exists yet.";
      const step = s.plan.steps.find((x) => x.id === str(args.stepId));
      if (!step) return `Unknown stepId "${str(args.stepId)}". Valid ids: ${s.plan.steps.map((x) => x.id).join(", ")}`;
      if (step.doneAt) return `Step ${step.id} is already done — pick another open step.`;
      const move = str(args.move);
      const note = str(args.note);
      const now = new Date().toISOString();
      if (move === "repair") {
        if (step.attemptCount >= REPAIR_CAP) {
          return `Repair cap reached for ${step.id} (${REPAIR_CAP} repairs). Remaining moves: refill — revise the plan with update_plan (split the step, insert a missing concrete sub-step) — or block the step with report_move move="block".`;
        }
        step.attemptCount++;
        s.moves.push({ at: now, stepId: step.id, move: "repair", note });
        saveSession(s, ctx.dataDir);
        const left = REPAIR_CAP - step.attemptCount;
        return left
          ? `Repair ${step.attemptCount}/${REPAIR_CAP} logged for ${step.id}. Re-teach differently — smaller or more concrete, never more abstract. ${left} repair(s) left after this one.`
          : `Repair ${step.attemptCount}/${REPAIR_CAP} logged for ${step.id}. This is the final repair: if verification fails again, refill (update_plan) or block.`;
      }
      if (move === "block") {
        step.blockedAt = now;
        if (s.assessment && !s.assessment.gaps.includes(step.title)) s.assessment.gaps.push(step.title);
        s.moves.push({ at: now, stepId: step.id, move: "block", note });
        saveSession(s, ctx.dataDir);
        return `Step ${step.id} marked blocked and recorded as a gap. Tell the learner plainly what is blocking and what to do next. A blocked step only reopens through a plan revision.`;
      }
      return `Unknown move "${move}". Use "repair" or "block" (promote is mark_step_done; refill is update_plan).`;
    },
  },
  {
    name: "schedule_review",
    description:
      "Record practice results. For every proposition the answer actually exercised, report its id and whether the learner produced it unprompted and correctly.",
    parameters: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              propositionId: { type: "string" },
              passed: { type: "boolean" },
            },
            required: ["propositionId", "passed"],
          },
        },
      },
      required: ["results"],
    },
    phases: ["practice"],
    execute(args, ctx) {
      const graph = loadGraph(ctx.dataDir);
      const lines: string[] = [];
      const results = Array.isArray(args.results) ? (args.results as Record<string, unknown>[]) : [];
      for (const r of results) {
        const prop = graph.propositions.find((p) => p.id === str(r.propositionId));
        if (!prop) {
          lines.push(`${str(r.propositionId)}: not found`);
          continue;
        }
        const passed = r.passed === true;
        applyReview(prop, passed);
        lines.push(`${prop.id}: ${passed ? "pass" : "fail"} → due ${prop.dueAt.slice(0, 10)}`);
      }
      saveGraph(graph, ctx.dataDir);
      return lines.join("\n") || "No results provided.";
    },
  },
];

// Teach-phase update_plan: revise the open frontier of the plan. Completed
// steps are frozen — they must all stay, in their order, verbatim. Carrying an
// open step's id unchanged keeps its repair count; editing its text re-poses
// the question, so the count resets.
function revisePlan(s: Session, raw: unknown[], reason: string, dataDir: string): string {
  if (!s.plan) return "No plan exists to revise.";
  const current = s.plan.steps;
  const done = current.filter((st) => st.doneAt);
  const byId = new Map(current.map((st) => [st.id, st] as const));
  const maxNum = current.reduce((m, st) => Math.max(m, Number(/^step_(\d+)$/.exec(st.id)?.[1] ?? 0)), 0);
  let nextNum = maxNum + 1;
  const seen = new Set<string>();
  const revised: PlanStep[] = [];
  const frozenKept: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const obj = (raw[i] ?? {}) as Record<string, unknown>;
    const id = str(obj.id);
    const title = str(obj.title, `Step ${i + 1}`);
    const description = str(obj.description);
    if (!id) {
      revised.push({ id: `step_${nextNum++}`, title, description, doneAt: null, attemptCount: 0, blockedAt: null });
      continue;
    }
    if (seen.has(id)) return `Step ${id} appears twice in the revision.`;
    seen.add(id);
    const old = byId.get(id);
    if (!old) return `Unknown step id "${id}". Valid ids: ${current.map((x) => x.id).join(", ")}`;
    if (old.doneAt) {
      revised.push(old); // frozen: kept verbatim, provided edits ignored
      frozenKept.push(old.id);
      continue;
    }
    const changed = title !== old.title || description !== old.description;
    revised.push({
      id: old.id,
      title,
      description,
      doneAt: null,
      attemptCount: changed ? 0 : old.attemptCount,
      blockedAt: changed ? null : old.blockedAt,
    });
  }

  if (revised.length < 2) return "A plan needs at least 2 steps.";
  const revisedDone = revised.filter((st) => st.doneAt);
  const keepsDoneOrder =
    revisedDone.length === done.length && done.every((d, i) => revisedDone[i]?.id === d.id);
  if (!keepsDoneOrder) {
    return `Every completed step must stay in the plan, in order — completed steps are frozen. Done steps: ${done.map((d) => d.id).join(", ")}.`;
  }

  s.plan = { steps: revised };
  s.moves.push({ at: new Date().toISOString(), stepId: s.currentStepId ?? revised[0].id, move: "refill", note: reason });
  const next = nextOpenStep(s.plan);
  s.currentStepId = next?.id ?? null;
  let tail = "";
  if (!next) {
    s.phase = "done";
    const graph = loadGraph(dataDir);
    const topic = graph.topics.find((t) => t.id === s.topicId);
    if (topic) topic.active = false;
    saveGraph(graph, dataDir);
    tail = " No open steps remain — the plan is complete.";
  } else {
    tail = ` Current step: ${next.id} — ${next.title}.`;
  }
  saveSession(s, dataDir);
  const frozen = frozenKept.length ? ` (frozen, kept verbatim: ${frozenKept.join(", ")})` : "";
  return `Plan revised to ${revised.length} steps${frozen}.${tail}`;
}

function toSpec(tool: ToolDef): ToolSpec {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

export function toolsForPhase(phase: Phase): ToolSpec[] {
  return TOOLS.filter((t) => t.phases.includes(phase)).map(toSpec);
}

export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<{ ok: boolean; output: string }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, output: `Unknown tool "${name}".` };
  if (!tool.phases.includes(ctx.session.phase)) {
    return { ok: false, output: `Tool "${name}" is not available in phase ${ctx.session.phase}.` };
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return { ok: false, output: `Arguments were not valid JSON: ${argsJson.slice(0, 200)}` };
  }
  try {
    return { ok: true, output: await tool.execute(args, ctx) };
  } catch (err) {
    return { ok: false, output: `Tool "${name}" failed: ${(err as Error).message}` };
  }
}
