#!/usr/bin/env node
// Measures the initial JS of `/` (the scripts referenced by the prerendered
// index.html, i.e. everything loaded before any dynamic import) and compares
// it with the committed baseline. Spec 01: initial JS may not grow > 15%.
//
//   node scripts/bundle-size.mjs            # check against baseline (run after `next build`)
//   node scripts/bundle-size.mjs --update   # rewrite the baseline
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const MAX_GROWTH = 0.15;
// Code that must never land in the initial JS: it loads on first use (dynamic
// import). The marker is a string literal unique to that module; string
// literals survive minification.
const LAZY_ONLY = [
  { marker: "systemforge-engine", what: "The engine worker client (src/engine/client.ts)" },
  { marker: "Engine.analyze() called before load()", what: "The engine (src/engine/engine.ts)" },
];
const root = process.cwd();
const htmlPath = join(root, ".next/server/app/index.html");
const baselinePath = join(root, "bundle-baseline.json");

if (!existsSync(htmlPath)) {
  console.error("No prerendered .next/server/app/index.html — run `npm run build` first.");
  process.exit(1);
}

const html = readFileSync(htmlPath, "utf8");
const scripts = [...new Set(html.match(/\/_next\/static\/[^"'\s]+\.js/g) ?? [])];
if (scripts.length === 0) {
  console.error("No scripts found in index.html — the page format may have changed.");
  process.exit(1);
}

let raw = 0;
let gzip = 0;
const leaks = [];
for (const src of scripts) {
  const buf = readFileSync(join(root, ".next", src.replace(/^\/_next\//, "")));
  raw += buf.length;
  gzip += gzipSync(buf, { level: 9 }).length;
  for (const { marker, what } of LAZY_ONLY) {
    if (buf.includes(marker)) leaks.push(`${what} is in the initial bundle (${src})`);
  }
}
if (leaks.length > 0) {
  for (const leak of leaks) console.error(leak);
  console.error("Keep it behind a dynamic import() so it stays out of the initial JS.");
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`Initial JS for /: ${scripts.length} files, ${kb(raw)} raw, ${kb(gzip)} gzip`);

if (process.argv.includes("--update")) {
  const baseline = {
    measuredAt: new Date().toISOString().slice(0, 10),
    files: scripts.length,
    rawBytes: raw,
    gzipBytes: gzip,
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Baseline written to bundle-baseline.json`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("No bundle-baseline.json — run with --update to create one.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const growth = gzip / baseline.gzipBytes - 1;
const pct = `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`;
console.log(`Baseline (${baseline.measuredAt}): ${kb(baseline.gzipBytes)} gzip → ${pct}`);

if (growth > MAX_GROWTH) {
  console.error(
    `Initial JS grew more than ${MAX_GROWTH * 100}% over the baseline. Lazy-load the new code or justify updating the baseline.`,
  );
  process.exit(1);
}
