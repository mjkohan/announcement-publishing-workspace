import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { OperationEntry } from "../src/domain";
import { entry, processing, rejected } from "../src/domain/testFactories";
import { AttemptHistory } from "../src/features/announcements";
import type { IAnnouncementService } from "../src/mocks";
import { renderWithProviders } from "../src/test/renderWithProviders";

/** The `announcementId` used by the domain test factories. */
const ANN = "announcement-1";
const OLD_ID = "op-11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_ID = "op-22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const never = <T,>() => new Promise<T>(() => undefined);

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

function renderHistory(...ops: OperationEntry[]) {
  const result = renderWithProviders(<AttemptHistory announcementId={ANN} />, {
    service: silentService(),
  });
  act(() => {
    result.store.setState({
      operations: Object.fromEntries(ops.map((op) => [op.operationId, op])),
    });
  });
  return result;
}

describe("AttemptHistory", () => {
  it("renders nothing before the first attempt", () => {
    const { container } = renderHistory();

    expect(container).toBeEmptyDOMElement();
  });

  it("lists every attempt newest first, collapsed by default", async () => {
    const user = userEvent.setup();
    const older: OperationEntry = {
      ...entry({ operationId: OLD_ID, createdAt: 1_000 }),
      snapshot: rejected(OLD_ID),
    };
    const newer: OperationEntry = {
      ...entry({ operationId: NEW_ID, createdAt: 2_000 }),
      snapshot: processing(NEW_ID),
    };
    const other = entry({ operationId: "op-other", announcementId: "announcement-2" });
    renderHistory(older, newer, other);

    const summary = screen.getByText("Attempts (2)");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");

    await user.click(summary);
    expect(details).toHaveAttribute("open");

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const [first, second] = rows as [HTMLElement, HTMLElement];

    expect(within(first).getByTitle(NEW_ID)).toHaveTextContent("22222222…");
    expect(first).toHaveTextContent("Processing");
    expect(within(second).getByTitle(OLD_ID)).toHaveTextContent("11111111…");
    expect(second).toHaveTextContent("Rejected");

    const created = within(second).getByText(/ago$/);
    expect(created.tagName).toBe("TIME");
    expect(created).toHaveAttribute("datetime", new Date(1_000).toISOString());
  });

  it("shows each attempt's own status, not the announcement's", () => {
    // The announcement reads "Sending…" (latest attempt); the older row keeps its own "Rejected".
    renderHistory(
      { ...entry({ operationId: OLD_ID, createdAt: 1_000 }), snapshot: rejected(OLD_ID) },
      entry({ operationId: NEW_ID, createdAt: 2_000, publishInFlight: true }),
    );

    const rows = screen.getAllByRole("listitem", { hidden: true });
    expect(rows[0]).toHaveTextContent("Sending…");
    expect(rows[1]).toHaveTextContent("Rejected");
  });
});
