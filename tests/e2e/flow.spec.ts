import { expect, test, type Page } from "@playwright/test";
import { MOD, connect, open, quickAdd } from "./helpers";

// Request flow, the trace (FLW-33..41): the Flow tab and the edge highlight it drives.

interface HighlightHandle {
  setFlowHighlight(h: { edgeId: string; dir: "req" | "res" } | null): void;
}

async function setHighlight(page: Page, h: { edgeId: string; dir: "req" | "res" } | null) {
  await page.evaluate((value) => {
    (
      window as unknown as { __flowHighlightStore: HighlightHandle }
    ).__flowHighlightStore.setFlowHighlight(value);
  }, h);
}

test("a highlight set from the trace marks the edge and its direction, without an edit (FLW-39)", async ({
  page,
}) => {
  // ?e2e: the test drives the highlight through window.__flowHighlightStore (any build).
  await open(page, "/?e2e");
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await connect(page, "client", "app-server");
  const edge = page.locator(".react-flow__edge");
  await expect(edge).toHaveCount(1);
  const edgeId = (await edge.getAttribute("data-id"))!;
  const saved = () => page.evaluate(() => localStorage.getItem("systemsim-canvas"));
  await expect.poll(saved).toContain(edgeId);
  const before = await saved();

  await setHighlight(page, { edgeId, dir: "req" });
  await expect(edge.locator('[data-edge-highlight="req"]')).toHaveCount(1);
  await setHighlight(page, { edgeId, dir: "res" });
  await expect(edge.locator('[data-edge-highlight="res"]')).toHaveCount(1);
  expect(await saved()).toBe(before); // canvasStore untouched
  await setHighlight(page, null);
  await expect(page.locator("[data-edge-highlight]")).toHaveCount(0);

  // No undo entry: one undo still removes the connection itself.
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+z`);
  await expect(edge).toHaveCount(0);
});
