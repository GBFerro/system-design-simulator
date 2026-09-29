import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { PROBLEMS } from "@/data/problems";
import { TRADEOFF_CARDS } from "@/data/tradeoffCards";

// The "Architecture map" block of CLAUDE.md went stale in almost every PR of the
// v2 stack (backlog M1, PR #12). This keeps it honest: every src/ folder two
// levels deep, every file in the small shared folders, and the catalog counts.

const root = fileURLToPath(new URL("../../", import.meta.url));
const claude = readFileSync(root + "CLAUDE.md", "utf8").replace(/\r\n/g, "\n");
const block = claude.match(/## Architecture map\s*\n+```\n([\s\S]*?)\n```/);
const map = block?.[1] ?? "";

/** Map text of each first-level src/ folder: its line plus the lines indented under it. */
function sections(): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of map.split("\n")) {
    const indent = line.length - line.trimStart().length;
    const head = line.match(/^ {2}([\w-]+)\/(?:\s|$)/);
    if (head) {
      current = head[1];
      out.set(current, line);
    } else if (current && indent > 2 && line.trim()) {
      out.set(current, `${out.get(current)}\n${line}`);
    } else {
      current = null;
    }
  }
  return out;
}

const dirs = (path: string) =>
  readdirSync(root + path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
const files = (path: string) =>
  readdirSync(root + path, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name.replace(/\.[^.]+$/, ""))
    .sort();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("CLAUDE.md architecture map", () => {
  it("has the map block", () => {
    expect(map).toContain("src/");
  });

  const bySection = sections();

  it("lists every first- and second-level folder under src/ in its parent's entry", () => {
    const missing: string[] = [];
    for (const top of dirs("src")) {
      const text = bySection.get(top);
      if (!text) {
        missing.push(`src/${top}/`);
        continue;
      }
      for (const sub of dirs(`src/${top}`)) {
        if (!new RegExp(`(^|[\\s(,])${escape(sub)}/`).test(text))
          missing.push(`src/${top}/${sub}/`);
      }
    }
    expect(missing, "folders missing from the CLAUDE.md architecture map").toEqual([]);
  });

  it.each(["lib", "hooks", "store"])("names every file of src/%s in its entry", (folder) => {
    const text = bySection.get(folder) ?? "";
    const missing = files(`src/${folder}`).filter(
      (name) => !new RegExp(`\\b${escape(name)}\\b`).test(text),
    );
    expect(missing, `src/${folder} files missing from the CLAUDE.md architecture map`).toEqual([]);
  });

  it("states the real catalog counts", () => {
    const count = (re: RegExp) => Number(map.match(re)?.[1]);
    expect(count(/components\.ts \((\d+) specs\)/)).toBe(SYSTEM_COMPONENTS.length);
    expect(count(/problems\.ts \((\d+)\)/)).toBe(PROBLEMS.length);
    expect(count(/tradeoffCards\.ts \((\d+)\)/)).toBe(TRADEOFF_CARDS.length);
  });
});
