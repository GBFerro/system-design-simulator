import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useCustomComponentsStore } from "@/store/customComponentsStore";
import { useCustomProblemsStore } from "@/store/customProblemsStore";
import { useInterviewStore } from "@/store/interviewStore";
import { STORE_VERSION } from "@/store/persistVersion";
import { usePenStore } from "@/store/penStore";
import { useSavedDesignsStore } from "@/store/savedDesignsStore";
import { useSloStore } from "@/store/sloStore";
import { useTradeoffStore } from "@/store/tradeoffStore";

// CLAUDE.md: every persisted store uses STORE_VERSION, deferred hydration and a
// real migrate. Keyed by file name so a new persisted store cannot be forgotten.
const STORES = {
  "appStore.ts": useAppStore,
  "canvasStore.ts": useCanvasStore,
  "customComponentsStore.ts": useCustomComponentsStore,
  "customProblemsStore.ts": useCustomProblemsStore,
  "interviewStore.ts": useInterviewStore,
  "penStore.ts": usePenStore,
  "savedDesignsStore.ts": useSavedDesignsStore,
  "sloStore.ts": useSloStore,
  "tradeoffStore.ts": useTradeoffStore,
};

describe("persisted stores", () => {
  it("every store file that calls persist() is covered here", () => {
    const dir = fileURLToPath(new URL("../../src/store/", import.meta.url));
    const persisted = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && /\bpersist\(/.test(readFileSync(dir + f, "utf8")))
      .sort();
    expect(persisted).toEqual(Object.keys(STORES).sort());
  });

  it.each(Object.entries(STORES))("%s uses STORE_VERSION, skipHydration and a migrate", (_f, s) => {
    const options = s.persist.getOptions();
    expect(options.version).toBe(STORE_VERSION);
    expect(options.skipHydration).toBe(true);
    expect(options.migrate).toBeTypeOf("function");
  });
});
