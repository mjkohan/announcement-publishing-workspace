import { act, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationEntry } from "../src/domain";
import { entry, processing, published, rejected } from "../src/domain/testFactories";
import { PublicationStatusCard } from "../src/features/announcements";
import type { IAnnouncementService } from "../src/mocks";
import { renderWithProviders } from "../src/test/renderWithProviders";

/** The `announcementId` used by the domain test factories. */
const ANN = "announcement-1";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const never = <T,>() => new Promise<T>(() => undefined);

/** Every request stays pending: restore never ends, so nothing changes the entries we set. */
function silentService(): IAnnouncementService {
  return {
    getAnnouncements: () => never(),
    listOperations: () => never(),
    publish: () => never(),
    getStatus: () => never(),
    setScenario: () => undefined,
    getScenario: () => "success",
    reset: () => undefined,
  };
}

function renderCard(op?: OperationEntry) {
  const result = renderWithProviders(<PublicationStatusCard announcementId={ANN} />, {
    service: silentService(),
  });
  if (op) {
    act(() => {
      result.store.setState({ operations: { [op.operationId]: op } });
    });
  }
  const card = screen.getByRole("region", { name: "Publication status" });
  return { ...result, card };
}

/**
 * The card title. Not a live region.
 */
function expectTitle(card: HTMLElement, title: string) {
  expect(within(card).getByText(title, { selector: "p" })).toBeInTheDocument();
  expect(within(card).queryByRole("status")).not.toBeInTheDocument();
  expect(card.querySelector("[aria-live]")).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("PublicationStatusCard", () => {
  it.each<[string, OperationEntry | undefined, string, string]>([
    [
      "idle",
      undefined,
      "Not submitted",
      "This announcement hasn't been sent to the publishing service yet.",
    ],
    [
      "checking",
      entry(),
      "Checking status…",
      "Looking up this attempt with the publishing service.",
    ],
    [
      "submitting",
      entry({ publishInFlight: true }),
      "Sending…",
      "Submitting to the publishing service.",
    ],
    [
      "processing",
      { ...entry(), snapshot: processing() },
      "Processing",
      "The service accepted this announcement and is publishing it. We'll keep checking automatically.",
    ],
    [
      "unconfirmed",
      entry({ lastError: { kind: "response-lost", at: NOW } }),
      "Outcome unknown",
      "We lost contact with the service, so we can't confirm whether this was published. Checking or retrying won't create a duplicate.",
    ],
    [
      "unconfirmed, not recorded",
      entry({ lastError: { kind: "not-recorded", at: NOW } }),
      "Not received by the service",
      "The service has no record of this attempt. You can safely resend it.",
    ],
  ])("%s: title and description", (_, op, title, description) => {
    const { card } = renderCard(op);

    expectTitle(card, title);
    expect(within(card).getByText(description)).toBeInTheDocument();
    expect(within(card).queryByText(/Couldn't refresh status/)).not.toBeInTheDocument();
  });

  it("published: relative confirmation time and the publication ID", () => {
    const snapshot = { ...published(), publishedAt: new Date(NOW - 3_000).toISOString() };
    const { card } = renderCard({ ...entry(), snapshot });

    expectTitle(card, "Published");
    const confirmed = within(card).getByText(/Publication confirmed/);
    expect(confirmed).toHaveTextContent("Publication confirmed 3s ago.");
    expect(within(confirmed).getByText("3s ago").tagName).toBe("TIME");
    expect(within(card).getByText("Publication ID")).toBeInTheDocument();
    expect(within(card).getByText(snapshot.publicationId)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(confirmed).toHaveTextContent("Publication confirmed 8s ago.");
  });

  it("rejected: the reason in a quote", () => {
    const { card } = renderCard({ ...entry(), snapshot: rejected("op-1", "Too long.") });

    expectTitle(card, "Rejected");
    expect(within(card).getByText("The service declined this announcement:")).toBeInTheDocument();
    expect(within(card).getByText("Too long.").tagName).toBe("BLOCKQUOTE");
  });

  describe("processing, stale", () => {
    const stale = (overrides: Partial<OperationEntry>): OperationEntry => ({
      ...entry({ lastError: { kind: "status-unavailable", at: NOW }, ...overrides }),
      snapshot: processing(),
    });

    it("warns, says it is not a failure, and counts down to the next read", () => {
      const { card } = renderCard(stale({ nextCheckAt: NOW + 4_000 }));

      expectTitle(card, "Processing");

      const warning = within(card).getByText(/Couldn't refresh status\. Showing/);
      expect(warning).toHaveTextContent(
        "Couldn't refresh status. Showing the last known status — this doesn't mean publication failed. Retrying in 4s.",
      );
      // The countdown ticks, so the warning is not a live region.
      expect(within(card).queryByRole("alert")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(warning).toHaveTextContent("Retrying in 3s.");
    });

    it("says retrying now while the read is in flight", () => {
      const { card } = renderCard(stale({ checkInFlight: true }));

      expect(within(card).getByText(/Couldn't refresh status\. Showing/)).toHaveTextContent(
        "Retrying now…",
      );
    });

    it("leaves out the retry when no read is planned", () => {
      const { card } = renderCard(stale({}));

      expect(within(card).getByText(/Couldn't refresh status\. Showing/)).not.toHaveTextContent(
        "Retrying",
      );
    });
  });

  it("shows when the status was last checked, only when known", () => {
    const { card, store } = renderCard({ ...entry(), snapshot: processing() });
    expect(within(card).queryByText(/Last checked/)).not.toBeInTheDocument();

    act(() => {
      store.setState({
        operations: {
          "op-1": { ...entry({ lastCheckedAt: NOW - 10_000 }), snapshot: processing() },
        },
      });
    });

    expect(within(card).getByText(/Last checked/)).toHaveTextContent("Last checked 10s ago");
  });
});
