import fs from "node:fs";
import { spawn } from "node:child_process";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";

import { hasKey, loadConfig, maskKey, mockMode, saveConfig, type AppConfig } from "./config.ts";
import { defaultDataDir } from "./paths.ts";
import { createSession, currentStep, listSessions, loadSession, saveSession, type Session } from "./session.ts";
import { duePropositions, exportMarkdown, loadGraph, type Proposition } from "./graph.ts";
import { isDue } from "./schedule.ts";
import { topicMermaid } from "./mermaid.ts";
import { runTurn } from "./agent.ts";
import { streamChat } from "./llm.ts";

const dataDir = defaultDataDir();
fs.mkdirSync(dataDir, { recursive: true });

const app = new Hono();

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function publicSession(s: Session) {
  return {
    id: s.id,
    mode: s.mode,
    topicId: s.topicId,
    topicName: s.topicName,
    goal: s.goal,
    phase: s.phase,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  };
}

function dashboardState() {
  const cfg = loadConfig(dataDir);
  const graph = loadGraph(dataDir);
  const sessions = listSessions(dataDir);
  const now = new Date();

  const activeTopics = graph.topics
    .filter((t) => t.active)
    .map((t) => {
      const topicSessions = sessions.filter((s) => s.topicId === t.id);
      const withPlan = topicSessions.find((s) => s.plan);
      const steps = withPlan?.plan?.steps ?? [];
      const open = topicSessions.find((s) => s.phase !== "done");
      const current = withPlan && withPlan.phase !== "done" ? currentStep(withPlan) : null;
      return {
        topicId: t.id,
        name: t.name,
        goal: t.goal,
        done: steps.filter((x) => x.doneAt).length,
        total: steps.length,
        currentStepTitle: current?.title ?? null,
        resumeSessionId: open?.id ?? withPlan?.id ?? topicSessions[0]?.id ?? null,
      };
    });

  const days = new Set(sessions.map((s) => s.updatedAt.slice(0, 10)));
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(isoDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(isoDay(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    hasKey: hasKey(cfg),
    config: { baseUrl: cfg.baseUrl, model: cfg.model, apiKeyMasked: maskKey(cfg.apiKey) },
    streak,
    dueCount: graph.propositions.filter((p) => isDue(p, now)).length,
    learnedToday: graph.propositions.filter((p) => p.createdAt.slice(0, 10) === isoDay(now)).length,
    totalPropositions: graph.propositions.length,
    activeTopics,
    recentSessions: sessions.slice(0, 6).map(publicSession),
  };
}

// ---------------------------------------------------------------- state & config

app.get("/api/state", (c) => c.json(dashboardState()));

app.get("/api/config", (c) => {
  const cfg = loadConfig(dataDir);
  return c.json({ baseUrl: cfg.baseUrl, model: cfg.model, apiKeyMasked: maskKey(cfg.apiKey), hasKey: hasKey(cfg) });
});

app.put("/api/config", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const cur = loadConfig(dataDir);
  const next: AppConfig = {
    baseUrl: String(body.baseUrl ?? cur.baseUrl).trim(),
    apiKey: body.apiKey ? String(body.apiKey).trim() : cur.apiKey,
    model: String(body.model ?? cur.model).trim(),
  };
  if (!next.baseUrl || !next.model) return c.json({ error: "baseUrl and model are required." }, 400);
  saveConfig(next, dataDir);
  return c.json({ ok: true, apiKeyMasked: maskKey(next.apiKey), hasKey: hasKey(next) });
});

app.post("/api/config/test", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const cur = loadConfig(dataDir);
  const cfg: AppConfig = {
    baseUrl: String(body.baseUrl ?? cur.baseUrl).trim(),
    apiKey: body.apiKey ? String(body.apiKey).trim() : cur.apiKey,
    model: String(body.model ?? cur.model).trim(),
  };
  if (!cfg.apiKey) return c.json({ ok: false, error: "No API key provided or saved." });
  let sample = "";
  try {
    for await (const ev of streamChat(cfg, [{ role: "user", content: "Reply with the single word: ready" }])) {
      if (ev.type === "delta") sample += ev.text;
      if (ev.type === "error") return c.json({ ok: false, error: ev.message });
      if (ev.type === "done") break;
    }
    return c.json({ ok: true, sample: sample.slice(0, 120) || "(no text)" });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------- sessions

app.post("/api/sessions", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const mode = body.mode === "practice" ? "practice" : "learn";
  const topicName = String(body.topic ?? "").trim();
  const goal = String(body.goal ?? "").trim();

  let practiceIds: string[] = [];
  if (mode === "practice") {
    const graph = loadGraph(dataDir);
    let due = duePropositions(graph);
    if (!due.length) {
      due = graph.propositions
        .slice()
        .sort((a, b) => (a.lastReviewedAt ?? a.createdAt).localeCompare(b.lastReviewedAt ?? b.createdAt))
        .slice(0, 8);
    }
    if (!due.length) return c.json({ error: "Nothing to practice yet — learn a topic first." }, 400);
    practiceIds = due.slice(0, 10).map((p) => p.id);

    // A workout only counts as finished once its targets have been rescheduled
    // (no longer due). Until then Practice reopens it — history intact —
    // instead of stacking fresh empty sessions on every click.
    const today = isoDay(new Date());
    const dueIds = new Set(practiceIds);
    const open = listSessions(dataDir)
      .filter((s) => s.mode === "practice" && isoDay(new Date(s.updatedAt)) === today)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .find((s) => s.practiceIds.some((id) => dueIds.has(id)));
    if (open) return c.json({ ...open, resumed: true });
  } else if (!topicName) {
    return c.json({ error: "Topic is required." }, 400);
  }

  const session = createSession({ mode, topicName: topicName || "Practice", goal, practiceIds });
  saveSession(session, dataDir);
  return c.json(session);
});

app.get("/api/sessions", (c) => c.json(listSessions(dataDir).map(publicSession)));

app.get("/api/sessions/:id", (c) => {
  const s = loadSession(c.req.param("id"), dataDir);
  return s ? c.json(s) : c.json({ error: "Session not found." }, 404);
});

const busy = new Set<string>();

app.post("/api/sessions/:id/message", (c) => {
  const id = c.req.param("id");
  const session = loadSession(id, dataDir);
  if (!session) return c.json({ error: "Session not found." }, 404);
  if (busy.has(id)) return c.json({ error: "A turn is already running for this session." }, 409);
  const cfg = loadConfig(dataDir);
  if (!hasKey(cfg) && !mockMode()) {
    return c.json({ error: "No API key configured. Open Settings first." }, 400);
  }

  return streamSSE(c, async (stream) => {
    busy.add(id);
    try {
      const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
      const content = String(body.content ?? "").trim();
      if (content) {
        session.messages.push({ role: "user", content });
        saveSession(session, dataDir);
      }
      await stream.writeSSE({ data: JSON.stringify({ type: "start" }) });
      await runTurn(session, { dataDir, cfg }, (e) => stream.writeSSE({ data: JSON.stringify(e) }));
      await stream.writeSSE({ data: JSON.stringify({ type: "turn_done" }) });
    } catch (err) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: (err as Error).message }) }).catch(() => {});
    } finally {
      busy.delete(id);
      saveSession(session, dataDir);
    }
  });
});

