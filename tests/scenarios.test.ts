import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationEntry } from "../src/domain";
import {
  AnnouncementMockError,
  createAnnouncementMock,
  type AnnouncementScenario,
  type IAnnouncementService,
  type PublicationOperation,
} from "../src/mocks";
import { createJournal } from "../src/persistence/journal";
import { createPublicationStore, selectView } from "../src/store";
import { browserTimers } from "../src/store/timers";

/**
 * Every scenario end to end: the supplied mock and fake timers. There is no automatic polling:
 * the tests read the status with `check()`, as the "Check status" button does. Status reads
 * reply after 100 ms.
 */

const ANN = "ann-101";

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(service: IAnnouncementService) {
  const store = createPublicationStore({
    service,
    journal: createJournal(sessionStorage),
    now: () => Date.now(),
    timers: browserTimers,
  });
  // These tests start from a restored store (restore has its own tests).
  store.setState({ restoreStatus: "ready" });
  const publishSpy = vi.spyOn(service, "publish");
  const statusSpy = vi.spyOn(service, "getStatus");
  const startedAt = Date.now();

  return {
    store,
    publishSpy,
    statusSpy,
    /** Milliseconds since setup. */
    elapsed: () => Date.now() - startedAt,
    view: (announcementId = ANN) => selectView(announcementId)(store.getState()),
    entry: (operationId: string): OperationEntry => {
      const found = store.getState().operations[operationId];
      if (!found) throw new Error(`No entry ${operationId}`);
      return found;
    },
    publish: (announcementId = ANN): string => {
      const id = store.getState().publish(announcementId);
      if (!id) throw new Error("publish() was refused");
      return id;
    },
  };
}

function mockFor(scenario: AnnouncementScenario): IAnnouncementService {
  const service = createAnnouncementMock();
  service.setScenario(scenario);
  return service;
}

/**
 * The real mock, except that `getStatus` replies only when the test settles it. The real request
 * still runs (it may consume a pending failure) and its result is kept in `real`.
 */
function heldStatusService(scenario: AnnouncementScenario) {
  const inner = mockFor(scenario);
  const held: {
    operationId: string;
    real: Promise<PublicationOperation | null>;
    reply: Deferred<PublicationOperation | null>;
  }[] = [];
  const service: IAnnouncementService = {
    ...inner,
    getStatus: (operationId) => {
      const real = inner.getStatus(operationId);
      real.catch(() => undefined);
      const reply = deferred<PublicationOperation | null>();
      held.push({ operationId, real, reply });
      return reply.promise;
    },
  };
  const read = (index: number) => {
    const call = held[index];
    if (!call) throw new Error(`No getStatus call #${String(index)}`);
    return call;
  };
  return { service, held, read };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});

/** "Check status" for one operation, then lets its 100 ms reply arrive. */
async function checkNow(store: ReturnType<typeof setup>["store"], operationId: string) {
  const done = store.getState().check(operationId);
  await advance(100);
  await done;
}

