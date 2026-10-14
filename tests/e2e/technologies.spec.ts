import { expect, test, type Page } from "@playwright/test";
import { MOD, center, connect, open, quickAdd } from "./helpers";

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

test("TEC-02/05/06: choosing a technology writes its numbers, shows their source and undoes in one step", async ({
  page,
}) => {
  await open(page);
  await quickAdd(page, "Load Balancer");
  await page.locator(".react-flow__node").last().click();
  const technology = page.getByLabel("Technology", { exact: true });
  // The layer goes in parentheses (TEC-06)
  await expect(technology.locator('option[value="aws-nlb"]')).toHaveText("AWS NLB (L4)");
  await expect(technology.locator('option[value="aws-alb"]')).toHaveText("AWS ALB (L7)");
  await page.locator(".react-flow__node").last().press("Delete");

  await quickAdd(page, "NoSQL Database");
  const node = page.locator(".react-flow__node").last();
  await node.click();
  await technology.selectOption("generic");
  const capacity = page.getByLabel("Capacity per instance", { exact: true });
  const instances = page.getByLabel("Instances", { exact: true });
  await instances.fill("3");
  await instances.press("Enter");
  const genericCapacity = await capacity.inputValue();

  await technology.selectOption("cassandra");
  // i4i.xlarge: 16,000 replica ops/s at 1.5 ms; instances kept (TEC-02)
  await expect(page.getByLabel("Instance class", { exact: true })).toHaveValue("i4i.xlarge");
  await expect(capacity).toHaveValue("16000");
  await expect(page.getByLabel("Service time", { exact: true })).toHaveValue("1.5");
  await expect(instances).toHaveValue("3");
  // Where the numbers come from (TEC-05)
  const picker = page.getByTestId("technology-picker");
  await expect(picker.getByTestId("technology-description")).toContainText("Wide-column store");
  await expect(picker.getByTestId("technology-consistency")).toContainText("AP with tunable");
  const source = picker.getByTestId("technology-source");
  await expect(source).toHaveText(/^Based on: .+, \d{4} \(derived\)$/);
  await expect(source.getByRole("link")).toHaveAttribute("href", /^https:\/\//);

  // One undo step back to the generic numbers
  await node.click();
  await page.keyboard.press(`${MOD}+z`);
  await expect(technology).toHaveValue("generic");
  await expect(capacity).toHaveValue(genericCapacity);
  await expect(instances).toHaveValue("3");
  await expect(picker.getByTestId("technology-source")).toHaveCount(0);
});

test("TEC-14: the instance class shows for a provisioned technology only, and scales capacity", async ({
  page,
}) => {
  await open(page);
  await addWithTechnology(page, "NoSQL Database", "cassandra");
  const instanceClass = page.getByLabel("Instance class", { exact: true });
  await expect
    .poll(() => optionValues(page, "Instance class"))
    .toEqual(["i4i.large", "i4i.xlarge", "i4i.2xlarge", "i4i.4xlarge"]);
  await instanceClass.selectOption("i4i.2xlarge");
  await expect(page.getByLabel("Capacity per instance", { exact: true })).toHaveValue("32000");

  // DynamoDB is billed per request: no class (TEC-14) and no capacity per instance (TEC-51)
  await page.getByLabel("Technology", { exact: true }).selectOption("dynamodb");
  await expect(instanceClass).toHaveCount(0);
  await expect(page.getByTestId("technology-source")).toHaveText(
    /^Based on: .+, \d{4} \(estimate\)$/,
  );
  await page.getByLabel("Technology", { exact: true }).selectOption("generic");
  await expect(instanceClass).toHaveCount(0);
});

test("TEC-43/44: an edited number says what it was modified from, and Reset to benchmark restores it", async ({
  page,
}) => {
  await open(page);
  await addWithTechnology(page, "NoSQL Database", "cassandra");
  const modified = page.getByTestId("technology-modified");
  await expect(modified).toHaveCount(0);

  const capacity = page.getByLabel("Capacity per instance", { exact: true });
  await capacity.fill("20000");
  await capacity.press("Enter");
  await expect(modified).toContainText("Modified from Apache Cassandra i4i.xlarge");
  await modified.getByRole("button", { name: "Reset to benchmark" }).click();
  await expect(capacity).toHaveValue("16000");
  await expect(modified).toHaveCount(0);

  const serviceTime = page.getByLabel("Service time", { exact: true });
  await serviceTime.fill("4");
  await serviceTime.press("Enter");
  await expect(modified).toBeVisible();
  await modified.getByRole("button", { name: "Reset to benchmark" }).click();
  await expect(serviceTime).toHaveValue("1.5");
});

test("TEC-45: a read replica whose technology differs from its primary's says so", async ({
  page,
}) => {
  await open(page);
  await addWithTechnology(page, "SQL Database", "postgres");
  await addWithTechnology(page, "Read Replica", "mysql");
  await connect(page, "sql-db", "read-replica");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.locator('.react-flow__node[data-id^="read-replica-"]').click();
  const warning = page.getByTestId("replica-technology-warning");
  await expect(warning).toHaveText(
    "Replica technology differs from its primary (PostgreSQL (RDS))",
  );

  // Same technology as the primary: no warning
  await page.getByLabel("Technology", { exact: true }).selectOption("postgres");
  await expect(warning).toHaveCount(0);
});

test("TEC-07: on a read-only reference the technology and class can't be changed", async ({
  page,
}) => {
  await open(page);
  await page.getByTitle("Load reference solution").click();
  await page.locator('.react-flow__node[data-id^="nosql-db-"]').click();
  await expect(page.getByLabel("Technology", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Technology", { exact: true })).toHaveValue("generic");
});

/** The technology the Props panel shows for the node whose id starts with `componentId`. */
async function technologyOfNode(page: Page, componentId: string) {
  await page.locator(`.react-flow__node[data-id^="${componentId}-"]`).click();
  return page.getByLabel("Technology", { exact: true });
}

test("TEC-20/21: a central type's technologies open from the palette and drag onto the canvas", async ({
  page,
}) => {
  await open(page);
  const toggle = page.getByRole("button", { name: "NoSQL Database technologies" }).first();
  // Closed by default
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-palette-item="nosql-db:cassandra"]')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const group = page.getByRole("group", { name: "NoSQL Database technologies" }).first();
  await expect(group.locator("[data-palette-item]")).toHaveText([
    "DynamoDB (on-demand)",
    "Apache Cassandra",
    "ScyllaDB",
    "MongoDB (replica set)",
  ]);

  // Mouse drag (dnd-kit starts after 6 px of movement)
  const from = await center(page.locator('[data-palette-item="nosql-db:cassandra"]').first());
  const to = await center(page.locator(".react-flow"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(await technologyOfNode(page, "nosql-db")).toHaveValue("cassandra");
  await expect(page.getByLabel("Capacity per instance", { exact: true })).toHaveValue("16000");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-palette-item="nosql-db:cassandra"]')).toHaveCount(0);
});

test("TEC-22: adding a central type from the palette creates it with its default technology", async ({
  page,
}) => {
  await open(page);
  await quickAdd(page, "NoSQL Database");
  await expect(await technologyOfNode(page, "nosql-db")).toHaveValue("dynamodb");
  await quickAdd(page, "Load Balancer");
  await expect(await technologyOfNode(page, "load-balancer")).toHaveValue("aws-alb");
  // A type without technologies stays as it was
  await quickAdd(page, "App Server");
  await page.locator('.react-flow__node[data-id^="app-server-"]').click();
  await expect(page.getByLabel("Technology", { exact: true })).toHaveCount(0);
});

test("TEC-23: searching the palette for a technology lists it under every type that offers it", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Search components").first().fill("kafka");
  const queue = page.getByRole("group", { name: "Message Queue technologies" }).first();
  const pubsub = page.getByRole("group", { name: "Pub/Sub technologies" }).first();
  await expect(queue.locator("[data-palette-item]")).toHaveText(["Kafka (MSK)"]);
  await expect(pubsub.locator("[data-palette-item]")).toHaveText(["Kafka (MSK)"]);
  await expect(page.locator('[data-palette-item="nosql-db"]')).toHaveCount(0);

  await pubsub.getByRole("button", { name: "Add Kafka (MSK) to canvas as Pub/Sub" }).click();
  await expect(await technologyOfNode(page, "pub-sub")).toHaveValue("kafka");
});

test.describe("touch", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test("TEC-21: tapping a technology in the palette adds it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "NoSQL Database technologies" }).first().tap();
    const row = page.locator('[data-palette-item="nosql-db:scylladb"]').first();
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(await technologyOfNode(page, "nosql-db")).toHaveValue("scylladb");
  });
});

