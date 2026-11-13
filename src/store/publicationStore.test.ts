import { describe, expect, it, vi } from "vitest";
import { deriveAnnouncementView, type OperationEntry } from "../domain";
import {
  AnnouncementMockError,
  createAnnouncementMock,
  type IAnnouncement,
  type IAnnouncementService,
  type PublicationOperation,
} from "../mocks";
import { createJournal, type Journal } from "../persistence/journal";
import { inertTimers } from "../test/inertTimers";
import { createPublicationStore, type PublicationStoreApi } from "./publicationStore";
import { browserTimers } from "./scheduler";
import { selectAttempts, selectView } from "./selectors";

const ANN = "ann-101";

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

function snapshot(
  operationId: string,
  status: "processing" | "published" | "rejected",
  announcementId = ANN,
  createdAt = "2026-01-01T00:00:00.000Z",
): PublicationOperation {
  const identity = { operationId, announcementId, createdAt };
  if (status === "processing") return { ...identity, status, version: 1 };
  if (status === "rejected") return { ...identity, status, version: 2, reason: "Declined." };
  return {
    ...identity,
    status,
    version: 2,
    publicationId: `pub-${operationId}`,
    publishedAt: "2026-01-01T00:00:03.000Z",
  };
}

/** Service whose replies the test settles by hand. Records every call in order. */
function controlledService(log: string[]) {
  const publishes: {
    announcementId: string;
    operationId: string;
    reply: Deferred<PublicationOperation>;
  }[] = [];
  const statuses: { operationId: string; reply: Deferred<PublicationOperation | null> }[] = [];
  const announcements = deferred<IAnnouncement[]>();
  const service: IAnnouncementService = {
    getAnnouncements: () => {
      log.push("getAnnouncements");
      return announcements.promise;
    },
    listOperations: () => Promise.resolve([]),
    publish: (announcementId, operationId) => {
      log.push(`publish:${operationId}`);
      const reply = deferred<PublicationOperation>();
      publishes.push({ announcementId, operationId, reply });
      return reply.promise;
    },
    getStatus: (operationId) => {
      log.push(`getStatus:${operationId}`);
      const reply = deferred<PublicationOperation | null>();
      statuses.push({ operationId, reply });
      return reply.promise;
    },
    setScenario: () => undefined,
    getScenario: () => "success",
    reset: () => undefined,
  };
  return { service, publishes, statuses, announcements };
}

function loggingJournal(log: string[], base: Journal = createJournal(sessionStorage)): Journal {
  return {
    ...base,
    add: (entry) => {
      log.push(`journal.add:${entry.operationId}`);
      return base.add(entry);
    },
  };
}

/** Lets settled promises run their continuations (real timers only). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Polling is off by default: most tests drive every status read by hand. With `polling: true`
 * the store uses the global (fake) timers and `Date.now()`; see "following".
 */
function setup(options: { journal?: Journal; polling?: boolean } = {}) {
  const log: string[] = [];
  const controlled = controlledService(log);
  let clock = 1_000;
  const store = createPublicationStore({
    service: controlled.service,
    journal: options.journal ?? loggingJournal(log),
    now: options.polling ? () => Date.now() : () => clock,
    timers: options.polling ? browserTimers : inertTimers,
  });
  return {
    ...controlled,
    log,
    store,
    tick: (ms: number) => (clock += ms),
    entry: (id: string): OperationEntry => {
      const found = store.getState().operations[id];
      if (!found) throw new Error(`No entry ${id}`);
      return found;
    },
    view: (announcementId = ANN) => selectView(announcementId)(store.getState()),
  };
}

function lastPublish(publishes: ReturnType<typeof controlledService>["publishes"]) {
  const last = publishes.at(-1);
  if (!last) throw new Error("No publish call");
  return last;
}

