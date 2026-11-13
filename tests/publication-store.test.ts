import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationEntry } from "../src/domain";
import {
  createAnnouncementMock,
  type AnnouncementScenario,
  type IAnnouncementService,
  type PublicationOperation,
} from "../src/mocks";
import { createJournal } from "../src/persistence/journal";
import { createPublicationStore, selectAttempts, selectView } from "../src/store";
import { browserTimers } from "../src/store/scheduler";
import { inertTimers } from "../src/test/inertTimers";

const ANN = "ann-101";
const REJECTION_REASON = "This announcement was declined by the publication service.";

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/**
 * Direct service reads also wait on fake timers, so a bare `await` would hang.
 * Note: in "status-check-failure" this consumes one pending STATUS_UNAVAILABLE failure.
 */
async function readOps(service: IAnnouncementService): Promise<PublicationOperation[]> {
  const pending = service.listOperations();
  await advance(100);
  return pending;
}

/** `polling: false` turns off status polling for tests that drive every read by hand. */
function setup(scenario: AnnouncementScenario, { polling = true }: { polling?: boolean } = {}) {
  const service = createAnnouncementMock();
  service.setScenario(scenario);
  const store = createPublicationStore({
    service,
    journal: createJournal(sessionStorage),
    now: () => Date.now(),
    timers: polling ? browserTimers : inertTimers,
  });
  // These tests cover publish and check, not refresh recovery (see tests/restore.test.ts).
  store.setState({ restoreStatus: "ready" });
  const publishSpy = vi.spyOn(service, "publish");

  return {
    service,
    store,
    publishSpy,
    actions: () => store.getState(),
    view: (announcementId = ANN) => selectView(announcementId)(store.getState()),
    entry: (operationId: string): OperationEntry => {
      const found = store.getState().operations[operationId];
      if (!found) throw new Error(`No entry ${operationId}`);
      return found;
    },
    operationCount: () => Object.keys(store.getState().operations).length,
    /** Runs one status check to completion (getStatus replies after 100 ms). */
    checkNow: async (...operationIds: string[]) => {
      const done = operationIds.map((id) => store.getState().check(id));
      await advance(100);
      await Promise.all(done);
    },
  };
}

function published(id: string | undefined): string {
  if (!id) throw new Error("publish() was refused");
  return id;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});