test("TEC-23: Ctrl/Cmd+K finds a technology by name and creates its type with it", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press(`${MOD}+k`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByPlaceholder("Search problems, components, actions…").fill("scylla");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(await technologyOfNode(page, "nosql-db")).toHaveValue("scylladb");

  // The type's own item creates it with the default technology (TEC-22)
  await page.locator(".react-flow__pane").click();
  await page.keyboard.press(`${MOD}+k`);
  await palette.getByPlaceholder("Search problems, components, actions…").fill("Message Queue");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(await technologyOfNode(page, "message-queue")).toHaveValue("kafka");
});

test("TEC-24: the node shows its technology's short name without changing size", async ({
  page,
}) => {
  await open(page);
  await quickAdd(page, "NoSQL Database");
  const node = page.locator('.react-flow__node[data-id^="nosql-db-"]');
  const tag = node.locator("[data-technology]");
  await expect(tag).toHaveText("DynamoDB");
  await expect(tag).toHaveAttribute("data-technology", "dynamodb");

  await node.click();
  const technology = page.getByLabel("Technology", { exact: true });
  await technology.selectOption("generic");
  // Generic: no tag
  await expect(tag).toHaveCount(0);
  const before = (await node.boundingBox())!;

  await technology.selectOption("cassandra");
  await expect(tag).toHaveText("Cassandra");
  const after = (await node.boundingBox())!;
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);

  // A load balancer's tag carries its layer
  await quickAdd(page, "Load Balancer");
  await expect(
    page.locator('.react-flow__node[data-id^="load-balancer-"] [data-technology]'),
  ).toHaveText("ALB · L7");
});