describe("publish", () => {
  it("writes the journal entry before calling service.publish", () => {
    const { store, log } = setup();

    const id = store.getState().publish(ANN);

    expect(id).toMatch(/^op-/);
    expect(log).toEqual([`journal.add:${String(id)}`, `publish:${String(id)}`]);
    expect(createJournal(sessionStorage).read().entries).toEqual([
      { operationId: id, announcementId: ANN, createdAt: 1_000 },
    ]);
  });

  it("creates an entry with publishInFlight true and shows submitting", () => {
    const { store, entry, view } = setup();

    const id = store.getState().publish(ANN) ?? "";

    expect(entry(id)).toMatchObject({
      announcementId: ANN,
      createdAt: 1_000,
      publishInFlight: true,
      checkInFlight: false,
      epoch: 0,
    });
    expect(view().kind).toBe("submitting");
  });

  it("creates only one operation for two calls in the same tick", () => {
    const { store, publishes } = setup();

    const first = store.getState().publish(ANN);
    const second = store.getState().publish(ANN);

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(Object.keys(store.getState().operations)).toHaveLength(1);
    expect(publishes).toHaveLength(1);
  });

  it("blocks the publish when the journal cannot be written", () => {
    const { store, publishes } = setup({
      journal: { ...createJournal(sessionStorage), add: () => false },
    });

    expect(store.getState().publish(ANN)).toBeUndefined();

    expect(publishes).toHaveLength(0);
    expect(store.getState().operations).toEqual({});
    expect(store.getState().publishBlocked).toEqual({ announcementId: ANN, at: 1_000 });

    store.getState().dismissPublishBlocked();
    expect(store.getState().publishBlocked).toBeNull();
  });

  it("merges the reply, clears publishInFlight and bumps checkSeq", async () => {
    const { store, publishes, entry, view } = setup();
    const id = store.getState().publish(ANN) ?? "";

    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();

    expect(entry(id)).toMatchObject({ publishInFlight: false, checkSeq: 1 });
    expect(entry(id).snapshot).toEqual(snapshot(id, "processing"));
    expect(view()).toMatchObject({ kind: "processing", stale: false });
  });

  it("is refused unless the announcement is idle", async () => {
    const { store, publishes } = setup();
    const id = store.getState().publish(ANN) ?? "";
    lastPublish(publishes).reply.resolve(snapshot(id, "rejected"));
    await flush();

    expect(store.getState().publish(ANN)).toBeUndefined();
    expect(publishes).toHaveLength(1);
  });

  it("keeps announcements independent", () => {
    const { store, publishes } = setup();

    store.getState().publish("ann-101");
    store.getState().publish("ann-102");

    expect(publishes.map((call) => call.announcementId)).toEqual(["ann-101", "ann-102"]);
  });
});

describe("startNewAttempt", () => {
  it("is refused unless the latest attempt was rejected", async () => {
    const { store, publishes } = setup();
    expect(store.getState().startNewAttempt(ANN)).toBeUndefined();

    const id = store.getState().publish(ANN) ?? "";
    expect(store.getState().startNewAttempt(ANN)).toBeUndefined(); // submitting

    lastPublish(publishes).reply.reject(new AnnouncementMockError("RESPONSE_LOST", "r", id));
    await flush();
    expect(store.getState().startNewAttempt(ANN)).toBeUndefined(); // unconfirmed

    expect(publishes).toHaveLength(1);
  });

  it("creates a new operationId with a higher seq after a rejection", async () => {
    const { store, publishes, entry, log } = setup();
    const first = store.getState().publish(ANN) ?? "";
    lastPublish(publishes).reply.resolve(snapshot(first, "rejected"));
    await flush();

    const second = store.getState().startNewAttempt(ANN) ?? "";

    expect(second).not.toBe(first);
    expect(entry(second).seq).toBeGreaterThan(entry(first).seq);
    expect(log.slice(-2)).toEqual([`journal.add:${second}`, `publish:${second}`]);
    expect(selectView(ANN)(store.getState())).toMatchObject({ kind: "submitting" });
    expect(selectAttempts(ANN)(store.getState()).map((op) => op.operationId)).toEqual([
      second,
      first,
    ]);
  });
});

