import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./tools.ts";

// World tools: the study partner's hands. File and shell access jailed to a
// per-conversation workspace directory, so the model can build and run examples
// without touching anything else on disk. The workspace path is supplied by
// the tool registry (tools.ts); nothing here decides it.

// Stop collecting output after this much — a runaway command must not fill memory.
const MAX_COLLECT_CHARS = 1_000_000;

// Resolve a model-supplied path against the workspace and refuse anything
// that escapes it (../, absolute paths outside, symlinks aside).
export function jailedPath(workspaceDir: string, relPath: string): string {
  const resolved = path.resolve(workspaceDir, relPath);
  if (resolved !== workspaceDir && !resolved.startsWith(workspaceDir + path.sep)) {
    throw new Error(`Path escapes the session workspace: ${relPath}`);
  }
  return resolved;
}

// Head+tail clip so a chatty command cannot blow the context window.
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n… (${text.length - max} chars omitted) …\n${text.slice(-tail)}`;
}

export interface BashResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

// Run a command under bash in its own process group, so a timeout can kill
// the whole tree, not just the shell. Non-interactive: stdin is closed.
export function runBash(command: string, opts: { cwd: string; timeoutMs: number }): Promise<BashResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], {
      cwd: opts.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout!.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_COLLECT_CHARS) stdout += chunk;
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_COLLECT_CHARS) stderr += chunk;
    });

    const killTree = (sig: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, sig); // negative pid = the whole group
      } catch {
        /* already gone */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 2000).unref();
    }, opts.timeoutMs);

    const finish = (result: Omit<BashResult, "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, timedOut });
    };

    child.on("error", (err) => {
      finish({ exitCode: null, stdout, stderr: `${stderr}\nbash failed to start: ${err.message}` });
    });
    child.on("close", (code) => {
      finish({ exitCode: code, stdout, stderr });
    });
  });
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export const WORLD_TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description:
      "Read a file from this session's workspace. Returns numbered lines; use offset and limit to page through long files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the session workspace." },
        offset: { type: "number", description: "1-based first line to return." },
        limit: { type: "number", description: "Maximum lines to return (default 2000)." },
      },
      required: ["path"],
    },
    execute(args, ctx) {
      const rel = str(args.path);
      const p = jailedPath(ctx.workspaceDir, rel);
      let text: string;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        return `Cannot read ${rel} — does it exist in the workspace?`;
      }
      // A file ending in a newline has no phantom final line.
      const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
      const start = Math.max(1, Math.floor(Number(args.offset) || 1));
      const limit = Math.max(1, Math.floor(Number(args.limit) || 2000));
      const slice = lines.slice(start - 1, start - 1 + limit);
      const body = slice.map((line, i) => `${start + i}\t${line}`).join("\n");
      const remaining = lines.length - (start - 1 + slice.length);
      const more = remaining > 0 ? `\n(${remaining} more lines — read_file with offset ${start + limit})` : "";
      return `${body}${more}` || "(empty file)";
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file in this session's workspace (parent directories are created). Paths must stay inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the session workspace." },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    execute(args, ctx) {
      const rel = str(args.path);
      const p = jailedPath(ctx.workspaceDir, rel);
      const content = str(args.content);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return `Wrote ${content.length} chars to ${rel}.`;
    },
  },
  {
    name: "edit_file",
    description:
      "Replace exactly one unique occurrence of old_string with new_string in a workspace file. Copy old_string verbatim from a fresh read — including whitespace — and include enough surrounding lines to make it unique.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the session workspace." },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
    execute(args, ctx) {
      const rel = str(args.path);
      const p = jailedPath(ctx.workspaceDir, rel);
      const oldStr = str(args.old_string);
      const newStr = str(args.new_string);
      if (!oldStr) return "old_string must not be empty.";
      let text: string;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        return `Cannot read ${rel} — edit_file only edits existing files; create one with write_file first.`;
      }
      const first = text.indexOf(oldStr);
      if (first === -1) return `old_string not found in ${rel}. Read the file again and copy the text exactly.`;
      if (text.indexOf(oldStr, first + 1) !== -1) {
        return `old_string appears more than once in ${rel} — include more surrounding lines to make it unique.`;
      }
      fs.writeFileSync(p, text.slice(0, first) + newStr + text.slice(first + oldStr.length));
      return `Edited ${rel} (1 replacement).`;
    },
  },
  {
    name: "bash",
    description:
      "Run a shell command in this session's workspace (bash -c, cwd = workspace). Use it to run code examples and exercises and to verify output before showing it. Non-interactive: stdin is closed; long-running commands are killed at the timeout.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: {
          type: "number",
          description: "Kill the process tree after this many ms (default from config, max 120000).",
        },
      },
      required: ["command"],
    },
    async execute(args, ctx) {
      if (!ctx.cfg.tools.bash) return "The bash tool is disabled in config.json (tools.bash = false).";
      const command = str(args.command).trim();
      if (!command) return "command must not be empty.";
      const timeoutMs = Math.min(Math.max(Math.floor(Number(args.timeout_ms) || ctx.cfg.tools.timeoutMs), 100), 120_000);
      fs.mkdirSync(ctx.workspaceDir, { recursive: true });
      const r = await runBash(command, { cwd: ctx.workspaceDir, timeoutMs });
      const parts = [
        r.timedOut
          ? `timed out after ${timeoutMs}ms — the process tree was killed`
          : `exit code: ${r.exitCode ?? "unknown"}`,
      ];
      if (r.stdout.trim()) parts.push(`stdout:\n${clip(r.stdout, ctx.cfg.tools.maxOutputChars)}`);
      if (r.stderr.trim()) parts.push(`stderr:\n${clip(r.stderr, ctx.cfg.tools.maxOutputChars)}`);
      if (!r.stdout.trim() && !r.stderr.trim()) parts.push("(no output)");
      return parts.join("\n");
    },
  },
];
