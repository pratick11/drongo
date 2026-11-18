import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeTool, type ToolContext } from "../src/tools.ts";
import type { AppConfig } from "../src/config.ts";

// World tools: jailed file access and bash in a per-conversation workspace.
// Deterministic — no LLM, no network.

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drongo-world-"));
}

function context(dir: string, cfg?: AppConfig, slug = "world-test"): ToolContext {
  return { dataDir: dir, workspaceDir: path.join(dir, "workspaces", slug), cfg };
}

function baseCfg(overrides: Partial<AppConfig["tools"]> = {}): AppConfig {
  return {
    baseUrl: "http://localhost",
    apiKey: "k",
    model: "m",
    tools: { bash: true, timeoutMs: 10_000, maxOutputChars: 10_000, ...overrides },
  };
}

async function call(name: string, args: unknown, ctx: ToolContext) {
  return executeTool(name, JSON.stringify(args), ctx);
}

test("write_file and read_file round-trip inside the workspace", async () => {
  const dir = tmpDir();
  const c = context(dir);

  const w = await call("write_file", { path: "examples/tokenizer.py", content: "print('hi')\n" }, c);
  assert.equal(w.ok, true);
  assert.match(w.output, /Wrote 12 chars/);

  const r = await call("read_file", { path: "examples/tokenizer.py" }, c);
  assert.equal(r.ok, true);
  assert.equal(r.output, "1\tprint('hi')");
});

test("read_file pages with offset and reports remaining lines", async () => {
  const dir = tmpDir();
  const c = context(dir);
  await call("write_file", { path: "long.txt", content: "a\nb\nc\nd\ne" }, c);

  const page = await call("read_file", { path: "long.txt", offset: 2, limit: 2 }, c);
  assert.match(page.output, /^2\tb\n3\tc/);
  assert.match(page.output, /2 more lines — read_file with offset 4/);

  const empty = await call("read_file", { path: "nope.txt" }, c);
  assert.match(empty.output, /Cannot read nope\.txt/);
});

test("edit_file replaces one unique occurrence", async () => {
  const dir = tmpDir();
  const c = context(dir);
  await call("write_file", { path: "app.js", content: "const total = 1 + 1;\nconsole.log(total);" }, c);

  const e = await call("edit_file", { path: "app.js", old_string: "1 + 1", new_string: "2 * 3" }, c);
  assert.equal(e.ok, true);
  const r = await call("read_file", { path: "app.js" }, c);
  assert.match(r.output, /const total = 2 \* 3;/);
});

test("edit_file refuses missing and ambiguous old_string without writing", async () => {
  const dir = tmpDir();
  const c = context(dir);
  await call("write_file", { path: "dup.txt", content: "x = 1\nx = 1" }, c);

  const missing = await call("edit_file", { path: "dup.txt", old_string: "y = 2", new_string: "z" }, c);
  assert.match(missing.output, /not found/);

  const ambiguous = await call("edit_file", { path: "dup.txt", old_string: "x = 1", new_string: "x = 2" }, c);
  assert.match(ambiguous.output, /more than once/);

  const r = await call("read_file", { path: "dup.txt" }, c);
  assert.match(r.output, /1\tx = 1\n2\tx = 1/, "file unchanged after refusals");

  const noFile = await call("edit_file", { path: "ghost.txt", old_string: "a", new_string: "b" }, c);
  assert.match(noFile.output, /only edits existing files/);
});

test("paths that escape the workspace are refused", async () => {
  const dir = tmpDir();
  const c = context(dir);

  const parent = await call("write_file", { path: "../escape.txt", content: "no" }, c);
  assert.match(parent.output, /escapes the session workspace/);

  const absolute = await call("write_file", { path: "/tmp/escape-abs.txt", content: "no" }, c);
  assert.match(absolute.output, /escapes the session workspace/);
  assert.equal(fs.existsSync("/tmp/escape-abs.txt"), false);

  const hidden = await call("read_file", { path: path.join(dir, "config.json") }, c);
  assert.match(hidden.output, /escapes the session workspace/);
});

test("bash runs commands with cwd at the workspace and captures both streams", async () => {
  const dir = tmpDir();
  const c = context(dir);
  await call("write_file", { path: "hello.sh", content: "echo from-workspace\necho to-stderr 1>&2" }, c);

  const r = await call("bash", { command: "pwd && bash hello.sh" }, c);
  assert.equal(r.ok, true);
  assert.match(r.output, /exit code: 0/);
  assert.match(r.output, /workspaces\/world-test/);
  const stdout = r.output.slice(r.output.indexOf("stdout:"), r.output.indexOf("stderr:"));
  assert.match(stdout, /from-workspace/, "ran the workspace script");
  assert.match(r.output, /stderr:\nto-stderr/);
});

test("bash reports failures with exit codes instead of throwing", async () => {
  const dir = tmpDir();
  const c = context(dir);

  const r = await call("bash", { command: "echo before; exit 3" }, c);
  assert.equal(r.ok, true, "a failing command is a successful tool call");
  assert.match(r.output, /exit code: 3/);
  assert.match(r.output, /before/);
});

test("bash timeout kills the process tree", async () => {
  const dir = tmpDir();
  const c = context(dir);

  const r = await call("bash", { command: "sleep 30", timeout_ms: 300 }, c);
  assert.match(r.output, /timed out after 300ms/);
});

test("bash can be disabled in config", async () => {
  const dir = tmpDir();
  const c = context(dir, baseCfg({ bash: false }));

  const r = await call("bash", { command: "echo hi" }, c);
  assert.match(r.output, /disabled in config\.json/);
});

test("bash clamps the timeout into a sane range", async () => {
  const dir = tmpDir();
  const c = context(dir);

  const r = await call("bash", { command: "echo quick", timeout_ms: 5 }, c);
  assert.equal(r.ok, true, "timeout below 100ms is clamped, not rejected");
  assert.match(r.output, /exit code: 0/);
});

test("executeTool derives a default workspace when the caller omits one", async () => {
  const dir = tmpDir();
  const c = context(dir);
  delete (c as { workspaceDir?: string }).workspaceDir;

  const r = await call("write_file", { path: "auto.txt", content: "derived" }, c);
  assert.equal(r.ok, true);
  assert.ok(
    fs.existsSync(path.join(dir, "workspaces", "scratch", "auto.txt")),
    "default workspace is <dataDir>/workspaces/scratch",
  );
});
