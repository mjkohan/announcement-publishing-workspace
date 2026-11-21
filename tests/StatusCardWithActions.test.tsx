import { act, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnouncementViewKind, OperationEntry } from "../src/domain";
import { entry, processing, published, rejected } from "../src/domain/testFactories";
import { PublicationActions, PublicationStatusCard } from "../src/features/announcements";
import { selectView } from "../src/store";
import { renderWithProviders } from "../src/test/renderWithProviders";
import { silentService } from "../src/test/silentService";

/** The `announcementId` used by the domain test factories. */
const ANN = "announcement-1";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

interface Row {
  name: string;
  /** Hand-built operations; the view is derived from them. */
  ops: OperationEntry[];
  kind: AnnouncementViewKind;
  title: string;
  copy: string[];
  actions: string[];
}

const ROWS: Row[] = [
  {
    name: "idle",
    ops: [],
    kind: "idle",
    title: "Not submitted",
    copy: ["This announcement hasn't been sent to the publishing service yet."],
    actions: ["Publish"],
  },
  {
    name: "checking",
    ops: [entry()],
    kind: "checking",
    title: "Checking status…",
    copy: ["Looking up this attempt with the publishing service."],
    actions: ["Checking…"],
  },
  {
    name: "submitting",
    ops: [entry({ publishInFlight: true })],
    kind: "submitting",
    title: "Sending…",
    copy: ["Submitting to the publishing service."],
    actions: ["Sending…"],
  },
  {
    name: "processing",
    ops: [{ ...entry(), snapshot: processing() }],
    kind: "processing",
    title: "Processing",
    copy: [
      "The service accepted this announcement and is publishing it. Use “Check status” to see if it has finished.",
    ],
    actions: ["Check status"],
  },
  {
    name: "processing, stale",
    ops: [
      {
        ...entry({
          lastError: { kind: "status-unavailable", at: NOW },
        }),
        snapshot: processing(),
      },
    ],
    kind: "processing",
    title: "Processing",
    copy: [
      "The service accepted this announcement and is publishing it. Use “Check status” to see if it has finished.",
      "Couldn't refresh status. Showing the last known status — this doesn't mean publication failed. Use “Check status” to try again.",
    ],
    actions: ["Check status"],
  },
  {
    name: "published",
    ops: [
      {
        ...entry(),
        snapshot: { ...published(), publishedAt: new Date(NOW - 3_000).toISOString() },
      },
    ],
    kind: "published",
    title: "Published",
    copy: ["Publication confirmed 3s ago.", "Publication ID", "pub-op-1"],
    actions: [],
  },
  {
    name: "rejected",
    ops: [{ ...entry(), snapshot: rejected("op-1", "Too long.") }],
    kind: "rejected",
    title: "Rejected",
    copy: ["The service declined this announcement:", "Too long."],
    actions: ["Start new attempt…"],
  },
  {
    name: "unconfirmed",
    ops: [entry({ lastError: { kind: "response-lost", at: NOW } })],
    kind: "unconfirmed",
    title: "Outcome unknown",
    copy: [
      "We lost contact with the service, so we can't confirm whether this was published. Checking or retrying won't create a duplicate.",
      "Uses the same attempt ID, so it can't publish twice.",
    ],
    actions: ["Check status", "Retry same attempt"],
  },
  {
    name: "unconfirmed, not recorded",
    ops: [entry({ lastError: { kind: "not-recorded", at: NOW } })],
    kind: "unconfirmed",
    title: "Not received by the service",
    copy: [
      "The service has no record of this attempt. You can safely resend it.",
      "Uses the same attempt ID, so it can't publish twice.",
    ],
    actions: ["Check status", "Resend same attempt"],
  },
];

/**
 * Matches the innermost element whose whole text is `text`, also when inline elements (like a
 * `<time>`) split it into several nodes.
 */
const fullText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text &&
  !Array.from(element.children).some((child) => child.textContent === text);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

function renderShown(ops: OperationEntry[]) {
  const { service } = silentService();
  const result = renderWithProviders(
    <>
      <PublicationStatusCard announcementId={ANN} />
      <PublicationActions announcementId={ANN} />
    </>,
    { service },
  );
  act(() => {
    result.store.setState({
      restoreStatus: "ready",
      operations: Object.fromEntries(ops.map((op) => [op.operationId, op])),
    });
  });
  return result;
}

describe("PublicationStatusCard with its actions, for every view kind", () => {
  it("covers every view kind", () => {
    const kinds = new Set(ROWS.map((row) => row.kind));
    expect(kinds).toEqual(
      new Set([
        "idle",
        "checking",
        "submitting",
        "processing",
        "published",
        "rejected",
        "unconfirmed",
      ]),
    );
  });

  it.each(ROWS)("$name", ({ ops, kind, title, copy, actions }) => {
    const { store } = renderShown(ops);
    expect(selectView(ANN)(store.getState()).kind).toBe(kind);

    const card = screen.getByRole("region", { name: "Publication status" });
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent("Publication status");
    expect(within(card).getByText(title, { selector: "p" })).toBeInTheDocument();
    for (const text of copy) {
      expect(screen.getByText(fullText(text))).toBeInTheDocument();
    }

    const group = screen.queryByRole("group", { name: "Publication actions" });
    if (actions.length === 0) {
      expect(group).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      return;
    }
    if (!group) throw new Error("No actions group");
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(actions);
  });
});
