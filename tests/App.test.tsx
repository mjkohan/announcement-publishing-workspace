import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app";
import { createAnnouncementMock, type IAnnouncementService } from "../src/mocks";
import { renderWithProviders } from "../src/test/renderWithProviders";

/** The supplied mock, with `getAnnouncements` failing on its first call only. */
function failingFirstLoad(): IAnnouncementService {
  const mock = createAnnouncementMock();
  let calls = 0;
  return {
    ...mock,
    getAnnouncements: () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : mock.getAnnouncements();
    },
  };
}

/** The supplied mock, with `listOperations` that never settles: restore stays "loading". */
function pendingRestore() {
  const mock = createAnnouncementMock();
  const listOperations = vi.fn<IAnnouncementService["listOperations"]>(
    () => new Promise(() => undefined),
  );
  return { service: { ...mock, listOperations }, listOperations };
}

const nav = () => screen.getByRole("navigation", { name: "Announcements" });

/** The restore banner: the live region that holds the restoring message. */
const restoreBanner = (main: HTMLElement) =>
  within(main).getByText("Restoring publication status…").closest("[role=status]");

describe("App layout", () => {
  it("has the header, navigation and main landmarks with one h1", () => {
    renderWithProviders(<App />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(nav()).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Announcement Publishing" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Announcements",
      "Details",
    ]);
  });
});

describe("announcement loading", () => {
  it("shows a busy skeleton, then the titles", async () => {
    renderWithProviders(<App />);

    expect(within(nav()).getByText("Loading announcements…").parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );

    expect(await within(nav()).findByText("Service Maintenance Notice")).toBeInTheDocument();
    expect(within(nav()).getByText("New Feature Launch")).toBeInTheDocument();
    expect(within(nav()).queryByText("Loading announcements…")).not.toBeInTheDocument();
  });

  it("shows an error with Try again, which loads the list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { service: failingFirstLoad() });

    const alert = await within(nav()).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load announcements.");

    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await within(nav()).findByText("Service Maintenance Notice")).toBeInTheDocument();
    expect(within(nav()).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("restore banner", () => {
  it("shows the restoring message while restore runs, and hides it when done", async () => {
    renderWithProviders(<App />);
    const main = screen.getByRole("main");

    expect(restoreBanner(main)).toHaveTextContent("Restoring publication status…");

    // The mock lists operations after ~100 ms.
    await vi.waitFor(() => {
      expect(within(main).queryByText("Restoring publication status…")).not.toBeInTheDocument();
    });
  });

  it("shows the degraded message with Retry, which restores again", async () => {
    const user = userEvent.setup();
    const { service, listOperations } = pendingRestore();
    const { store } = renderWithProviders(<App />, { service });
    expect(listOperations).toHaveBeenCalledTimes(1);

    act(() => {
      store.setState({ restoreStatus: "degraded" });
    });

    const main = screen.getByRole("main");
    const alert = within(main).getByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't load publication history. Publishing is paused until it loads.",
    );

    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(listOperations).toHaveBeenCalledTimes(2);
    expect(restoreBanner(main)).toHaveTextContent("Restoring publication status…");
  });
});
