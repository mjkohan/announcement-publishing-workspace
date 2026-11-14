import { expect, test } from "@playwright/test";
import { AppPage } from "./helpers";

/** "slow-response": the reply comes after 4.5 s, the publication completes after 1.5 s. */
const LATE_REPLY_MS = 4_500;

test("Published appears before the late reply and stays Published after it", async ({ page }) => {
  const app = new AppPage(page);
  await app.open();
  await app.pickScenario("slow-response");

  const sentAt = Date.now();
  await app.publish();

  // Polling sees the terminal snapshot while the publish reply is still on its way.
  await expect(app.cardTitle("Published")).toBeVisible();
  expect(Date.now() - sentAt).toBeLessThan(LATE_REPLY_MS);

  // Let the late reply (an older "processing" snapshot) arrive. It must not win.
  // A fixed wait is the point here: we assert that nothing changes over time.
  await page.waitForTimeout(Math.max(0, sentAt + LATE_REPLY_MS + 1_000 - Date.now()));

  await expect(app.cardTitle("Published")).toBeVisible();
  await expect(app.cardTitle("Processing")).toHaveCount(0);
  await expect(app.listItem("ann-101")).toContainText("Published");
  await expect(app.attempts(1)).toBeVisible();
});