type RuntimeHandle = {
  getState(): { pushSnapshot(s: unknown): void };
};

/** One analyze-style snapshot: each node id gets 1,000 req/s plus its own fields. */
function pushNodes(page: Page, nodes: Record<string, Record<string, unknown>>) {
  return page.evaluate((extra) => {
    const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
    const base = {
      rpsIn: 1000,
      rpsOut: 1000,
      utilization: 0.5,
      queueDepth: 0,
      p50: 5,
      p95: 9,
      p99: 12,
      errorRate: 0,
      drops: 0,
      status: "ok",
    };
    const metrics: Record<string, unknown> = {};
    for (const [id, fields] of Object.entries(extra)) metrics[id] = { ...base, ...fields };
    store.getState().pushSnapshot({
      t: 0,
      offeredRps: 1000,
      nodes: metrics,
      edges: {},
      global: {
        throughput: 1000,
        goodput: 1000,
        errorRate: 0,
        p50: 5,
        p95: 9,
        p99: 12,
        availability: 1,
      },
    });
  }, nodes);
}

test("TEC-40: the node card names the technology's limiting resource and its utilization", async ({
  page,
}) => {
  await open(page, "/?e2e=1");
  await addWithTechnology(page, "SQL Database", "postgres");
  await quickAdd(page, "App Server");
  const sql = page.locator('.react-flow__node[data-id^="sql-db-"]');
  const app = page.locator('.react-flow__node[data-id^="app-server-"]');
  const sqlId = (await sql.getAttribute("data-id"))!;
  const appId = (await app.getAttribute("data-id"))!;
  await pushNodes(page, {
    [sqlId]: { utilization: 1.3, limitKind: "write-primary", limitUtilization: 1.3, writeRps: 900 },
    [appId]: {},
  });

  await sql.click();
  const card = page.getByTestId("node-insight-card");
  const limit = card.getByTestId("node-limit");
  await expect(limit).toHaveText("Write primary: 130%");
  // Saturated: status color and icon
  await expect(limit).toHaveAttribute("data-saturated", "true");
  await expect(limit.getByRole("img", { name: "Status: Critical" })).toBeVisible();

  // Below 1 the resource shows without highlight
  await pushNodes(page, {
    [sqlId]: { utilization: 0.4, limitKind: "write-primary", limitUtilization: 0.4, writeRps: 300 },
    [appId]: {},
  });
  await expect(limit).toHaveText("Write primary: 40%");
  await expect(limit).toHaveAttribute("data-saturated", "false");
  await expect(limit.getByRole("img")).toHaveCount(0);

  // A node without the fields has no line
  await app.click();
  await expect(card).toContainText("App Server");
  await expect(card.getByTestId("node-limit")).toHaveCount(0);
});
