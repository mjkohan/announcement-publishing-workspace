import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app";
import { SimulatorPanel } from "../src/dev";
import { ANNOUNCEMENT_SCENARIOS, createAnnouncementMock } from "../src/mocks";
import { renderWithProviders } from "../src/test/renderWithProviders";

const LABEL = "Simulation controls (development tool, not a product feature)";

function renderPanel(service = createAnnouncementMock()) {
  const user = userEvent.setup();
  const result = renderWithProviders(<SimulatorPanel />, { service });
  return { ...result, user, select: () => screen.getByRole("combobox", { name: "Scenario" }) };
}

describe("SimulatorPanel", () => {
  it("is a collapsed <details> with the dev-tool label", async () => {
    const { user } = renderPanel();

    const summary = screen.getByText(LABEL);
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details?.className).toContain("border-dashed");

    await user.click(summary);
    expect(details).toHaveAttribute("open");
  });

  it("offers every scenario with a one-line description", () => {
    const { select } = renderPanel();

    const options = within(select()).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      ...ANNOUNCEMENT_SCENARIOS,
    ]);
    for (const option of options) {
      expect(option.textContent).toMatch(/^[a-z-]+ — .+\.$/);
    }
  });

  it("starts from service.getScenario()", () => {
    const service = createAnnouncementMock();
    service.setScenario("lost-response");

    const { select } = renderPanel(service);

    expect(select()).toHaveValue("lost-response");
  });

  it("sets the scenario on the service and notes it applies to new attempts only", async () => {
    const service = createAnnouncementMock();
    const { user, select } = renderPanel(service);
    expect(select()).toHaveAccessibleDescription(/Applies to new attempts only\.$/);

    await user.selectOptions(select(), "explicit-rejection");

    expect(service.getScenario()).toBe("explicit-rejection");
    expect(select()).toHaveValue("explicit-rejection");
    expect(select()).toHaveAccessibleDescription(
      "The service rejects the announcement with a reason. Applies to new attempts only.",
    );
  });

  describe("Reset simulation", () => {
    const dialog = () => screen.getByRole<HTMLDialogElement>("dialog", { hidden: true });

    it("asks first; Esc and Cancel keep everything and return focus", async () => {
      const service = createAnnouncementMock();
      const reset = vi.spyOn(service, "reset");
      const { user } = renderPanel(service);
      const trigger = screen.getByRole("button", { name: "Reset simulation" });

      await user.click(trigger);
      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveAccessibleName("Reset the simulation?");
      expect(dialog()).toContainElement(document.activeElement as HTMLElement);

      await user.keyboard("{Escape}");
      expect(dialog().open).toBe(false);
      expect(trigger).toHaveFocus();

      await user.click(trigger);
      await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
      expect(dialog().open).toBe(false);
      expect(trigger).toHaveFocus();

      expect(reset).not.toHaveBeenCalled();
    });

    it("confirming calls resetSimulation and restores the default scenario", async () => {
      const service = createAnnouncementMock();
      service.setScenario("overlapping");
      const { user, store, select } = renderPanel(service);
      const reset = vi.spyOn(service, "reset");
      expect(store.getState().epoch).toBe(0);
      const trigger = screen.getByRole("button", { name: "Reset simulation" });

      await user.click(trigger);
      await act(async () => {
        await user.click(within(dialog()).getByRole("button", { name: "Reset simulation" }));
      });

      expect(dialog().open).toBe(false);
      expect(service.getScenario()).toBe("success");
      expect(select()).toHaveValue("success");
      expect(trigger).toHaveFocus();
      // resetSimulation(): the service is reset once and the store starts a new epoch.
      expect(reset).toHaveBeenCalledTimes(1);
      expect(store.getState().epoch).toBe(1);
    });
  });

  it("is rendered by the app, in the footer, outside the product columns", () => {
    renderWithProviders(<App />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(LABEL)).toBeInTheDocument();
  });
});
