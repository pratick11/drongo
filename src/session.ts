import fs from "node:fs";
import path from "node:path";
import type { LLMMessage } from "./llm.ts";
import { newId, readJson, slugify, writeJsonAtomic } from "./fsutil.ts";

// A conversation is one chat thread with the harness. When it is tied to a
// saved blog, blogSlug points at memory/blogs/<slug>.md. Plain JSON on disk —
// the transcript is the only durable state, and you can read or edit it.

export interface Conversation {
  id: string;
  blogSlug: string | null;
  title: string;
  messages: LLMMessage[];
  createdAt: string;
  updatedAt: string;
}

export function conversationsDir(dataDir: string): string {
  return path.join(dataDir, "conversations");
}

export function conversationPath(id: string, dataDir: string): string {
  return path.join(conversationsDir(dataDir), `${id}.json`);
}

export interface CreateConversationInput {
  title: string;
  blogSlug?: string | null;
  openingMessage?: string;
}

export function createConversation(input: CreateConversationInput): Conversation {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: `${slugify(input.title)}_${newId("c").split("_")[1]}`,
    blogSlug: input.blogSlug ?? null,
    title: input.title.trim() || "Untitled",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  if (input.openingMessage?.trim()) {
    conversation.messages.push({ role: "user", content: input.openingMessage.trim() });
  }
  return conversation;
}

export function saveConversation(conversation: Conversation, dataDir: string): void {
  conversation.updatedAt = new Date().toISOString();
  writeJsonAtomic(conversationPath(conversation.id, dataDir), conversation);
}

export function loadConversation(id: string, dataDir: string): Conversation | null {
  if (!/^[\w.-]+$/.test(id)) return null; // id is used in a file path
  const c = readJson<Conversation | null>(conversationPath(id, dataDir), null);
  return c && c.id ? hydrate(c) : null;
}

export function listConversations(dataDir: string): Conversation[] {
  const dir = conversationsDir(dataDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Conversation[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const c = readJson<Conversation | null>(path.join(dir, name), null);
    if (c && c.id) out.push(hydrate(c));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

// Transcripts written before a field existed are still readable; fill in the
// defaults the rest of the code treats as always present.
function hydrate(c: Conversation): Conversation {
  c.messages ??= [];
  c.blogSlug ??= null;
  return c;
}
