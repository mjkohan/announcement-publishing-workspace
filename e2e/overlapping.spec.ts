import { expect, test } from "@playwright/test";
import { AppPage, type AnnouncementId } from "./helpers";

const IDS: AnnouncementId[] = ["ann-101", "ann-102", "ann-103"];

test("three overlapping publications each reach Published on the right announcement", async ({
  page,
}) => {
  const app = new AppPage(page);
  await app.open();
  await app.pickScenario("overlapping");

  // Publish each one, switching the selection in between. Replies arrive out of order.
  for (const id of IDS) {
    await app.select(id);
    await app.publish();
    await expect(app.actions.getByRole("button", { name: "Publish" })).toBeHidden();
  }

  for (const id of IDS) {
    await expect(app.listItem(id)).toContainText("Published");
  }

  // Each detail shows its own published attempt, with its own publication ID.
  const publicationIds = new Set<string>();
  for (const id of IDS) {
    await app.select(id);
    await expect(app.cardTitle("Published")).toBeVisible();
    await expect(app.attempts(1)).toBeVisible();
    const publicationId = await app.card.getByRole("definition").textContent();
    expect(publicationId).toBeTruthy();
    publicationIds.add(publicationId ?? "");
  }
  expect(publicationIds.size).toBe(IDS.length);
});
