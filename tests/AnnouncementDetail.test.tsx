import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { renderWithProviders } from "../src/test/renderWithProviders";

describe("AnnouncementDetail", () => {
  it("shows a placeholder until an announcement is selected", () => {
    renderWithProviders(<App />);
    const main = screen.getByRole("main");

    expect(within(main).getByRole("heading", { level: 2, name: "Details" })).toBeInTheDocument();
    expect(
      within(main).getByText("Select an announcement to see its details."),
    ).toBeInTheDocument();
  });

  it("shows the selected announcement's title, id, full body and status card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    const main = screen.getByRole("main");

    const article = await within(main).findByRole("article", {
      name: "Service Maintenance Notice",
    });
    expect(
      within(article).getByRole("heading", { level: 2, name: "Service Maintenance Notice" }),
    ).toBeInTheDocument();
    expect(within(article).getByText("ann-101")).toBeInTheDocument();
    expect(
      within(article).getByText(/^Our online services will be briefly unavailable.*reliability\.$/),
    ).toBeInTheDocument();
    const card = within(article).getByRole("region", { name: "Publication status" });
    expect(within(card).getByRole("heading", { level: 3 })).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Announcements" });
    await user.click(within(nav).getByRole("button", { name: /New Feature Launch/ }));

    expect(within(main).getByRole("article", { name: "New Feature Launch" })).toBeInTheDocument();
    expect(within(main).getByText("ann-102")).toBeInTheDocument();
  });
});
