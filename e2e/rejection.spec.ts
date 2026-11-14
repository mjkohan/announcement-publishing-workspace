import { expect, test } from "@playwright/test";
import { AppPage } from "./helpers";

const REASON = "This announcement was declined by the publication service.";

test("a rejection shows the reason; a confirmed new attempt adds a second one", async ({
  page,
}) => {
  const app = new AppPage(page);
  await app.open();
  await app.pickScenario("explicit-rejection");

  await app.publish();

  await expect(app.cardTitle("Rejected")).toBeVisible();
  await expect(app.card.getByText(REASON)).toBeVisible();
  await expect(app.attempts(1)).toBeVisible();

  const trigger = app.actions.getByRole("button", { name: "Start new attempt…" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Start a new attempt?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Esc cancels and returns focus; nothing is created.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(app.attempts(1)).toBeVisible();

  await trigger.click();
  await dialog.getByRole("button", { name: "Start new attempt" }).click();

  await expect(app.attempts(2)).toBeVisible();
  // Still "explicit-rejection": the new attempt is rejected too.
  await expect(app.cardTitle("Rejected")).toBeVisible();
});
