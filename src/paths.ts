import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function projectRoot(): string {
  // src/paths.ts -> project root is one level up
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultDataDir(): string {
  return process.env.DRONGO_HOME ?? process.env.LEARNLITE_HOME ?? path.join(projectRoot(), "memory");
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
