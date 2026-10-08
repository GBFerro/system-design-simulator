import { expect, test } from "@playwright/test";
import { MOD, connect, edgePoint, open, quickAdd } from "./helpers";

// Spec 03: the Props form is generated from the component schema, and edges carry a call rule.

test("CMP-01: the Props form is generated from the schema and edits are validated and undoable", async ({
  page,
}) => {
  await open(page);
  await quickAdd(page, "App Server");
  await page.locator(".react-flow__node").first().click();

  const instances = page.getByLabel("Instances", { exact: true });
  await expect(instances).toHaveValue("1");
  await expect(page.getByText("Resilience", { exact: true })).toBeVisible();
  // Advanced params start collapsed
  await expect(page.getByLabel("Max queue")).toHaveCount(0);
  await page.getByRole("button", { name: /^Advanced \(\d+\)$/ }).click();
  await expect(page.getByLabel("Max queue")).toBeVisible();

  await instances.fill("4");
  await instances.press("Enter");
  const toolbar = page.getByRole("toolbar", { name: "Node actions" });
  await expect(toolbar.getByText("×4")).toBeVisible();

  // Out of range → default, with a message
  await instances.fill("0");
  await instances.press("Enter");
  await expect(instances).toHaveValue("1");
  await expect(page.getByText(/reset to the default/)).toBeVisible();

  await page.keyboard.press(`${MOD}+z`);
  await expect(instances).toHaveValue("4");

  // Dependent params appear with their toggle
  await expect(page.getByLabel("Retry backoff")).toHaveCount(0);
  const retries = page.getByLabel("Max retries");
  await retries.fill("2");
  await retries.press("Enter");
  await expect(page.getByLabel("Retry backoff")).toBeVisible();
});

test("edge rules: cache → DB is born on_miss and the rule is editable", async ({ page }) => {
  await open(page);
  await quickAdd(page, "Cache / Redis");
  await quickAdd(page, "SQL Database");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  await connect(page, "cache", "sql-db");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const badge = page.locator('[data-edge-rule="on_miss"]');
  await expect(badge).toHaveText("miss");

  const onEdge = await edgePoint(page);
  await page.mouse.click(onEdge.x, onEdge.y);
  const kind = page.getByLabel("Call rule");
  await expect(kind).toHaveValue("on_miss");
  await kind.selectOption("fraction");
  await expect(page.getByLabel("Fraction")).toHaveValue("50");
  await expect(page.locator('[data-edge-rule="fraction"]')).toHaveText("50%");

  // The context menu edits the same rule
  await page.mouse.click(onEdge.x, onEdge.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  await expect(menu.getByRole("menuitemradio", { name: "Fraction" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const calls = menu.getByLabel("Calls per request");
  await calls.fill("3");
  await calls.press("Enter");
  await expect(page.locator('[data-edge-rule="fraction"]')).toHaveText("50% ×3");
  await menu.getByRole("menuitemradio", { name: "Reads only" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-edge-rule="reads"]')).toHaveText("reads ×3");
});
