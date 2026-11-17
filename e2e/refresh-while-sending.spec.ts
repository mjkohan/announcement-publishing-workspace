import { expect, test } from "@playwright/test";
import { AppPage } from "./helpers";

/** The app's own journal key (never the mock's). */
const JOURNAL_KEY = "announcement-workspace:app:v1";

test("a refresh while Sending… follows the same attempt and never publishes again", async ({
  page,
}) => {
  const app = new AppPage(page);
  await app.open();
  // The publish reply takes 4.5 s, so "Sending…" stays long enough to reload during it.
  await app.pickScenario("slow-response");

  await app.publish();
  await expect(app.cardTitle("Sending…")).toBeVisible();
  const journaled = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    const data = raw ? (JSON.parse(raw) as { entries?: { operationId: string }[] }) : {};
    return (data.entries ?? []).map((entry) => entry.operationId);
  }, JOURNAL_KEY);
  expect(journaled).toHaveLength(1);
  const [operationId] = journaled;

  await page.reload();
  await app.waitUntilReady();

  // The restored attempt is read, never sent again, and reaches Published.
  await expect(app.cardTitle("Published")).toBeVisible();
  await expect(app.listItem("ann-101")).toContainText("Published");
  await expect(app.main.getByText(/^Attempts \(\d+\)$/)).toHaveText("Attempts (1)");
  await expect(app.main.locator(`[title="${String(operationId)}"]`)).toHaveCount(1);
  // Publish stays available for nothing: the announcement is done, not idle again.
  await expect(app.actions.getByRole("button", { name: "Publish" })).toHaveCount(0);
});
