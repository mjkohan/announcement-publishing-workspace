import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationEntry } from "../src/domain";
import { createAnnouncementMock, type AnnouncementScenario } from "../src/mocks";
import { createJournal } from "../src/persistence/journal";
import { createPublicationStore, selectView } from "../src/store";
import { browserTimers } from "../src/store/timers";
import { inertTimers } from "../src/test/inertTimers";

const ANN = "ann-101";

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/**
 * The tab before the refresh. Polling is off, so this client makes no status read that could
 * consume a pending failure; its only job is to leave a journal entry and a service record.
 */
function beforeRefreshMany(scenario: AnnouncementScenario, announcementIds: string[]): string[] {
  const service = createAnnouncementMock();
  service.setScenario(scenario);
  const store = createPublicationStore({
    service,
    journal: createJournal(sessionStorage),
    now: () => Date.now(),
    timers: inertTimers,
  });
  store.setState({ restoreStatus: "ready" });
  // Store A is dropped right after this: its pending replies settle into a store nobody reads.
  return announcementIds.map((announcementId) => {
    const id = store.getState().publish(announcementId);
    if (!id) throw new Error("publish() was refused");
    return id;
  });
}

function beforeRefresh(scenario: AnnouncementScenario): string {
  const [id] = beforeRefreshMany(scenario, [ANN]);
  if (!id) throw new Error("publish() was refused");
  return id;
}

/** The tab after the refresh: a new service client and a new store on the same sessionStorage. */
function afterRefresh() {
  const service = createAnnouncementMock();
  const publishSpy = vi.spyOn(service, "publish");
  const statusSpy = vi.spyOn(service, "getStatus");
  const listSpy = vi.spyOn(service, "listOperations");
  const store = createPublicationStore({
    service,
    journal: createJournal(sessionStorage),
    now: () => Date.now(),
    timers: browserTimers,
  });
  return {
    store,
    publishSpy,
    statusSpy,
    listSpy,
    view: (announcementId = ANN) => selectView(announcementId)(store.getState()),
    entry: (operationId: string): OperationEntry => {
      const found = store.getState().operations[operationId];
      if (!found) throw new Error(`No entry ${operationId}`);
      return found;
    },
    journalIds: () =>
      createJournal(sessionStorage)
        .read()
        .entries.map((entry) => entry.operationId),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});