describe("lost response and retrySameAttempt", () => {
  async function lostAttempt() {
    const ctx = setup();
    const id = ctx.store.getState().publish(ANN) ?? "";
    ctx.tick(50);
    lastPublish(ctx.publishes).reply.reject(
      new AnnouncementMockError("RESPONSE_LOST", "req-1", id, ANN),
    );
    await flush();
    return { ...ctx, id };
  }

  it("records the lost response as unconfirmed, never failed", async () => {
    const { entry, id, view } = await lostAttempt();

    expect(entry(id)).toMatchObject({
      publishInFlight: false,
      lastError: { kind: "response-lost", at: 1_050 },
    });
    expect(entry(id).snapshot).toBeUndefined();
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });
  });

  it("retries with the SAME operationId and stays unconfirmed while in flight", async () => {
    const { store, publishes, id, entry, view } = await lostAttempt();

    expect(store.getState().retrySameAttempt(id)).toBe(true);

    expect(publishes).toHaveLength(2);
    expect(lastPublish(publishes).operationId).toBe(id);
    expect(entry(id).publishInFlight).toBe(true);
    expect(view().kind).toBe("unconfirmed");

    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();

    expect(entry(id).lastError).toBeUndefined();
    expect(view().kind).toBe("processing");
    expect(Object.keys(store.getState().operations)).toEqual([id]);
  });

  it("refuses a second retry while one is in flight", async () => {
    const { store, publishes, id } = await lostAttempt();

    store.getState().retrySameAttempt(id);

    expect(store.getState().retrySameAttempt(id)).toBe(false);
    expect(publishes).toHaveLength(2);
  });

  it("keeps lastError and no snapshot when the retry fails too", async () => {
    const { store, publishes, id, entry } = await lostAttempt();
    store.getState().retrySameAttempt(id);
    lastPublish(publishes).reply.reject(new TypeError("Failed to fetch"));
    await flush();

    expect(entry(id)).toMatchObject({
      publishInFlight: false,
      lastError: { kind: "unexpected" },
    });
  });

  it("refuses to retry an attempt with a snapshot, without an error, or unknown", async () => {
    const { store, publishes, entry } = setup();
    const id = store.getState().publish(ANN) ?? "";
    expect(store.getState().retrySameAttempt(id)).toBe(false); // in flight, no error

    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();
    expect(entry(id).snapshot).toBeDefined();
    expect(store.getState().retrySameAttempt(id)).toBe(false);
    expect(store.getState().retrySameAttempt("op-unknown")).toBe(false);
    expect(publishes).toHaveLength(1);
  });
});

