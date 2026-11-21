import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { createAnnouncementMock, type IAnnouncementService } from "../src/mocks";
import { renderWithProviders } from "../src/test/renderWithProviders";

const nav = () => screen.getByRole("navigation", { name: "Announcements" });
const main = () => screen.getByRole("main");
const actions = () => within(main()).getByRole("group", { name: "Publication actions" });
const dialog = () =>
  screen.getByRole<HTMLDialogElement>("dialog", { hidden: true, name: "Start a new attempt?" });

/** Waits for the list and for restore to finish (real timers). */
async function ready(store: ReturnType<typeof renderWithProviders>["store"]) {
  await within(nav()).findByRole("button", { name: /Service Maintenance Notice/ });
  await waitFor(() => {
    expect(store.getState().restoreStatus).toBe("ready");
  });
}

describe("switching announcements while one is submitting", () => {
  it("ann-102 shows an enabled Publish while ann-101 is still sending", async () => {
    const user = userEvent.setup();
    const mock = createAnnouncementMock();
    // The publish reply never arrives, so ann-101 stays "submitting".
    const service: IAnnouncementService = {
      ...mock,
      publish: () => new Promise(() => undefined),
    };
    const { store } = renderWithProviders(<App />, { service });
    await ready(store);

    await user.click(within(actions()).getByRole("button", { name: "Publish" }));
    const sending = within(actions()).getByRole("button", { name: "Sending…" });
    expect(sending).toBeDisabled();
    expect(sending).toHaveAttribute("aria-busy", "true");

    await user.click(within(nav()).getByRole("button", { name: /New Feature Launch/ }));

    expect(within(main()).getByRole("article", { name: "New Feature Launch" })).toBeInTheDocument();
    expect(within(actions()).getByRole("button", { name: "Publish" })).toBeEnabled();
    // ann-101 keeps its own state in the list.
    expect(
      within(nav()).getByRole("button", { name: /Service Maintenance Notice/ }),
    ).toHaveTextContent("Sending…");
  });
});

describe("rejected flow", () => {
  it("Cancel creates no operation; Confirm creates one", async () => {
    const user = userEvent.setup();
    const service = createAnnouncementMock();
    service.setScenario("explicit-rejection");
    const { store } = renderWithProviders(<App />, { service });
    await ready(store);
    const operationIds = () => Object.keys(store.getState().operations);

    await user.click(within(actions()).getByRole("button", { name: "Publish" }));
    await within(main()).findByText("Rejected", { selector: "p" });
    expect(operationIds()).toHaveLength(1);
    const [first] = operationIds();

    const trigger = within(actions()).getByRole("button", { name: "Start new attempt…" });
    await user.click(trigger);
    // Named only while open: a closed dialog's label is hidden, so keep the element.
    const confirm = dialog();
    expect(confirm.open).toBe(true);
    expect(
      within(confirm).getByText("This creates a new publication attempt with a new ID."),
    ).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(confirm.open).toBe(false);
    expect(operationIds()).toEqual([first]);
    expect(await service.listOperations()).toHaveLength(1);

    await user.click(trigger);
    expect(confirm.open).toBe(true);
    await user.click(within(confirm).getByRole("button", { name: "Start new attempt" }));

    expect(operationIds()).toHaveLength(2);
    expect(operationIds()).toContain(first);
    await waitFor(async () => {
      expect(await service.listOperations()).toHaveLength(2);
    });
  });
});
