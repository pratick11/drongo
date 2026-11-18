import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";

import { hasKey, loadConfig, maskKey, mockMode, saveConfig, type AppConfig } from "./config.ts";
import { defaultDataDir } from "./paths.ts";
import {
  createConversation,
  listConversations,
  loadConversation,
  saveConversation,
  type Conversation,
} from "./session.ts";
import { runTurn } from "./agent.ts";
import { streamChat } from "./llm.ts";
import { deleteBlog, importFromUrl, listBlogs, loadBlog, saveBlog, summarize } from "./blogs.ts";

const dataDir = defaultDataDir();
for (const dir of ["blogs", "digests", "workspaces"]) {
  fs.mkdirSync(path.join(dataDir, dir), { recursive: true });
}

const app = new Hono();

function publicConversation(c: Conversation) {
  return {
    id: c.id,
    title: c.title,
    blogSlug: c.blogSlug,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messages.length,
  };
}

function appState() {
  const cfg = loadConfig(dataDir);
  const blogs = listBlogs(dataDir);
  return {
    hasKey: hasKey(cfg),
    config: { baseUrl: cfg.baseUrl, model: cfg.model, apiKeyMasked: maskKey(cfg.apiKey) },
    blogCount: blogs.length,
    blogs: blogs.map(summarize),
    conversations: listConversations(dataDir).slice(0, 20).map(publicConversation),
  };
}

// ---------------------------------------------------------------- state & config

app.get("/api/state", (c) => c.json(appState()));

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
    tools: { ...cur.tools, ...((body.tools ?? {}) as Partial<AppConfig["tools"]>) },
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
    tools: cur.tools,
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

// ---------------------------------------------------------------- blogs

app.get("/api/blogs", (c) => c.json(listBlogs(dataDir).map(summarize)));

app.post("/api/blogs", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const source = body.url
      ? await importFromUrl(String(body.url))
      : {
          title: String(body.title ?? ""),
          markdown: String(body.markdown ?? ""),
          url: null,
        };
    if (!source.markdown.trim()) return c.json({ error: "Paste the article text or give a URL." }, 400);
    const blog = saveBlog(source, dataDir);
    return c.json({ ...summarize(blog), markdown: blog.markdown }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/blogs/:slug", (c) => {
  const blog = loadBlog(c.req.param("slug"), dataDir);
  return blog ? c.json(blog) : c.json({ error: "Blog not found." }, 404);
});

app.delete("/api/blogs/:slug", (c) => {
  const removed = deleteBlog(c.req.param("slug"), dataDir);
  return removed ? c.json({ ok: true }) : c.json({ error: "Blog not found." }, 404);
});

// ---------------------------------------------------------------- conversations

app.post("/api/conversations", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const title = String(body.title ?? "").trim();
  if (!title) return c.json({ error: "Title is required." }, 400);
  const conversation = createConversation({
    title,
    blogSlug: body.blogSlug ? String(body.blogSlug) : null,
    openingMessage: body.openingMessage ? String(body.openingMessage) : undefined,
  });
  saveConversation(conversation, dataDir);
  return c.json(conversation);
});

app.get("/api/conversations", (c) => c.json(listConversations(dataDir).map(publicConversation)));

app.get("/api/conversations/:id", (c) => {
  const conversation = loadConversation(c.req.param("id"), dataDir);
  return conversation ? c.json(conversation) : c.json({ error: "Conversation not found." }, 404);
});

const busy = new Set<string>();

app.post("/api/conversations/:id/message", (c) => {
  const id = c.req.param("id");
  const conversation = loadConversation(id, dataDir);
  if (!conversation) return c.json({ error: "Conversation not found." }, 404);
  if (busy.has(id)) return c.json({ error: "A turn is already running for this conversation." }, 409);
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
        conversation.messages.push({ role: "user", content });
        saveConversation(conversation, dataDir);
      }
      await stream.writeSSE({ data: JSON.stringify({ type: "start" }) });
      await runTurn(conversation, { dataDir, cfg }, (e) => stream.writeSSE({ data: JSON.stringify(e) }));
      await stream.writeSSE({ data: JSON.stringify({ type: "turn_done" }) });
    } catch (err) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: (err as Error).message }) }).catch(() => {});
    } finally {
      busy.delete(id);
      saveConversation(conversation, dataDir);
    }
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
