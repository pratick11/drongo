import fs from "node:fs";
import path from "node:path";
import type { LLMMessage } from "./llm.ts";
import { newId, readJson, slugify, writeJsonAtomic } from "./fsutil.ts";

export type Phase = "measure" | "teach" | "done" | "practice";

// Repairs allowed per plan step before the harness forces refill or block.
export const REPAIR_CAP = 2;

export type MoveKind = "repair" | "refill" | "block" | "promote";

// Decision log: every teaching-loop move is durable and inspectable in the
// session file, so "why did the plan change" always has an answer.
export interface SessionMove {
  at: string;
  stepId: string;
  move: MoveKind;
  note: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  doneAt: string | null;
  attemptCount: number;
  blockedAt: string | null;
}

export interface Plan {
  steps: PlanStep[];
}

export interface Assessment {
  solid: string[];
  gaps: string[];
  notes: string;
  at: string;
}

export interface Session {
  id: string;
  mode: "learn" | "practice";
  topicId: string;
  topicName: string;
  goal: string;
  phase: Phase;
  plan: Plan | null;
  currentStepId: string | null;
  assessment: Assessment | null;
  practiceIds: string[];
  moves: SessionMove[];
  messages: LLMMessage[];
  createdAt: string;
  updatedAt: string;
}

export function sessionsDir(dataDir: string): string {
  return path.join(dataDir, "sessions");
}

export function sessionPath(id: string, dataDir: string): string {
  return path.join(sessionsDir(dataDir), `${id}.json`);
}

export interface CreateSessionInput {
  mode: "learn" | "practice";
  topicName: string;
  goal: string;
  practiceIds?: string[];
}

export function createSession(input: CreateSessionInput): Session {
  const now = new Date().toISOString();
  const session: Session = {
    id: `${now.slice(0, 10)}_${slugify(input.topicName)}_${newId("s").split("_")[1]}`,
    mode: input.mode,
    topicId: slugify(input.topicName),
    topicName: input.topicName.trim(),
    goal: input.goal.trim(),
    phase: input.mode === "practice" ? "practice" : "measure",
    plan: null,
    currentStepId: null,
    assessment: null,
    practiceIds: input.practiceIds ?? [],
    moves: [],
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  session.messages.push(
    session.mode === "learn"
      ? { role: "user", content: `I want to learn: ${session.topicName}. My goal: ${session.goal || "deep working understanding"}.` }
      : { role: "user", content: "Start my practice session." },
  );
  return session;
}

export function saveSession(session: Session, dataDir: string): void {
  session.updatedAt = new Date().toISOString();
  writeJsonAtomic(sessionPath(session.id, dataDir), session);
}

// Sessions from before the decision-log/repair-counter fields lack them; fill
// in defaults so the rest of the code can treat them as always present.
function hydrate(session: Session): Session {
  session.moves ??= [];
  if (session.plan) {
    for (const st of session.plan.steps) {
      st.attemptCount ??= 0;
      st.blockedAt ??= null;
    }
  }
  return session;
}

export function loadSession(id: string, dataDir: string): Session | null {
  if (!/^[\w.-]+$/.test(id)) return null; // id is used in a file path
  const s = readJson<Session | null>(sessionPath(id, dataDir), null);
  return s && s.id ? hydrate(s) : null;
}

export function listSessions(dataDir: string): Session[] {
  const dir = sessionsDir(dataDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Session[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const s = readJson<Session | null>(path.join(dir, name), null);
    if (s && s.id) out.push(hydrate(s));
  }
  return out.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  );
}

export function currentStep(session: Session): PlanStep | null {
  return session.plan?.steps.find((s) => s.id === session.currentStepId) ?? null;
}

export function nextOpenStep(plan: Plan): PlanStep | null {
  return plan.steps.find((s) => !s.doneAt) ?? null;
}