describe("check", () => {
  it("applies a snapshot, sets lastCheckedAt and clears checkInFlight", async () => {
    const { store, publishes, statuses, entry, tick } = setup();
    const id = store.getState().publish(ANN) ?? "";
    lastPublish(publishes).reply.reject(new AnnouncementMockError("RESPONSE_LOST", "r", id));
    await flush();

    const done = store.getState().check(id);
    expect(entry(id)).toMatchObject({ checkInFlight: true, checkSeq: 1 });
    tick(500);
    statuses[0]?.reply.resolve(snapshot(id, "processing"));
    await done;

    expect(entry(id)).toMatchObject({ checkInFlight: false, checkSeq: 2, lastCheckedAt: 1_500 });
    expect(entry(id).lastError).toBeUndefined();
    expect(entry(id).snapshot?.status).toBe("processing");
  });

  it("keeps publishInFlight and checkInFlight independent when they overlap", async () => {
    const { store, publishes, statuses, entry } = setup();
    const id = store.getState().publish(ANN) ?? "";

    const done = store.getState().check(id);
    expect(entry(id)).toMatchObject({ publishInFlight: true, checkInFlight: true });

    statuses[0]?.reply.resolve(snapshot(id, "processing"));
    await done;
    expect(entry(id)).toMatchObject({ publishInFlight: true, checkInFlight: false });

    const again = store.getState().check(id);
    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();
    expect(entry(id)).toMatchObject({ publishInFlight: false, checkInFlight: true });

    statuses[1]?.reply.resolve(snapshot(id, "processing"));
    await again;
    expect(entry(id)).toMatchObject({ publishInFlight: false, checkInFlight: false });
  });

  it("ignores null while the publish request is still in flight", async () => {
    const { store, statuses, entry, view } = setup();
    const id = store.getState().publish(ANN) ?? "";

    const done = store.getState().check(id);
    statuses[0]?.reply.resolve(null);
    await done;

    expect(entry(id).lastError).toBeUndefined();
    expect(entry(id).checkInFlight).toBe(false);
    expect(view().kind).toBe("submitting");
  });

  it("marks null as not-recorded when no publish is in flight (never rejected)", async () => {
    const { store, publishes, statuses, entry, view } = setup();
    const id = store.getState().publish(ANN) ?? "";
    lastPublish(publishes).reply.reject(new AnnouncementMockError("RESPONSE_LOST", "r", id));
    await flush();

    const done = store.getState().check(id);
    statuses[0]?.reply.resolve(null);
    await done;

    expect(entry(id).lastError?.kind).toBe("not-recorded");
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: true });
  });

  it("marks processing as stale when the status read fails, keeping the snapshot", async () => {
    const { store, publishes, statuses, entry, view } = setup();
    const id = store.getState().publish(ANN) ?? "";
    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();

    const done = store.getState().check(id);
    statuses[0]?.reply.reject(new AnnouncementMockError("STATUS_UNAVAILABLE", "r", id));
    await done;

    expect(entry(id)).toMatchObject({
      checkInFlight: false,
      lastError: { kind: "status-unavailable" },
    });
    expect(entry(id).snapshot?.status).toBe("processing");
    expect(view()).toMatchObject({ kind: "processing", stale: true });
  });

  it("drops a check error when a snapshot was applied during the read", async () => {
    const { store, publishes, statuses, entry } = setup();
    const id = store.getState().publish(ANN) ?? "";

    const done = store.getState().check(id);
    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();
    statuses[0]?.reply.reject(new AnnouncementMockError("STATUS_UNAVAILABLE", "r", id));
    await done;

    expect(entry(id).lastError).toBeUndefined();
    expect(entry(id).checkInFlight).toBe(false);
  });

  it("is skipped while a check is in flight and for terminal operations", async () => {
    const { store, publishes, statuses } = setup();
    const id = store.getState().publish(ANN) ?? "";

    void store.getState().check(id);
    void store.getState().check(id);
    expect(statuses).toHaveLength(1);

    statuses[0]?.reply.resolve(snapshot(id, "published"));
    lastPublish(publishes).reply.resolve(snapshot(id, "published"));
    await flush();

    await store.getState().check(id);
    expect(statuses).toHaveLength(1);
    await store.getState().check("op-unknown");
    expect(statuses).toHaveLength(1);
  });

  it("never lets a late v1 overwrite a terminal snapshot", async () => {
    const { store, publishes, statuses, entry } = setup();
    const id = store.getState().publish(ANN) ?? "";

    const done = store.getState().check(id);
    statuses[0]?.reply.resolve(snapshot(id, "published"));
    await done;
    lastPublish(publishes).reply.resolve(snapshot(id, "processing"));
    await flush();

    expect(entry(id).snapshot?.status).toBe("published");
    expect(entry(id).publishInFlight).toBe(false);
  });
});

describe("epoch", () => {
  it("drops publish and check results that settle in a newer epoch", async () => {
    const { store, publishes, statuses, entry } = setup();
    const id = store.getState().publish(ANN) ?? "";
    const done = store.getState().check(id);

    store.setState({ epoch: 1 });
    statuses[0]?.reply.resolve(snapshot(id, "processing"));
    lastPublish(publishes).reply.resolve(snapshot(id, "published"));
    await done;
    await flush();

    expect(entry(id)).toMatchObject({ publishInFlight: true, checkInFlight: true, checkSeq: 1 });
    expect(entry(id).snapshot).toBeUndefined();
  });

  it("drops a loadAnnouncements result from an older epoch", async () => {
    const { store, announcements } = setup();
    const done = store.getState().loadAnnouncements();

    store.setState({ epoch: 1 });
    announcements.resolve([{ id: ANN, title: "T", body: "B" }]);
    await done;

    expect(store.getState().announcements.items).toEqual([]);
  });
});