describe("publication store with the supplied mock", () => {
  it("success: submitting, then processing, then published after 2.5 s", async () => {
    const { actions, view, entry, checkNow } = setup("success");

    const id = published(actions().publish(ANN));
    expect(view()).toMatchObject({ kind: "submitting", op: { operationId: id } });

    await advance(120);
    expect(view()).toMatchObject({ kind: "processing", stale: false });
    expect(entry(id)).toMatchObject({ publishInFlight: false, snapshot: { version: 1 } });

    await advance(2_380);
    await checkNow(id);

    const result = view();
    expect(result.kind).toBe("published");
    expect(result.kind === "published" && result.op.snapshot.publicationId).toBe(
      `publication-g1-${id}`,
    );
  });

  // Polling under slow-response: see tests/scenarios.test.ts.

  it("slow-response: a reset before the publish reply makes the late reply change nothing", async () => {
    const { service, store, publishSpy, actions, view, operationCount } = setup("slow-response");
    const statusSpy = vi.spyOn(service, "getStatus");
    published(actions().publish(ANN)); // reply due at 4.5 s

    await advance(1_000);
    const restored = actions().resetSimulation();
    expect(store.getState()).toMatchObject({ epoch: 1, restoreStatus: "loading" });
    expect(store.getState().operations).toEqual({});

    await advance(100); // the new restore lists the (reset) service: no operations
    await restored;
    expect(store.getState().restoreStatus).toBe("ready");
    const afterReset = store.getState().operations;

    await advance(10_000); // the late publish reply settles at 4.5 s
    expect(store.getState().operations).toBe(afterReset);
    expect(operationCount()).toBe(0);
    expect(view().kind).toBe("idle");
    expect(store.getState().epoch).toBe(1);
    expect(createJournal(sessionStorage).read().entries).toEqual([]);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).not.toHaveBeenCalled();
    expect(await readOps(service)).toEqual([]);
  });

  it("explicit-rejection: shows the reason; a new attempt gets a different id", async () => {
    const { service, actions, view, entry } = setup("explicit-rejection");

    const first = published(actions().publish(ANN));
    await advance(120);
    expect(view()).toMatchObject({ kind: "rejected", reason: REJECTION_REASON });

    const second = published(actions().startNewAttempt(ANN));
    expect(second).not.toBe(first);
    expect(entry(second).seq).toBeGreaterThan(entry(first).seq);
    expect(view()).toMatchObject({ kind: "submitting", op: { operationId: second } });

    await advance(120);
    expect(view()).toMatchObject({ kind: "rejected", op: { operationId: second } });

    const operations = await readOps(service);
    expect(operations).toHaveLength(2);
    expect(operations.map((op) => op.operationId)).toEqual([first, second]);
  });

  it("lost-response: unconfirmed, then a same-id retry, then published after 3 s", async () => {
    const { service, publishSpy, actions, view, entry, checkNow } = setup("lost-response");

    const id = published(actions().publish(ANN));
    await advance(120);

    expect(view()).toMatchObject({ kind: "unconfirmed", notRecorded: false });
    expect(entry(id).lastError?.kind).toBe("response-lost");
    expect(entry(id).snapshot).toBeUndefined();

    expect(actions().retrySameAttempt(id)).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(2);
    expect(publishSpy).toHaveBeenLastCalledWith(ANN, id);

    await advance(120);
    expect(view()).toMatchObject({ kind: "processing", op: { operationId: id } });

    const operations = await readOps(service);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.operationId).toBe(id);

    await advance(3_000 - 120 - 120 - 100);
    await checkNow(id);

    expect(view()).toMatchObject({ kind: "published", op: { operationId: id } });
  });

  it("two publish() calls in the same tick make exactly one service call", () => {
    const { publishSpy, actions, operationCount } = setup("success");

    const first = actions().publish(ANN);
    const second = actions().publish(ANN);

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(operationCount()).toBe(1);
  });

  describe("publish() is refused", () => {
    function expectRefused(ctx: ReturnType<typeof setup>) {
      const calls = ctx.publishSpy.mock.calls.length;
      const count = ctx.operationCount();

      expect(ctx.actions().publish(ANN)).toBeUndefined();
      expect(ctx.actions().startNewAttempt(ANN)).toBeUndefined();

      expect(ctx.publishSpy).toHaveBeenCalledTimes(calls);
      expect(ctx.operationCount()).toBe(count);
    }

    it("while submitting", () => {
      const ctx = setup("success");
      ctx.actions().publish(ANN);

      expect(ctx.view().kind).toBe("submitting");
      expectRefused(ctx);
    });

    it("while processing", async () => {
      const ctx = setup("success");
      ctx.actions().publish(ANN);
      await advance(120);

      expect(ctx.view().kind).toBe("processing");
      expectRefused(ctx);
    });

    it("while unconfirmed", async () => {
      const ctx = setup("lost-response");
      ctx.actions().publish(ANN);
      await advance(120);

      expect(ctx.view().kind).toBe("unconfirmed");
      expectRefused(ctx);
    });

    it("after published", async () => {
      const ctx = setup("success");
      const id = published(ctx.actions().publish(ANN));
      await advance(2_500);
      await ctx.checkNow(id);

      expect(ctx.view().kind).toBe("published");
      expectRefused(ctx);
    });
  });

  it("a status error after a confirmed published snapshot keeps the view published", async () => {
    // Polling off: the manual check below must be the first status read.
    const { actions, view, entry } = setup("status-check-failure", { polling: false });

    const id = published(actions().publish(ANN));
    await advance(120);
    expect(view().kind).toBe("unconfirmed");

    // At 3 s the operation is complete. The retry replies with published after 120 ms.
    await advance(3_000 - 120);
    expect(actions().retrySameAttempt(id)).toBe(true);

    // A check that starts during the retry consumes the pending STATUS_UNAVAILABLE.
    await advance(50);
    const check = actions().check(id);
    expect(entry(id)).toMatchObject({ publishInFlight: true, checkInFlight: true });

    await advance(70); // retry reply: published v2
    expect(view().kind).toBe("published");

    await advance(30); // status read fails
    await check;

    expect(view().kind).toBe("published");
    expect(entry(id)).toMatchObject({
      checkInFlight: false,
      publishInFlight: false,
      snapshot: { status: "published", version: 2 },
    });
    // The read started before the snapshot was applied, so its error is dropped (checkSeq).
    expect(entry(id).lastError).toBeUndefined();
  });

  it("results land on the right announcement when two are published at once", async () => {
    const { actions, view, checkNow } = setup("overlapping");

    const slow = published(actions().publish("ann-101")); // 600 ms reply, done at 10 s
    const fast = published(actions().publish("ann-102")); // 80 ms reply, done at 2 s
    expect(slow).not.toBe(fast);

    await advance(80);
    expect(view("ann-102")).toMatchObject({ kind: "processing", op: { operationId: fast } });
    expect(view("ann-101")).toMatchObject({ kind: "submitting", op: { operationId: slow } });

    await advance(520);
    expect(view("ann-101")).toMatchObject({
      kind: "processing",
      op: { operationId: slow, announcementId: "ann-101" },
    });
    expect(view("ann-102")).toMatchObject({
      kind: "processing",
      op: { operationId: fast, announcementId: "ann-102" },
    });

    await advance(1_400); // t = 2 s
    await checkNow(slow, fast);
    expect(view("ann-102")).toMatchObject({
      kind: "published",
      op: { operationId: fast, snapshot: { publicationId: `publication-g1-${fast}` } },
    });
    expect(view("ann-101")).toMatchObject({ kind: "processing", op: { operationId: slow } });

    await advance(10_000 - 2_100);
    await checkNow(slow);
    expect(view("ann-101")).toMatchObject({
      kind: "published",
      op: { operationId: slow, snapshot: { publicationId: `publication-g1-${slow}` } },
    });

    const state = { operations: actions().operations };
    expect(selectAttempts("ann-101")(state)).toHaveLength(1);
    expect(selectAttempts("ann-102")(state)).toHaveLength(1);
    expect(view("ann-103").kind).toBe("idle");
  });
});
