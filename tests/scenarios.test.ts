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
import { browserTimers } from "../src/store/scheduler";

/**
 * Every scenario end to end: the supplied mock, fake timers and the polling scheduler on.
 * Mock timing: status reads reply after 100 ms; the store polls 1500 ms after each reply and
 * backs off 1 s after the first failed read.
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

describe("scenarios with polling", () => {
  it("status-check-failure: a failed read is never rejected; polling recovers to published", async () => {
    const { publish, view, entry, elapsed } = setup(mockFor("status-check-failure"));
    const id = publish();

    await advance(120); // the publish response is lost
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });
    expect(entry(id).lastError?.kind).toBe("response-lost");

    // First poll at 1.5 s consumes the pending STATUS_UNAVAILABLE and fails at 1.6 s.
    await advance(1_600 - 120);
    expect(view().kind).not.toBe("rejected");
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });
    expect(entry(id).lastError?.kind).toBe("status-unavailable");
    expect(entry(id).nextCheckAt).toBe(Date.now() + 1_000);

    // Backoff 1 s: read at 2.6 s, processing at 2.7 s.
    await advance(1_100);
    expect(elapsed()).toBe(2_700);
    expect(view()).toMatchObject({ kind: "processing", stale: false });
    expect(entry(id).lastError).toBeUndefined();

    // Next poll at 4.2 s; the operation completed at 3 s, so published at 4.3 s.
    await advance(1_599);
    expect(view().kind).toBe("processing");
    await advance(1);
    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
  });

  it("overlapping: published in the order 102, 103, 101, each on its own announcement", async () => {
    const { publish, view, elapsed } = setup(mockFor("overlapping"));
    const ids: Record<string, string> = {
      "ann-101": publish("ann-101"), // done at 10 s
      "ann-102": publish("ann-102"), // done at 2 s
      "ann-103": publish("ann-103"), // done at 6 s
    };

    const publishedAt: Record<string, number> = {};
    const order: string[] = [];
    while (elapsed() < 13_000) {
      await advance(100);
      for (const announcementId of Object.keys(ids)) {
        if (
          publishedAt[announcementId] === undefined &&
          view(announcementId).kind === "published"
        ) {
          publishedAt[announcementId] = elapsed();
          order.push(announcementId);
        }
      }
    }

    expect(order).toEqual(["ann-102", "ann-103", "ann-101"]);
    const completion: Record<string, number> = {
      "ann-101": 10_000,
      "ann-102": 2_000,
      "ann-103": 6_000,
    };
    for (const [announcementId, operationId] of Object.entries(ids)) {
      // Seen by the first poll after completion: at most one poll period plus a reply later.
      expect(publishedAt[announcementId]).toBeGreaterThanOrEqual(completion[announcementId] ?? 0);
      expect(publishedAt[announcementId]).toBeLessThanOrEqual(
        (completion[announcementId] ?? 0) + 1_600,
      );
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

  it("slow-response: polling shows published at ~1.5 s; the stale v1 reply at 4.5 s is ignored", async () => {
    const { publish, view, entry, publishSpy, statusSpy } = setup(mockFor("slow-response"));
    const id = publish();

    await advance(1_499);
    expect(view().kind).toBe("submitting");

    // First read at 1.5 s (the operation is complete by then), reply after 100 ms.
    await advance(1 + 100);
    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
    expect(entry(id)).toMatchObject({ publishInFlight: true, snapshot: { version: 2 } });
    expect(entry(id).nextCheckAt).toBeUndefined();

    // The publish reply (v1, captured when the request was sent) arrives at 4.5 s.
    await advance(4_500 - 1_600);
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

    await advance(1_500); // reply lost at 120 ms; the first poll at 1.5 s is now held
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
    const { publish, view, entry } = setup(service);
    const id = publish(); // reply due at 4.5 s

    await advance(1_600); // poll at 1.5 s, real reply ready at 1.6 s, held
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