describe("applySnapshots", () => {
  it("creates entries for unknown operations with createdAt from the snapshot", () => {
    const { store, entry } = setup();
    store.getState().publish("ann-102");

    store
      .getState()
      .applySnapshots([
        snapshot("op-x", "processing", ANN, "2026-03-01T10:00:00.000Z"),
        snapshot("op-y", "published", "ann-103", "2026-03-01T11:00:00.000Z"),
      ]);

    expect(entry("op-x")).toMatchObject({
      announcementId: ANN,
      createdAt: Date.parse("2026-03-01T10:00:00.000Z"),
      publishInFlight: false,
      checkInFlight: false,
      seq: 1,
    });
    expect(entry("op-y").seq).toBe(2);
    expect(deriveAnnouncementView([entry("op-y")]).kind).toBe("published");
  });

  it("merges into known operations with the version rules", () => {
    const { store, entry } = setup();
    store.getState().applySnapshots([snapshot("op-x", "published")]);
    const before = store.getState().operations;

    store.getState().applySnapshots([snapshot("op-x", "processing")]);

    expect(store.getState().operations).toBe(before);
    expect(entry("op-x").snapshot?.status).toBe("published");
  });
});

describe("loadAnnouncements", () => {
  it("loads the announcements", async () => {
    const { store, announcements, log } = setup();
    const items = [{ id: ANN, title: "T", body: "B" }];

    const done = store.getState().loadAnnouncements();
    void store.getState().loadAnnouncements();
    expect(store.getState().announcements.status).toBe("loading");
    expect(log.filter((call) => call === "getAnnouncements")).toHaveLength(1);

    announcements.resolve(items);
    await done;

    expect(store.getState().announcements).toEqual({ status: "ready", items });
  });

  it("reports an error", async () => {
    const { store, announcements } = setup();

    const done = store.getState().loadAnnouncements();
    announcements.reject(new Error("offline"));
    await done;

    expect(store.getState().announcements).toEqual({ status: "error", items: [] });
  });
});

describe("following (status polling)", () => {
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  function pollingSetup() {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = setup({ polling: true });
    const id = ctx.store.getState().publish(ANN) ?? "";
    const status = (index: number) => {
      const call = ctx.statuses[index];
      if (!call) throw new Error(`No getStatus call #${String(index)}`);
      return call;
    };
    return { ...ctx, id, status };
  }

  it("starts at publish(): first read after 1500 ms while the publish is in flight", async () => {
    const { statuses, status, entry, id, view } = pollingSetup();
    expect(entry(id).nextCheckAt).toBe(1_500);

    await advance(1_499);
    expect(statuses).toHaveLength(0);
    await advance(1);
    expect(statuses).toHaveLength(1);
    expect(entry(id)).toMatchObject({ publishInFlight: true, checkInFlight: true });
    expect(entry(id).nextCheckAt).toBeUndefined();

    status(0).reply.resolve(snapshot(id, "processing"));
    await advance(0);
    expect(entry(id).nextCheckAt).toBe(3_000);
    expect(view().kind).toBe("processing");
  });

  it("a manual check during a scheduled read returns the in-flight promise", async () => {
    const { store, statuses, status, entry, id } = pollingSetup();
    await advance(1_500);

    const manual = store.getState().check(id);
    expect(store.getState().check(id)).toBe(manual);
    expect(statuses).toHaveLength(1);

    status(0).reply.resolve(snapshot(id, "processing"));
    await manual;
    expect(entry(id)).toMatchObject({ checkInFlight: false, snapshot: { version: 1 } });
  });

  it("backs off after a failed read and resets after a successful one", async () => {
    const { status, entry, id } = pollingSetup();
    await advance(1_500);

    status(0).reply.reject(new AnnouncementMockError("STATUS_UNAVAILABLE", "r", id));
    await advance(0);
    expect(entry(id).nextCheckAt).toBe(2_500);

    await advance(1_000);
    status(1).reply.resolve(snapshot(id, "processing"));
    await advance(0);
    expect(entry(id).nextCheckAt).toBe(4_000);
  });

  it("stops on not-recorded with no publish in flight; retrySameAttempt follows again", async () => {
    const { store, publishes, statuses, status, entry, id } = pollingSetup();
    lastPublish(publishes).reply.reject(new AnnouncementMockError("RESPONSE_LOST", "r", id));
    await advance(1_500);

    status(0).reply.resolve(null);
    await advance(0);
    expect(entry(id).lastError?.kind).toBe("not-recorded");
    expect(entry(id).nextCheckAt).toBeUndefined();
    await advance(60_000);
    expect(statuses).toHaveLength(1);

    expect(store.getState().retrySameAttempt(id)).toBe(true);
    expect(entry(id).nextCheckAt).toBe(Date.now() + 1_500);
    await advance(1_500);
    expect(statuses).toHaveLength(2);
  });

  it("stops when the publish reply is terminal: no status read is sent", async () => {
    const { publishes, statuses, entry, id, view } = pollingSetup();

    lastPublish(publishes).reply.resolve(snapshot(id, "rejected"));
    await advance(0);
    expect(view().kind).toBe("rejected");
    expect(entry(id).nextCheckAt).toBeUndefined();

    await advance(60_000);
    expect(statuses).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when applySnapshots brings a terminal snapshot", async () => {
    const { store, statuses, entry, id } = pollingSetup();

    store.getState().applySnapshots([snapshot(id, "published")]);
    expect(entry(id).nextCheckAt).toBeUndefined();

    await advance(60_000);
    expect(statuses).toHaveLength(0);
  });
});

