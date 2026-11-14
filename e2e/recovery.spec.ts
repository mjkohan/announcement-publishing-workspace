import { expect, test } from "@playwright/test";
import { AppPage } from "./helpers";

test("a publish interrupted by a reload is followed to Published, without a second attempt", async ({
  page,
}) => {
  const app = new AppPage(page);
  await app.open();
  await app.pickScenario("lost-response");

  await app.publish();
  // Reload at once: the publish reply (lost in this scenario anyway) never reaches the page.
  await page.reload();
  await app.waitUntilReady();

  await expect(app.cardTitle("Published")).toBeVisible();
  await expect(app.listItem("ann-101")).toContainText("Published");
  // One attempt only: the reload resumed the same operationId instead of publishing again.
  await expect(app.main.getByText(/^Attempts \(\d+\)$/)).toHaveText("Attempts (1)");
});
