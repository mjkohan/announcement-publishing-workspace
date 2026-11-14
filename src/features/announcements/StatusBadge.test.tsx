import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AnnouncementView } from "../../domain";
import { entry, processing, published, rejected } from "../../domain/testFactories";
import { StatusBadge } from "./StatusBadge";

const VIEWS: [AnnouncementView, string][] = [
  [{ kind: "idle" }, "Not submitted"],
  [{ kind: "checking", op: entry() }, "Checking…"],
  [{ kind: "submitting", op: entry({ publishInFlight: true }) }, "Sending…"],
  [{ kind: "processing", op: { ...entry(), snapshot: processing() }, stale: false }, "Processing"],
  [{ kind: "published", op: { ...entry(), snapshot: published() } }, "Published"],
  [{ kind: "rejected", op: { ...entry(), snapshot: rejected() }, reason: "Declined." }, "Rejected"],
  [{ kind: "unconfirmed", op: entry(), notRecorded: false }, "Outcome unknown"],
];

describe("StatusBadge", () => {
  it.each(VIEWS)("shows an icon and the text for %o", (view, label) => {
    const { container } = render(<StatusBadge view={view} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("gives each status its own icon", () => {
    const icons = VIEWS.map(([view]) => {
      const { container, unmount } = render(<StatusBadge view={view} />);
      const markup = container.querySelector("svg")?.innerHTML;
      unmount();
      return markup;
    });

    // "checking" and "submitting" share the spinner; every other status differs.
    expect(new Set(icons).size).toBe(VIEWS.length - 1);
  });
});
