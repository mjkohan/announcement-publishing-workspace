import { describe, expect, it } from "vitest";
import type { OperationEntry } from "../domain";
import { entry, processing, published, rejected } from "../domain/testFactories";
import type { IAnnouncementService } from "../mocks";
import { createJournal } from "../persistence/journal";
import { inertTimers } from "../test/inertTimers";
import { MemoryStorage } from "../test/memoryStorage";
import { createPublicationStore, type PublicationState } from "./publicationStore";
import { describeTransition } from "./statusAnnouncer";

/** The `announcementId` used by the domain test factories. */
const ANN = "announcement-1";
const OTHER = "announcement-2";

const never = <T>() => new Promise<T>(() => undefined);

function setup(restoreStatus: PublicationState["restoreStatus"] = "ready") {
  const service: IAnnouncementService = {
    getAnnouncements: () => never(),
    listOperations: () => never(),
    publish: () => never(),
    getStatus: () => never(),
    setScenario: () => undefined,
    getScenario: () => "success",
    reset: () => undefined,
  };
  const store = createPublicationStore({
    service,
    journal: createJournal(new MemoryStorage()),
    now: () => 1_000,
    timers: inertTimers,
  });
  store.setState({
    restoreStatus,
    announcements: {
      status: "ready",
      items: [
        { id: ANN, title: "New Feature Launch", body: "" },
        { id: OTHER, title: "Support Hours Update", body: "" },
      ],
    },
    // The selection must not matter.
    selectedId: OTHER,
  });

  const put = (...ops: OperationEntry[]) => {
    store.setState((state) => ({
      operations: {
        ...state.operations,
        ...Object.fromEntries(ops.map((op) => [op.operationId, op])),
      },
    }));
  };
  const message = () => store.getState().liveAnnouncement;
  return { store, put, message };
}

const sending = entry({ publishInFlight: true });
const accepted: OperationEntry = { ...entry(), snapshot: processing() };
const done: OperationEntry = { ...entry(), snapshot: published() };

describe("watchStatusTransitions", () => {
  it("announces a transition of an announcement that is not selected", () => {
    const { put, message } = setup();

    put(sending);
    expect(message()).toBeNull();
    put(accepted);
    expect(message()?.text).toBe("New Feature Launch is processing.");
    put(done);
    expect(message()?.text).toBe("New Feature Launch was published.");
  });

  it.each<[string, OperationEntry, string]>([
    ["rejected", { ...entry(), snapshot: rejected() }, "New Feature Launch was rejected."],
    [
      "unconfirmed",
      entry({ lastError: { kind: "response-lost", at: 1 } }),
      "New Feature Launch: outcome unknown.",
    ],
    [
      "not recorded",
      entry({ lastError: { kind: "not-recorded", at: 1 } }),
      "New Feature Launch: not received by the service.",
    ],
  ])("%s", (_, op, text) => {
    const { put, message } = setup();
    put(sending);

    put(op);

    expect(message()?.text).toBe(text);
  });

  it("never announces a poll that keeps the same status", () => {
    const { put, message } = setup();
    put(sending);
    put(accepted);
    const first = message();

    put({ ...accepted, lastCheckedAt: 2_000, checkSeq: 3 });
    put({ ...accepted, lastError: { kind: "status-unavailable", at: 3_000 } });
    put({ ...accepted, checkInFlight: true });

    expect(message()).toBe(first);
  });

  it("does not announce checking, submitting or idle", () => {
    const { put, store, message } = setup();

    put(entry());
    put(sending);
    store.setState({ operations: {} });

    expect(message()).toBeNull();
  });

  it("stays silent until restore is ready: rebuilt history is not news", () => {
    const { put, store, message } = setup("loading");

    put(entry());
    put(done);
    store.setState({ restoreStatus: "ready" });

    expect(message()).toBeNull();
  });

  it("gives every message a new id, so the same text is announced again", () => {
    const { put, message } = setup();
    put(sending);
    put({ ...entry(), snapshot: rejected() });
    const first = message();

    put({ ...entry({ operationId: "op-2", createdAt: 2_000, publishInFlight: true }) });
    put({ ...entry({ operationId: "op-2", createdAt: 2_000 }), snapshot: rejected("op-2") });

    expect(message()?.text).toBe(first?.text);
    expect(message()?.id).not.toBe(first?.id);
  });

  it("joins transitions that happen in one update", () => {
    const { put, message } = setup();
    put(sending, entry({ operationId: "op-9", announcementId: OTHER, publishInFlight: true }));

    put(done, {
      ...entry({ operationId: "op-9", announcementId: OTHER }),
      snapshot: { ...rejected("op-9"), announcementId: OTHER },
    });

    expect(message()?.text).toBe(
      "New Feature Launch was published. Support Hours Update was rejected.",
    );
  });

  it("falls back to the id when the title is unknown", () => {
    const { put, message } = setup();
    const op = entry({ operationId: "op-x", announcementId: "ann-x", publishInFlight: true });
    put(op);

    put({ ...op, publishInFlight: false, lastError: { kind: "response-lost", at: 1 } });

    expect(message()?.text).toBe("ann-x: outcome unknown.");
  });
});

describe("describeTransition", () => {
  it.each(["idle", "checking", "submitting"] as const)("%s is not announced", (kind) => {
    const view = kind === "idle" ? { kind } : { kind, op: entry() };
    expect(describeTransition("T", view)).toBeUndefined();
  });
});
