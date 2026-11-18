import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createConversation, listConversations, loadConversation, saveConversation } from "../src/session.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drongo-session-"));
}

test("a conversation starts empty with a slugged id", () => {
  const c = createConversation({ title: "Stripe Idempotency Keys" });
  assert.match(c.id, /^stripe-idempotency-keys_[a-z0-9]+$/);
  assert.equal(c.title, "Stripe Idempotency Keys");
  assert.equal(c.blogSlug, null);
  assert.deepEqual(c.messages, []);
});

test("an opening message becomes the first user turn", () => {
  const c = createConversation({
    title: "PlanetScale",
    blogSlug: "planetscale-vitess",
    openingMessage: "Break this blog into units.",
  });
  assert.equal(c.blogSlug, "planetscale-vitess");
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].role, "user");
  assert.equal(c.messages[0].content, "Break this blog into units.");
});

test("conversation round-trips through disk and lists newest first", async () => {
  const dir = tmpDir();
  const a = createConversation({ title: "Alpha" });
  const b = createConversation({ title: "Beta" });
  saveConversation(a, dir);
  await new Promise((r) => setTimeout(r, 3)); // updatedAt has ms resolution
  saveConversation(b, dir);

  const loaded = loadConversation(a.id, dir)!;
  assert.equal(loaded.title, "Alpha");

  const list = listConversations(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id); // later updatedAt sorts first
});

test("loadConversation rejects ids that look like path traversal", () => {
  const dir = tmpDir();
  assert.equal(loadConversation("../config", dir), null);
  assert.equal(loadConversation("a/b", dir), null);
});

test("transcripts missing newer fields hydrate with defaults", () => {
  const dir = tmpDir();
  const c = createConversation({ title: "Legacy" });
  const { blogSlug: _blogSlug, messages: _messages, ...rest } = c;
  fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
  fs.writeFileSync(path.join(dir, "conversations", `${c.id}.json`), JSON.stringify(rest));

  const loaded = loadConversation(c.id, dir)!;
  assert.equal(loaded.blogSlug, null);
  assert.deepEqual(loaded.messages, []);
});