// ---------------------------------------------------------------- graph

app.get("/api/graph", (c) => {
  const graph = loadGraph(dataDir);
  const now = new Date();
  const dueIds = new Set(graph.propositions.filter((p) => isDue(p, now)).map((p) => p.id));
  const topicIds = new Set(graph.topics.map((t) => t.id));
  const byTopic = new Map<string, Proposition[]>();
  const orphans: Proposition[] = [];
  for (const p of graph.propositions) {
    if (!topicIds.has(p.topicId)) {
      orphans.push(p);
      continue;
    }
    const list = byTopic.get(p.topicId) ?? [];
    list.push(p);
    byTopic.set(p.topicId, list);
  }
  const mermaidByTopic: Record<string, string> = {};
  for (const [topicId, props] of byTopic) mermaidByTopic[topicId] = topicMermaid(props, dueIds);
  return c.json({
    topics: graph.topics,
    propositions: graph.propositions,
    dueIds: [...dueIds],
    mermaidByTopic,
    mermaidOther: topicMermaid(orphans, dueIds),
  });
});

app.get("/api/graph/export", (c) => {
  const graph = loadGraph(dataDir);
  return c.text(exportMarkdown(graph, new Date()), 200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-disposition": 'attachment; filename="graph.md"',
  });
});

// ---------------------------------------------------------------- static + boot

app.use("*", serveStatic({ root: "./web" }));

const port = Number(process.env.PORT ?? 5188);
serve({ fetch: app.fetch, port }, (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`Drongo → ${url}   (memory: ${dataDir})`);
  if (!process.env.NO_OPEN && (process.stdout.isTTY || process.platform === "darwin")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
    if (cmd) {
      try {
        spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
      } catch {
        /* opening the browser is best-effort */
      }
    }
  }
});
