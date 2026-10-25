import path from "node:path";
import { readJson, writeJsonAtomic } from "./fsutil.ts";

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULTS: AppConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
};

export function configPath(dataDir: string): string {
  return path.join(dataDir, "config.json");
}

export function loadConfig(dataDir: string): AppConfig {
  return { ...DEFAULTS, ...readJson<Partial<AppConfig>>(configPath(dataDir), {}) };
}

export function saveConfig(cfg: AppConfig, dataDir: string): void {
  writeJsonAtomic(configPath(dataDir), cfg);
}

export function hasKey(cfg: AppConfig): boolean {
  return cfg.apiKey.trim().length > 0 && cfg.model.trim().length > 0 && cfg.baseUrl.trim().length > 0;
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  return k.length <= 8 ? "••••" : `••••${k.slice(-4)}`;
}

// Scripted no-network mode for development and tests. DRONGO_MOCK is the
// current name; LEARNLITE_MOCK (the app's earlier name) still works.
export function mockMode(): boolean {
  return (process.env.DRONGO_MOCK ?? process.env.LEARNLITE_MOCK) === "1";
}
