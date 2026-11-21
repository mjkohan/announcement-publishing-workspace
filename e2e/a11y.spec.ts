import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { AppPage } from "./helpers";

/** Runs every axe rule (no rule disabled) and reports violations readably. */
async function expectNoViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("initial state", async ({ page }) => {
      const app = new AppPage(page);
      await app.open();
      // Open the simulation panel too, so its controls are checked.
      await app.page
        .getByText("Simulation controls (development tool, not a product feature)")
        .click();

      await expectNoViolations(page);
    });

    test("after one announcement is published", async ({ page }) => {
      const app = new AppPage(page);
      await app.open();

      await app.publish();
      await app.checkUntil("Published");
      // Expand the attempt history so its rows are checked.
      await app.attempts(1).click();

      await expectNoViolations(page);
    });

    test("with the rejection dialog open", async ({ page }) => {
      const app = new AppPage(page);
      await app.open();
      await app.pickScenario("explicit-rejection");
      await app.publish();
      await expect(app.cardTitle("Rejected")).toBeVisible();

      await app.actions.getByRole("button", { name: "Start new attempt…" }).click();
      await expect(page.getByRole("dialog", { name: "Start a new attempt?" })).toBeVisible();

      // The modal makes the rest of the page inert, so axe checks the dialog only; the page
      // behind it is covered by the other two states.
      await expectNoViolations(page);
    });
  });
}
