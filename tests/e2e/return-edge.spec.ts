import { expect, test, type Page } from "@playwright/test";
import { MOD, answer, connect, edgePoint, open, quickAdd } from "./helpers";

// guided-ui: a call is two lines. The request goes from the caller's right handle
// to the callee; its response is drawn by hand from the callee's return handle
// back to the caller. A request without a response is async.

const REQUESTS = '.react-flow__edge:not([data-id^="ret:"])';
const RESPONSES = '.react-flow__edge[data-id^="ret:"]';

async function clientAndApp(page: Page) {
  await open(page);
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
}

const ballCount = (page: Page, dir: "req" | "res") =>
  page
    .getByTestId("flow-particles")
    .getAttribute(`data-balls-${dir}`)
    .then((v) => Number(v));

test("a bare connection is one line and only requests walk it; the response adds the second line and the rings (RET-01, RET-05, RET-10, RET-16)", async ({
  page,
}) => {
  await clientAndApp(page);
  await connect(page, "client", "app-server");
  await expect(page.locator(REQUESTS)).toHaveCount(1);
  await expect(page.locator(RESPONSES)).toHaveCount(0);

  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect.poll(() => ballCount(page, "req"), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await ballCount(page, "res")).toBe(0);

  await answer(page, "app-server", "client");
  await expect(page.locator(RESPONSES)).toHaveCount(1);
  // the response line is dashed and belongs to the request it answers
  const request = page.locator(REQUESTS);
  const requestId = (await request.getAttribute("data-id"))!;
  await expect(page.locator(`[data-edge-response="${requestId}"]`)).toHaveCount(1);
  await expect(
    page
      .locator(`${RESPONSES} path.react-flow__edge-path`)
      .evaluate((p) => getComputedStyle(p).strokeDasharray),
  ).resolves.not.toBe("none");
  await expect.poll(() => ballCount(page, "res"), { timeout: 15_000 }).toBeGreaterThan(0);
});

test("a response without its request creates no line and says why; a second one is ignored (RET-02, RET-03)", async ({
  page,
}) => {
  await clientAndApp(page);
  await answer(page, "app-server", "client");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(
    page.getByText("A response needs a request: connect Client → App Server first"),
  ).toBeVisible();

  await connect(page, "client", "app-server");
  await answer(page, "app-server", "client");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await answer(page, "app-server", "client");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("deleting the request deletes its response, undo brings both back (RET-08)", async ({
  page,
}) => {
  await clientAndApp(page);
  await connect(page, "client", "app-server");
  await answer(page, "app-server", "client");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  const point = await edgePoint(page, page.locator(REQUESTS));
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("a selected response shows what it answers and selects the request (RET-11)", async ({
  page,
}) => {
  await clientAndApp(page);
  await connect(page, "client", "app-server");
  await answer(page, "app-server", "client");

  const point = await edgePoint(page, page.locator(RESPONSES));
  await page.mouse.click(point.x, point.y);
  const panel = page.locator("[data-response-panel]");
  await expect(panel).toContainText("Response to Client → App Server");
  await panel.getByRole("button", { name: "Select the request" }).click();
  await expect(page.locator("[data-response-panel]")).toHaveCount(0);
  await expect(page.getByLabel("Call rule").first()).toBeVisible();
});

test("Async in the context menu deletes the response and Sync draws it back (RET-12, RET-13)", async ({
  page,
}) => {
  await clientAndApp(page);
  await connect(page, "client", "app-server");
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  const rightClick = async () => {
    const point = await edgePoint(page, page.locator(REQUESTS));
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu).toBeVisible();
  };

  await rightClick();
  await menu.getByRole("menuitemradio", { name: "Sync", exact: true }).click();
  await expect(page.locator(RESPONSES)).toHaveCount(1);
  await rightClick();
  await menu.getByRole("menuitemradio", { name: "Async", exact: true }).click();
  await expect(page.locator(RESPONSES)).toHaveCount(0);
  await expect(page.locator(REQUESTS)).toHaveCount(1);
});

test("a reference tab shows no return handle and cannot be answered (RET-14)", async ({ page }) => {
  await open(page);
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const handles = page.locator("[data-return-handle]");
  expect(await handles.count()).toBeGreaterThan(0);
  for (const handle of await handles.all()) {
    await expect(handle).toHaveCSS("opacity", "0");
    await expect(handle).toHaveAttribute("aria-hidden", "true");
  }
  // the responses of the reference are drawn all the same
  await expect(page.locator(RESPONSES).first()).toBeAttached();
});
