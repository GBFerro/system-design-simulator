import { expect, test, type Locator, type Page } from "@playwright/test";

// Spec 12 (ADV-01/02): findings with quick fixes, previewed as ghosts on the
// canvas and applied — one or all — as a single undo step. The structure
// hints of ADV-03 are covered in chaos.spec.ts.

const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function quickAdd(page: Page, label: string) {
  await page
    .getByRole("button", { name: `Add ${label} to canvas` })
    .first()
    .click();
}

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag from one node's source handle to another node's target handle. */
async function connect(page: Page, from: string, to: string) {
  const a = await center(page.locator(`.react-flow__node[data-id^="${from}-"] .source`));
  const b = await center(page.locator(`.react-flow__node[data-id^="${to}-"] .target`));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

test("quick fixes: ghost preview, apply in one undo step, apply all", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  // The default problem (URL shortener) is read-heavy: reads straight to a lone SQL DB.
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await quickAdd(page, "SQL Database");
  await connect(page, "client", "app-server");
  await connect(page, "app-server", "sql-db");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  await page.getByRole("tab", { name: /Advisor/ }).click();
  const panel = page.getByTestId("advisor-panel");
  const spof = panel.locator('[data-finding^="spof:"]');
  const readCache = panel.locator('[data-finding^="read-cache:"]');
  await expect(spof).toBeVisible();
  await expect(readCache).toBeVisible();

  // Preview the cache: a ghost node and two ghost edges; the App → DB edge keeps the writes.
  await readCache.getByRole("button", { name: /^Preview/ }).click();
  await expect(page.getByTestId("advisor-preview")).toBeVisible();
  await expect(page.locator('[data-ghost-node="cache"]')).toBeVisible();
  await expect(page.locator("[data-ghost-edge]")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge.sf-preview-changed")).toHaveCount(1);
  await expect(page.locator('[data-edge-rule="writes"]')).toHaveCount(1);
  // Ghosts aren't part of the design.
  await expect(page.locator('.react-flow__node[data-id^="cache-"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-ghost-node]")).toHaveCount(0);
  await expect(page.locator("[data-ghost-edge]")).toHaveCount(0);

  // Preview + apply the SPOF fix: one undo step brings the finding back.
  await spof.getByRole("button", { name: /^Preview/ }).click();
  await expect(page.locator('[data-preview-change="×1 → ×2"]')).toBeVisible();
  await page.getByTestId("advisor-preview").getByRole("button", { name: "Apply" }).click();
  await expect(spof).toHaveCount(0);
  await expect(page.locator("[data-preview-change]")).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`);
  await expect(spof).toBeVisible();

  // Apply all: both fixes land (the cache becomes a real node); one undo takes both back.
  await panel.getByTestId("advisor-apply-all").click();
  await expect(page.locator('.react-flow__node[data-id^="cache-"]')).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(spof).toHaveCount(0);
  await expect(readCache).toHaveCount(0);
  await expect(page.locator('[data-edge-rule="writes"]')).toHaveCount(1);
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(spof).toBeVisible();
  await expect(readCache).toBeVisible();
});
