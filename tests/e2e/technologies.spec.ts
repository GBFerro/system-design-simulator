import { expect, test, type Page } from "@playwright/test";
import { open, quickAdd } from "./helpers";

// component-technologies: choosing the real product behind a node.

/** Add a component through the palette, select it and pick a technology in Props. */
async function addWithTechnology(page: Page, label: string, technology: string) {
  await quickAdd(page, label);
  await page.locator(".react-flow__node").last().click();
  await page.getByLabel("Technology", { exact: true }).selectOption(technology);
}

/** The option values a select offers. */
function optionValues(page: Page, label: string) {
  return page
    .getByLabel(label, { exact: true })
    .locator("option")
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
}

test("TEC-39: the algorithm select offers only what the load balancer's technology supports", async ({
  page,
}) => {
  await open(page);
  await addWithTechnology(page, "Load Balancer", "aws-nlb");
  // An NLB only flow-hashes
  await expect.poll(() => optionValues(page, "Algorithm")).toEqual(["hash"]);
  await expect(page.getByLabel("Algorithm", { exact: true })).toHaveValue("hash");

  await page.getByLabel("Technology", { exact: true }).selectOption("aws-alb");
  await expect
    .poll(() => optionValues(page, "Algorithm"))
    .toEqual(["round-robin", "least-connections", "weighted"]);
  await expect(page.getByLabel("Algorithm", { exact: true })).toHaveValue("round-robin");
});

test("TEC-33: consistency params show only for the technologies that offer them", async ({
  page,
}) => {
  await open(page);
  await addWithTechnology(page, "NoSQL Database", "cassandra");
  await expect(page.getByLabel("Consistency level", { exact: true })).toBeVisible();
  await expect
    .poll(() => optionValues(page, "Consistency level"))
    .toEqual(["one", "quorum", "all"]);
  await expect(page.getByLabel("Replication factor", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Read consistency", { exact: true })).toHaveCount(0);

  await page.getByLabel("Technology", { exact: true }).selectOption("dynamodb");
  await expect(page.getByLabel("Consistency level", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Replication factor", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Read consistency", { exact: true })).toBeVisible();
});