describe("restore after a refresh, with the supplied mock", () => {
  it("success: checking, then processing, then published by a check; never publishes", async () => {
    const id = beforeRefresh("success");
    await advance(200);

    const { store, view, publishSpy, journalIds } = afterRefresh();
    const done = store.getState().restore();
    expect(view()).toMatchObject({ kind: "checking", op: { operationId: id } });

    await advance(100);
    await done;
    expect(store.getState().restoreStatus).toBe("ready");
    expect(view()).toMatchObject({ kind: "processing", op: { operationId: id } });

    // No automatic polling: still processing long after completion (2.5 s) until a check.
    await advance(5_000);
    expect(view().kind).toBe("processing");
    const check = store.getState().check(id);
    await advance(100);
    await check;
    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
    expect(journalIds()).toEqual([]);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("status-check-failure: the failed list is retried and the view never shows unconfirmed", async () => {
    const id = beforeRefresh("status-check-failure");
    await advance(200); // the first publish response is lost; no status read yet

    const { store, view, publishSpy } = afterRefresh();
    const done = store.getState().restore();

    // The first list consumes the pending STATUS_UNAVAILABLE and fails at 100 ms.
    await advance(100);
    expect(store.getState().restoreStatus).toBe("loading");
    expect(view()).toMatchObject({ kind: "checking", op: { operationId: id } });

    // Retry after 500 ms; it replies after 100 ms.
    await advance(499);
    expect(view().kind).toBe("checking");
    await advance(101);
    await done;

    expect(store.getState().restoreStatus).toBe("ready");
    expect(view()).toMatchObject({ kind: "processing", stale: false, op: { operationId: id } });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("lost-response: store B checks store A's operation to published without publishing", async () => {
    const id = beforeRefresh("lost-response");
    await advance(50); // store A is dropped before its (lost) publish reply at 120 ms

    const { store, view, publishSpy, statusSpy } = afterRefresh();
    const done = store.getState().restore();
    expect(view()).toMatchObject({ kind: "checking", op: { operationId: id } });

    await advance(100);
    await done;
    expect(store.getState().restoreStatus).toBe("ready");
    expect(view()).toMatchObject({ kind: "processing", op: { operationId: id } });

    // Done at 3 s; nothing is read until the user checks.
    await advance(4_000);
    expect(statusSpy).not.toHaveBeenCalled();
    const check = store.getState().check(id);
    await advance(100);
    await check;
    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("status-check-failure with 3 operations: several failed lists, then ready", async () => {
    const ids = beforeRefreshMany("status-check-failure", ["ann-101", "ann-102", "ann-103"]);
    await advance(200); // all publish responses lost; each operation has one pending failure

    const { store, view, publishSpy, listSpy, journalIds } = afterRefresh();
    const done = store.getState().restore();
    const allChecking = () =>
      ["ann-101", "ann-102", "ann-103"].every(
        (announcementId) => view(announcementId).kind === "checking",
      );

    const expectStillLoading = (lists: number) => {
      expect(listSpy).toHaveBeenCalledTimes(lists);
      expect(store.getState().restoreStatus).toBe("loading");
      expect(allChecking()).toBe(true);
    };
    // Each list replies after 100 ms; the first three each consume one pending failure. The
    // wait (500, 1000, 2000 ms) starts when the failure arrives.
    await advance(100); // 1st try (0 ms) failed
    expectStillLoading(1);
    await advance(500); // 2nd try at 600 ms, fails at 700 ms
    expectStillLoading(2);
    await advance(1_100); // 3rd try at 1700 ms, fails at 1800 ms
    expectStillLoading(3);
    await advance(2_100); // 4th try at 3800 ms
    expectStillLoading(4);
    await advance(99);
    expectStillLoading(4);

    await advance(1); // 4th reply at 3900 ms: all three done (at 3 s)
    await done;
    expect(store.getState().restoreStatus).toBe("ready");
    for (const [index, announcementId] of ["ann-101", "ann-102", "ann-103"].entries()) {
      expect(view(announcementId)).toMatchObject({
        kind: "published",
        op: { operationId: ids[index] },
      });
    }
    expect(journalIds()).toEqual([]);
    expect(listSpy).toHaveBeenCalledTimes(4);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("a never-recorded journal entry: checking, then unconfirmed; resend with the same id", async () => {
    createJournal(sessionStorage).add({
      operationId: "op-ghost",
      announcementId: ANN,
      createdAt: Date.now(),
    });

    const { store, view, entry, publishSpy, statusSpy } = afterRefresh();
    const done = store.getState().restore();
    expect(view()).toMatchObject({ kind: "checking", op: { operationId: "op-ghost" } });
    await advance(100); // list: []
    expect(view().kind).toBe("checking");
    await advance(100); // getStatus: null
    await done;

    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: true });
    expect(entry("op-ghost").lastError?.kind).toBe("not-recorded");
    await advance(60_000);
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).not.toHaveBeenCalled();

    // Resend with the SAME id.
    expect(store.getState().retrySameAttempt("op-ghost")).toBe(true);
    expect(publishSpy).toHaveBeenCalledExactlyOnceWith(ANN, "op-ghost");

    await advance(120);
    expect(view()).toMatchObject({ kind: "processing", op: { operationId: "op-ghost" } });
    // Done 2.5 s after the resend; a check then sees it.
    await advance(2_500);
    const check = store.getState().check("op-ghost");
    await advance(100);
    await check;
    expect(view()).toMatchObject({ kind: "published", op: { operationId: "op-ghost" } });
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("a reset while restore waits on listOperations: the old restore applies nothing", async () => {
    beforeRefresh("success");
    await advance(200);

    const { store, listSpy } = afterRefresh();
    const oldRestore = store.getState().restore(); // its list (with A's operation) replies at +100
    expect(Object.keys(store.getState().operations)).toHaveLength(1); // seeded from the journal

    await advance(50);
    const newRestore = store.getState().resetSimulation(); // its list (empty) replies at +150
    expect(store.getState().operations).toEqual({});

    await advance(50); // the old list reply settles
    await oldRestore;
    expect(store.getState().operations).toEqual({});
    expect(store.getState()).toMatchObject({ epoch: 1, restoreStatus: "loading" });

    await advance(50);
    await newRestore;
    expect(store.getState().restoreStatus).toBe("ready");
    expect(store.getState().operations).toEqual({});
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it("a service operation missing from the journal is restored from the list", async () => {
    const id = beforeRefresh("success");
    await advance(200);
    createJournal(sessionStorage).clear();

    const { store, view, entry, journalIds } = afterRefresh();
    const done = store.getState().restore();
    await advance(100);
    await done;

    expect(view()).toMatchObject({ kind: "processing", op: { operationId: id } });
    expect(entry(id).createdAt).toBe(Date.parse(entry(id).snapshot?.createdAt ?? ""));
    expect(journalIds()).toEqual([]);
  });
});
