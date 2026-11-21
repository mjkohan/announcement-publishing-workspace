import { expect, test } from "@playwright/test";
import { AppPage } from "./helpers";

/** "slow-response": the reply comes after 4.5 s, the publication completes after 1.5 s. */
const LATE_REPLY_MS = 4_500;

test("a check shows Published, and the late reply never takes it back", async ({ page }) => {
  const app = new AppPage(page);
  await app.open();
  await app.pickScenario("slow-response");

  const sentAt = Date.now();
  await app.publish();
  await expect(app.cardTitle("Sending…")).toBeVisible();

  // No automatic polling: the late publish reply brings an old "processing" snapshot.
  await expect(app.cardTitle("Processing")).toBeVisible({ timeout: LATE_REPLY_MS + 5_000 });
  expect(Date.now() - sentAt).toBeGreaterThanOrEqual(LATE_REPLY_MS - 500);

  // The publication finished at 1.5 s: one check shows it.
  await app.checkUntil("Published");

  // A fixed wait is the point here: we assert that nothing changes over time.
  await page.waitForTimeout(2_000);
  await expect(app.cardTitle("Published")).toBeVisible();
  await expect(app.cardTitle("Processing")).toHaveCount(0);
  await expect(app.listItem("ann-101")).toContainText("Published");
  await expect(app.attempts(1)).toBeVisible();
});