describe("scenarios with manual status checks", () => {
  it("status-check-failure: a failed read is never rejected; the next check recovers", async () => {
    const { store, publish, view, entry, statusSpy } = setup(mockFor("status-check-failure"));
    const id = publish();

    await advance(120); // the publish response is lost
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });
    expect(entry(id).lastError?.kind).toBe("response-lost");

    // The first check consumes the pending STATUS_UNAVAILABLE.
    await checkNow(store, id);
    expect(view().kind).not.toBe("rejected");
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });
    expect(entry(id).lastError?.kind).toBe("status-unavailable");

    // Nothing is read again on its own.
    await advance(30_000);
    expect(statusSpy).toHaveBeenCalledTimes(1);

    // The operation completed at 3 s; the next check sees it.
    await checkNow(store, id);
    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
    expect(entry(id).lastError).toBeUndefined();
  });

  it("overlapping: published in the order 102, 103, 101, each on its own announcement", async () => {
    const { store, publish, view, statusSpy } = setup(mockFor("overlapping"));
    const ids: Record<string, string> = {
      "ann-101": publish("ann-101"), // done at 10 s
      "ann-102": publish("ann-102"), // done at 2 s
      "ann-103": publish("ann-103"), // done at 6 s
    };
    const kinds = () => Object.keys(ids).map((announcementId) => view(announcementId).kind);
    const checkAll = async () => {
      for (const operationId of Object.values(ids)) await checkNow(store, operationId);
    };

    await advance(2_500);
    expect(statusSpy).not.toHaveBeenCalled();
    await checkAll();
    expect(kinds()).toEqual(["processing", "published", "processing"]);

    await advance(4_000);
    await checkAll();
    expect(kinds()).toEqual(["processing", "published", "published"]);

    await advance(4_000);
    await checkAll();
    expect(kinds()).toEqual(["published", "published", "published"]);

    for (const [announcementId, operationId] of Object.entries(ids)) {
      expect(view(announcementId)).toMatchObject({
        kind: "published",
        op: {
          operationId,
          announcementId,
          snapshot: { announcementId, publicationId: `publication-g1-${operationId}` },
        },
      });
    }
  });

  it("slow-response: a check shows published before the reply; the stale v1 reply is ignored", async () => {
    const { store, publish, view, entry, publishSpy, statusSpy } = setup(mockFor("slow-response"));
    const id = publish();

    // Done at 1.5 s, but nothing is read on its own: still "Sending…".
    await advance(1_600);
    expect(view().kind).toBe("submitting");
    expect(statusSpy).not.toHaveBeenCalled();

    await checkNow(store, id);
    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
    expect(entry(id)).toMatchObject({ publishInFlight: true, snapshot: { version: 2 } });

    // The publish reply (v1, captured when the request was sent) arrives at 4.5 s.
    await advance(4_500 - 1_700);
    expect(entry(id)).toMatchObject({
      publishInFlight: false,
      snapshot: { status: "published", version: 2 },
    });
    expect(view().kind).toBe("published");

    await advance(30_000);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledTimes(1);
  });
});

describe("out-of-order replies", () => {
  it("ignores a slow read error that settles after a newer snapshot was applied", async () => {
    const { service, read } = heldStatusService("lost-response");
    const { store, publish, view, entry } = setup(service);
    const id = publish();

    await advance(120); // reply lost
    void store.getState().check(id); // this read is held
    expect(read(0).operationId).toBe(id);
    expect(entry(id)).toMatchObject({ checkInFlight: true, publishInFlight: false });

    // Same-id retry while the read is pending: both flags are set, independently.
    expect(store.getState().retrySameAttempt(id)).toBe(true);
    expect(entry(id)).toMatchObject({ checkInFlight: true, publishInFlight: true });

    await advance(120); // retry reply: processing v1
    expect(entry(id)).toMatchObject({
      checkInFlight: true,
      publishInFlight: false,
      snapshot: { status: "processing", version: 1 },
    });

    // The old read fails only now. It started before the snapshot, so its error is dropped.
    read(0).reply.reject(new AnnouncementMockError("STATUS_UNAVAILABLE", "r", id, ANN));
    await advance(0);

    expect(entry(id).checkInFlight).toBe(false);
    expect(entry(id).lastError).toBeUndefined();
    expect(view()).toMatchObject({ kind: "processing", stale: false });
  });

  it("a read that overlaps an in-flight publish leaves publishInFlight untouched", async () => {
    const { service, read } = heldStatusService("slow-response");
    const { store, publish, view, entry } = setup(service);
    const id = publish(); // reply due at 4.5 s

    await advance(1_500);
    void store.getState().check(id);
    await advance(100); // real reply ready, held
    expect(entry(id)).toMatchObject({ publishInFlight: true, checkInFlight: true });

    read(0).reply.resolve(await read(0).real);
    await advance(0);
    expect(entry(id)).toMatchObject({
      publishInFlight: true,
      checkInFlight: false,
      snapshot: { status: "published", version: 2 },
    });
    expect(view().kind).toBe("published");

    await advance(4_500 - 1_600);
    expect(entry(id)).toMatchObject({
      publishInFlight: false,
      checkInFlight: false,
      snapshot: { status: "published", version: 2 },
    });
  });
});
