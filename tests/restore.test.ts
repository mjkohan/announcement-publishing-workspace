import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationEntry } from "../src/domain";
import { createAnnouncementMock, type AnnouncementScenario } from "../src/mocks";
import { createJournal } from "../src/persistence/journal";
import { createPublicationStore, selectView } from "../src/store";
import { browserTimers } from "../src/store/scheduler";
import { inertTimers } from "../src/test/inertTimers";

const ANN = "ann-101";

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/**
 * The tab before the refresh. Polling is off, so this client makes no status read that could
 * consume a pending failure; its only job is to leave a journal entry and a service record.
 */
function beforeRefresh(scenario: AnnouncementScenario) {
  const service = createAnnouncementMock();
  service.setScenario(scenario);
  const store = createPublicationStore({
    service,
    journal: createJournal(sessionStorage),
    now: () => Date.now(),
    timers: inertTimers,
  });
  store.setState({ restoreStatus: "ready" });
  const id = store.getState().publish(ANN);
  if (!id) throw new Error("publish() was refused");
  return id;
}

/** The tab after the refresh: a new service client and a new store on the same sessionStorage. */
function afterRefresh() {
  const service = createAnnouncementMock();
  const publishSpy = vi.spyOn(service, "publish");
  const store = createPublicationStore({
    service,
    journal: createJournal(sessionStorage),
    now: () => Date.now(),
    timers: browserTimers,
  });
  return {
    store,
    publishSpy,
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
  it("success: checking, then processing, then published by polling; never publishes", async () => {
    const id = beforeRefresh("success");
    await advance(200);

    const { store, view, publishSpy, journalIds } = afterRefresh();
    const done = store.getState().restore();
    expect(view()).toMatchObject({ kind: "checking", op: { operationId: id } });

    await advance(100);
    await done;
    expect(store.getState().restoreStatus).toBe("ready");
    expect(view()).toMatchObject({ kind: "processing", op: { operationId: id } });

    // Polling reads 1500 ms after each reply: at 1.8 s (processing, reply 1.9 s) and at 3.4 s
    // (done at 2.5 s, reply 3.5 s).
    await advance(3_199);
    expect(view().kind).toBe("processing");
    await advance(1);
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

  it("a journal entry the service never recorded is unconfirmed; resend uses the same id", async () => {
    createJournal(sessionStorage).add({
      operationId: "op-ghost",
      announcementId: ANN,
      createdAt: Date.now(),
    });

    const { store, view, publishSpy } = afterRefresh();
    const done = store.getState().restore();
    await advance(100); // list: []
    expect(view().kind).toBe("checking");
    await advance(100); // getStatus: null
    await done;

    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: true });
    expect(publishSpy).not.toHaveBeenCalled();

    expect(store.getState().retrySameAttempt("op-ghost")).toBe(true);
    expect(publishSpy).toHaveBeenCalledExactlyOnceWith(ANN, "op-ghost");
    await advance(120);
    expect(view()).toMatchObject({ kind: "processing", op: { operationId: "op-ghost" } });
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
