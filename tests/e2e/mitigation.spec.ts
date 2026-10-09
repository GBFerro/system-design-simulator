import { expect, test } from "@playwright/test";
import { MOD, connectSync, open, quickAdd, openTab } from "./helpers";

// Spec 08 (CHS-06): each fault says how to mitigate it, with quick fixes
// previewed on the canvas and applied (live run included) in one undo step.

test("mitigation: preview and apply a fix from an active fault, undo it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await open(page);
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await quickAdd(page, "SQL Database");
  await connectSync(page, "client", "app-server");
  await connectSync(page, "app-server", "sql-db");
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);

  await openTab(page, "Simulate");
  const live = page.getByRole("region", { name: "Live traffic" });
  await live.getByRole("button", { name: "Play live traffic" }).click();
  await expect(live.getByRole("button", { name: "Pause live traffic" })).toBeVisible();

  await openTab(page, /Chaos/);
  const panel = page.getByTestId("chaos-panel");
  await panel.getByRole("button", { name: "Kill node" }).click();
  await panel.getByTestId("chaos-target").selectOption({ label: "SQL Database" });
  const inject = panel.getByTestId("chaos-inject");
  await inject.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await inject.click();

  const active = panel.getByTestId("chaos-active");
  await expect(active.getByText("Kill node · SQL Database")).toBeVisible();
  const tips = active.getByTestId("chaos-mitigations");
  await tips.locator("summary").click();
  const standby = tips.locator('[data-mitigation="kill-node:redundancy"]');
  await expect(standby).toContainText("N+1");

  // Preview: the change is drawn next to the node, not applied.
  await standby.getByRole("button", { name: /^Preview/ }).click();
  await expect(page.getByTestId("advisor-preview")).toBeVisible();
  const db = page.locator('.react-flow__node[data-id^="sql-db-"]');
  await expect(db.locator('[data-preview-change="×1 → ×2"]')).toBeVisible();
  await expect(db.getByText("×2", { exact: true })).toHaveCount(0);

  // Apply during the live run: one undo step, the fault stays on its target.
  await page.getByTestId("advisor-preview").getByRole("button", { name: "Apply" }).click();
  await expect(db.getByText("×2", { exact: true })).toBeVisible();
  await expect(active.getByText("Kill node · SQL Database")).toBeVisible();
  await page.keyboard.press(`${MOD}+z`);
  await expect(db.getByText("×2", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the fault form shows the mitigations of the chosen fault and target", async ({ page }) => {
  await open(page);
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await connectSync(page, "client", "app-server");
  await openTab(page, /Chaos/);
  const panel = page.getByTestId("chaos-panel");
  await panel.getByRole("button", { name: "Transient errors (retry storm)" }).click();
  const tips = panel.getByTestId("chaos-mitigations").first();
  await tips.locator("summary").click();
  await expect(tips.locator('[data-mitigation="transient-errors:cap-retries"]')).toContainText(
    "retry budget",
  );
});