describe("with the supplied mock service", () => {
  function mockSetup(scenario: Parameters<IAnnouncementService["setScenario"]>[0]) {
    vi.useFakeTimers();
    const service = createAnnouncementMock();
    service.setScenario(scenario);
    const store: PublicationStoreApi = createPublicationStore({
      service,
      journal: createJournal(sessionStorage),
      now: () => Date.now(),
    });
    const view = () => selectView(ANN)(store.getState());
    return { service, store, view };
  }

  it("success: publish, then check until published", async () => {
    const { store, view } = mockSetup("success");
    const id = store.getState().publish(ANN) ?? "";

    await vi.advanceTimersByTimeAsync(200);
    expect(view().kind).toBe("processing");

    await vi.advanceTimersByTimeAsync(2_500);
    const done = store.getState().check(id);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(view()).toMatchObject({ kind: "published" });
  });

  it("explicit-rejection: a new attempt gets a new operationId", async () => {
    const { store, view, service } = mockSetup("explicit-rejection");
    const first = store.getState().publish(ANN) ?? "";
    await vi.advanceTimersByTimeAsync(200);
    expect(view()).toMatchObject({ kind: "rejected" });

    const second = store.getState().startNewAttempt(ANN) ?? "";
    await vi.advanceTimersByTimeAsync(200);

    expect(second).not.toBe(first);
    const operations = service.listOperations();
    await vi.advanceTimersByTimeAsync(200);
    expect((await operations).map((op) => op.operationId)).toEqual([first, second]);
  });

  it("lost-response: unconfirmed, then a retry with the same ID creates no duplicate", async () => {
    const { store, view, service } = mockSetup("lost-response");
    const id = store.getState().publish(ANN) ?? "";
    await vi.advanceTimersByTimeAsync(200);
    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });

    store.getState().retrySameAttempt(id);
    await vi.advanceTimersByTimeAsync(200);
    expect(view().kind).toBe("processing");

    const operations = service.listOperations();
    await vi.advanceTimersByTimeAsync(200);
    expect((await operations).map((op) => op.operationId)).toEqual([id]);
  });

  it("status-check-failure: a failed status read never means rejected", async () => {
    const { store, view } = mockSetup("status-check-failure");
    const id = store.getState().publish(ANN) ?? "";
    await vi.advanceTimersByTimeAsync(200);

    let done = store.getState().check(id);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(view()).toMatchObject({ kind: "unconfirmed" });

    done = store.getState().check(id);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(view()).toMatchObject({ kind: "processing", stale: false });
  });
});
