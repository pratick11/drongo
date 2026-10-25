import fs from "node:fs";
import path from "node:path";

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${counter.toString(36).padStart(2, "0")}${r}`;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "topic";
}
