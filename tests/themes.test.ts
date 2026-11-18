import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Themes: one CSS file of tokens per theme. Deterministic — reads files only.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themesDir = path.join(root, "web", "themes");

const THEME_IDS = [
  "tokyo-night",
  "paper",
  "catppuccin",
  "dracula",
  "github-dark",
  "gruvbox",
  "monokai",
  "nord",
  "one-dark",
  "rose-pine",
  "solarized",
];

function tokenNames(css: string): string[] {
  return [...new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]))].sort();
}

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

test("every theme is one CSS file with the same token contract", () => {
  const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".css")).sort();
  assert.deepEqual(files, THEME_IDS.map((id) => `${id}.css`).sort());

  const contract = tokenNames(fs.readFileSync(path.join(themesDir, "tokyo-night.css"), "utf8"));
  assert.ok(contract.length > 20, "token contract should be substantial");

  for (const file of files) {
    const css = fs.readFileSync(path.join(themesDir, file), "utf8");
    const id = file.slice(0, -".css".length);
    assert.ok(css.includes(`[data-theme="${id}"]`), `${file} must scope its tokens to [data-theme="${id}"]`);
    assert.match(css, /color-scheme:\s*(light|dark)/, `${file} must declare color-scheme`);
    assert.deepEqual(tokenNames(css), contract, `${file} must define the shared token contract`);
  }
});

test("Tokyo Night is the default theme", () => {
  const css = fs.readFileSync(path.join(themesDir, "tokyo-night.css"), "utf8");
  assert.match(css, /:root\s*,\s*\[data-theme="tokyo-night"\]/);

  const html = read("web", "index.html");
  assert.ok(html.includes('localStorage.getItem("drongo-theme") || "tokyo-night"'));
});

test("the page loads every theme and the picker registers every theme", () => {
  const html = read("web", "index.html");
  const app = read("web", "app.js");

  for (const id of THEME_IDS) {
    assert.ok(html.includes(`/themes/${id}.css`), `index.html must link /themes/${id}.css`);
    assert.ok(app.includes(`id: "${id}"`), `app.js THEMES must include ${id}`);
  }
});
