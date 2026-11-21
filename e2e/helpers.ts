import { expect, type Locator, type Page } from "@playwright/test";
// Type only, from the contracts: the index would pull the service code into this program.
import type { AnnouncementScenario } from "../src/mocks/contracts";

export const TITLES = {
  "ann-101": "Service Maintenance Notice",
  "ann-102": "New Feature Launch",
  "ann-103": "Support Hours Update",
} as const;

export type AnnouncementId = keyof typeof TITLES;

/** The app, with the list loaded and the restore finished (Publish is enabled then). */
export class AppPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(): Promise<void> {
    await this.page.goto("/");
    await this.waitUntilReady();
  }

  async waitUntilReady(): Promise<void> {
    await expect(this.listItem("ann-101")).toBeVisible();
    await expect(this.page.getByText("Restoring publication status…")).toBeHidden();
  }

  get nav(): Locator {
    return this.page.getByRole("navigation", { name: "Announcements" });
  }

  get main(): Locator {
    return this.page.getByRole("main");
  }

  get card(): Locator {
    return this.main.getByRole("region", { name: "Publication status" });
  }

  get actions(): Locator {
    return this.main.getByRole("group", { name: "Publication actions" });
  }

  /** The list button of one announcement (title and live status badge). */
  listItem(id: AnnouncementId): Locator {
    return this.nav.getByRole("button", { name: new RegExp(TITLES[id]) });
  }

  /** The card's status title, e.g. "Published" (exact text, not the description). */
  cardTitle(title: string): Locator {
    return this.card.getByText(title, { exact: true });
  }

  async select(id: AnnouncementId): Promise<void> {
    await this.listItem(id).click();
    await expect(this.main.getByRole("heading", { level: 2, name: TITLES[id] })).toBeVisible();
  }

  async publish(): Promise<void> {
    await this.actions.getByRole("button", { name: "Publish" }).click();
  }

  /**
   * There is no automatic polling: presses "Check status" (when it is shown and enabled) until
   * the card shows `title`.
   */
  async checkUntil(title: string, timeout = 20_000): Promise<void> {
    await expect(async () => {
      const button = this.actions.getByRole("button", { name: "Check status" });
      if ((await button.isVisible()) && (await button.isEnabled())) await button.click();
      await expect(this.cardTitle(title)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout, intervals: [500, 1_000] });
  }

  async pickScenario(scenario: AnnouncementScenario): Promise<void> {
    const select = this.page.getByRole("combobox", { name: "Scenario" });
    if (!(await select.isVisible())) {
      await this.page
        .getByText("Simulation controls (development tool, not a product feature)")
        .click();
    }
    await select.selectOption(scenario);
    await expect(select).toHaveValue(scenario);
  }

  /** The "Attempts (n)" summary of the attempt history. */
  attempts(count: number): Locator {
    return this.main.getByText(`Attempts (${String(count)})`, { exact: true });
  }
}
