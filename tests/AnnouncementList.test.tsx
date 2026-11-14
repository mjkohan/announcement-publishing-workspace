import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { createJournal } from "../src/persistence/journal";
import { renderWithProviders } from "../src/test/renderWithProviders";

const TITLES = ["Service Maintenance Notice", "New Feature Launch"] as const;

async function renderLoaded() {
  const user = userEvent.setup();
  const result = renderWithProviders(<App />);
  const nav = screen.getByRole("navigation", { name: "Announcements" });
  await within(nav).findByRole("button", { name: new RegExp(TITLES[0]) });
  // Let restore finish too, so later state changes are not overwritten by it.
  await waitFor(() => {
    expect(result.store.getState().restoreStatus).toBe("ready");
  });
  const buttons = () => within(nav).getAllByRole("button");
  return { ...result, user, nav, buttons };
}

const current = (buttons: HTMLElement[]) =>
  buttons.map((button) => button.getAttribute("aria-current"));

describe("AnnouncementList", () => {
  it("renders one button per announcement with its title and status", async () => {
    const { buttons } = await renderLoaded();

    expect(buttons()).toHaveLength(3);
    for (const button of buttons()) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveTextContent("Not submitted");
    }
    expect(buttons()[0]).toHaveTextContent(TITLES[0]);
    expect(buttons()[1]).toHaveTextContent(TITLES[1]);
  });

  it("selects the first announcement by default and persists the choice", async () => {
    const { buttons } = await renderLoaded();

    expect(current(buttons())).toEqual(["true", null, null]);
    expect(createJournal(sessionStorage).getSelectedId()).toBe("ann-101");
  });

  it("restores the stored selection on load", async () => {
    createJournal(sessionStorage).setSelectedId("ann-103");

    const { buttons } = await renderLoaded();

    expect(current(buttons())).toEqual([null, null, "true"]);
  });

  it("a click moves aria-current and persists the selection", async () => {
    const { buttons, user } = await renderLoaded();

    const [, second] = buttons();
    if (!second) throw new Error("No second announcement");
    await user.click(second);

    expect(current(buttons())).toEqual([null, "true", null]);
    expect(createJournal(sessionStorage).getSelectedId()).toBe("ann-102");
  });

  it("shows a live status for every announcement, independent of the selection", async () => {
    const { buttons, store } = await renderLoaded();
    expect(current(buttons())).toEqual(["true", null, null]);

    act(() => {
      store.getState().applySnapshots([
        {
          operationId: "op-102",
          announcementId: "ann-102",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "published",
          version: 2,
          publicationId: "pub-1",
          publishedAt: "2026-01-01T00:00:03.000Z",
        },
        {
          operationId: "op-103",
          announcementId: "ann-103",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "rejected",
          version: 2,
          reason: "Declined.",
        },
      ]);
    });

    expect(buttons()[0]).toHaveTextContent("Not submitted");
    expect(buttons()[1]).toHaveTextContent("Published");
    expect(buttons()[2]).toHaveTextContent("Rejected");
  });

  it("uses the normal Tab order; arrow keys do not move focus", async () => {
    const { buttons, user } = await renderLoaded();

    await user.tab();
    expect(buttons()[0]).toHaveFocus();
    await user.tab();
    expect(buttons()[1]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(buttons()[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(buttons()[1]).toHaveFocus();

    for (const button of buttons()) {
      expect(button).not.toHaveAttribute("tabindex");
      expect(button.className).toContain("focus-visible:outline-2");
    }
  });
});
