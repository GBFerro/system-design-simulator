import { describe, expect, it } from "vitest";
import { STORE_VERSION } from "@/store/persistVersion";
import { useAppStore } from "@/store/appStore";

// Papel quente slice 1, criterion 7: light is the default theme. The persisted shape and
// STORE_VERSION do not change: a stored theme still wins over the default.

describe("the theme of the app store", () => {
  it("starts light for a visitor with nothing stored", () => {
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("toggles to dark and back", () => {
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("dark");
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("is still persisted, and the store keeps its version", () => {
    const options = useAppStore.persist.getOptions();
    const kept = options.partialize?.(useAppStore.getState()) as Record<string, unknown>;
    expect(kept).toHaveProperty("theme", "light");
    expect(options.version).toBe(STORE_VERSION);
  });

  it("a stored dark theme overrides the new default on rehydrate", () => {
    const options = useAppStore.persist.getOptions();
    const merged = options.merge?.({ theme: "dark" }, useAppStore.getState()) as { theme: string };
    expect(merged.theme).toBe("dark");
  });
});
