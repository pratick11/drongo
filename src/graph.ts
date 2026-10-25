import path from "node:path";
import { newId, readJson, slugify, writeJsonAtomic } from "./fsutil.ts";
import { nextDue } from "./schedule.ts";

// The knowledge graph stores propositions — single claims the learner has
// demonstrated — plus prerequisite edges between them. Plain JSON on disk,
// mirrored to a human-readable graph.md export.

export interface Proposition {
  id: string;
  text: string;
  topicId: string;
  prereqs: string[];
  createdAt: string;
  sourceSessionId: string;
  reviewLevel: number;
  dueAt: string;
  lastReviewedAt: string | null;
  timesSeen: number;
  passes: number;
}

export interface Topic {
  id: string;
  name: string;
  goal: string;
  createdAt: string;
  active: boolean;
}

export interface Graph {
  version: 1;
  topics: Topic[];
  propositions: Proposition[];
}

export function emptyGraph(): Graph {
  return { version: 1, topics: [], propositions: [] };
}

export function graphPath(dataDir: string): string {
  return path.join(dataDir, "graph.json");
}

export function loadGraph(dataDir: string): Graph {
  const g = readJson<Graph>(graphPath(dataDir), emptyGraph());
  if (!Array.isArray(g.topics)) g.topics = [];
  if (!Array.isArray(g.propositions)) g.propositions = [];
  return g;
}

export function saveGraph(graph: Graph, dataDir: string): void {
  writeJsonAtomic(graphPath(dataDir), graph);
}

export function normText(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

export function upsertTopic(graph: Graph, name: string, goal: string): Topic {
  const id = slugify(name);
  let topic = graph.topics.find((t) => t.id === id);
  if (!topic) {
    topic = { id, name: name.trim(), goal, createdAt: new Date().toISOString(), active: true };
    graph.topics.push(topic);
  } else {
    topic.goal = goal || topic.goal;
    topic.active = true;
  }
  return topic;
}

export function findPropositions(graph: Graph, query: string): Proposition[] {
  const q = normText(query);
  if (!q) return graph.propositions;
  return graph.propositions.filter((p) => normText(p.text).includes(q));
}

export function duePropositions(graph: Graph, now: Date = new Date()): Proposition[] {
  return graph.propositions.filter((p) => new Date(p.dueAt).getTime() <= now.getTime());
}

function reachable(graph: Graph, startId: string, goalId: string): boolean {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === goalId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const prop = graph.propositions.find((p) => p.id === cur);
    if (prop) stack.push(...prop.prereqs);
  }
  return false;
}

export interface PropositionInput {
  text: string;
  prereqTexts?: string[];
}

export function addPropositions(
  graph: Graph,
  topicId: string,
  sessionId: string,
  inputs: PropositionInput[],
): { added: Proposition[]; skipped: string[] } {
  const created: Array<{ prop: Proposition; prereqTexts: string[] }> = [];
  const skipped: string[] = [];
  const byNorm = new Map(graph.propositions.map((p) => [normText(p.text), p] as const));

  for (const input of inputs) {
    const text = (input?.text ?? "").trim();
    if (!text) continue;
    const key = normText(text);
    if (byNorm.has(key)) {
      skipped.push(text);
      continue;
    }
    const prop: Proposition = {
      id: newId("p"),
      text,
      topicId,
      prereqs: [],
      createdAt: new Date().toISOString(),
      sourceSessionId: sessionId,
      reviewLevel: 0,
      dueAt: nextDue(0),
      lastReviewedAt: null,
      timesSeen: 0,
      passes: 0,
    };
    byNorm.set(key, prop);
    created.push({ prop, prereqTexts: Array.isArray(input.prereqTexts) ? input.prereqTexts : [] });
  }

  const added = created.map((c) => c.prop);
  graph.propositions.push(...added); // make batch members visible to the cycle check

  // Resolve prerequisite references by text (the model reasons in claims, not
  // ids). An edge prop -> target would close a cycle iff target already
  // transitively depends on prop, so check that direction.
  for (const { prop, prereqTexts } of created) {
    for (const t of prereqTexts) {
      const target = byNorm.get(normText(t));
      if (!target || target.id === prop.id) continue;
      if (reachable(graph, target.id, prop.id)) continue;
      if (!prop.prereqs.includes(target.id)) prop.prereqs.push(target.id);
    }
  }
  return { added, skipped };
}

export function exportMarkdown(graph: Graph, now: Date = new Date()): string {
  const lines: string[] = ["# Knowledge Graph", ""];
  lines.push(
    `_Exported ${now.toISOString().slice(0, 10)} · ${graph.propositions.length} propositions · ${graph.topics.length} topics_`,
    "",
  );
  const depthOf = (p: Proposition, seen = new Set<string>()): number => {
    if (!p.prereqs.length || seen.has(p.id)) return 0;
    seen.add(p.id);
    let max = 0;
    for (const pid of p.prereqs) {
      const pre = graph.propositions.find((x) => x.id === pid);
      if (pre) max = Math.max(max, depthOf(pre, seen) + 1);
    }
    return max;
  };
  const grouped = new Map<string, Proposition[]>();
  for (const p of graph.propositions) {
    const list = grouped.get(p.topicId) ?? [];
    list.push(p);
    grouped.set(p.topicId, list);
  }
  for (const topic of graph.topics) {
    const props = (grouped.get(topic.id) ?? []).sort(
      (a, b) => depthOf(a) - depthOf(b) || a.createdAt.localeCompare(b.createdAt),
    );
    lines.push(`## ${topic.name}`, "", `> Goal: ${topic.goal}${topic.active ? "" : " (completed)"}`, "");
    if (!props.length) {
      lines.push("_(no propositions recorded yet)_", "");
      continue;
    }
    for (const p of props) {
      const indent = "  ".repeat(Math.min(depthOf(p), 5));
      const builds = p.prereqs.length ? ` — builds on: ${p.prereqs.join(", ")}` : "";
      const review = p.lastReviewedAt
        ? `last reviewed ${p.lastReviewedAt.slice(0, 10)}, due ${p.dueAt.slice(0, 10)}, seen ${p.passes}/${p.timesSeen}`
        : `due ${p.dueAt.slice(0, 10)}, not yet reviewed`;
      lines.push(`- ${indent}**${p.id}** — ${p.text}${builds} · _${review}_`);
    }
    lines.push("");
  }
  const orphaned = graph.propositions.filter((p) => !graph.topics.some((t) => t.id === p.topicId));
  if (orphaned.length) {
    lines.push("## Other", "");
    for (const p of orphaned) lines.push(`- **${p.id}** — ${p.text}`);
    lines.push("");
  }
  return lines.join("\n");
}
