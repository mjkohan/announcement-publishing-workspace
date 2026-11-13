import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  browserTimers,
  createScheduler,
  documentVisibility,
  POLL_DELAY_MS,
  type ReadOutcome,
  type VisibilitySource,
} from "./scheduler";

const OP = "op-1";

function manualVisibility() {
  let hidden = false;
  const listeners = new Set<() => void>();
  const source: VisibilitySource = {
    isHidden: () => hidden,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
  return {
    source,
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup() {
  const visibility = manualVisibility();
  /** Read times (fake clock) per operation, in call order. */
  const reads: { operationId: string; at: number }[] = [];
  let reply: (operationId: string) => Promise<ReadOutcome> = () => Promise.resolve("ok");
  const read = vi.fn((operationId: string) => {
    reads.push({ operationId, at: Date.now() });
    return reply(operationId);
  });
  /** Last `nextCheckAt` reported per operation. */
  const nextCheckAt = new Map<string, number | undefined>();
  const onSchedule = vi.fn((operationId: string, at: number | undefined) => {
    nextCheckAt.set(operationId, at);
  });
  const scheduler = createScheduler({
    read,
    onSchedule,
    now: () => Date.now(),
    timers: browserTimers,
    visibility: visibility.source,
  });
  return {
    scheduler,
    visibility,
    read,
    onSchedule,
    nextCheckAt,
    readTimes: (operationId = OP) =>
      reads.filter((call) => call.operationId === operationId).map((call) => call.at),
    setReply: (next: (operationId: string) => Promise<ReadOutcome>) => {
      reply = next;
    },
    /** Replies with these outcomes in order, then with the last one forever. */
    replySequence: (...outcomes: ReadOutcome[]) => {
      let index = 0;
      reply = () => Promise.resolve(outcomes[Math.min(index++, outcomes.length - 1)] ?? "ok");
    },
  };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("backoffDelay", () => {
  it("doubles from 1 s and caps at 10 s", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(backoffDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000,
    ]);
  });
});

describe("createScheduler", () => {
  it("reads first after exactly 1500 ms and reports nextCheckAt", async () => {
    const { scheduler, read, nextCheckAt } = setup();

    scheduler.ensure(OP);
    expect(nextCheckAt.get(OP)).toBe(POLL_DELAY_MS);

    await advance(1_499);
    expect(read).not.toHaveBeenCalled();

    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(OP);
    // After a successful read, the next one is 1500 ms later.
    expect(nextCheckAt.get(OP)).toBe(3_000);
  });

  it("backs off 1 s, 2 s, 4 s, 8 s, then 10 s after failed reads", async () => {
    const { scheduler, readTimes, nextCheckAt, replySequence } = setup();
    replySequence("failed");

    scheduler.ensure(OP);
    await advance(36_500);

    expect(readTimes()).toEqual([1_500, 2_500, 4_500, 8_500, 16_500, 26_500, 36_500]);
    expect(nextCheckAt.get(OP)).toBe(46_500);
  });

  it("resets the backoff after a successful read", async () => {
    const { scheduler, readTimes, replySequence } = setup();
    replySequence("failed", "failed", "ok", "failed", "ok");

    scheduler.ensure(OP);
    await advance(10_000);

    // 1.5 s, +1 s (fail), +2 s (fail), +1.5 s (ok), +1 s (fail), +1.5 s (ok)...
    expect(readTimes().slice(0, 6)).toEqual([1_500, 2_500, 4_500, 6_000, 7_000, 8_500]);
  });

  it("counts a rejected read as a failure", async () => {
    const { scheduler, readTimes, setReply } = setup();
    setReply(() => Promise.reject(new Error("boom")));

    scheduler.ensure(OP);
    await advance(4_500);

    expect(readTimes()).toEqual([1_500, 2_500, 4_500]);
  });

  it("ensure is idempotent: one timer and one read per operation", async () => {
    const { scheduler, read } = setup();

    scheduler.ensure(OP);
    await advance(500);
    scheduler.ensure(OP);
    scheduler.ensure(OP);

    await advance(1_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("follows operations independently", async () => {
    const { scheduler, readTimes, setReply } = setup();
    setReply((operationId) => Promise.resolve(operationId === "op-2" ? "failed" : "ok"));

    scheduler.ensure(OP);
    await advance(500);
    scheduler.ensure("op-2");
    await advance(3_500);

    expect(readTimes(OP)).toEqual([1_500, 3_000]);
    expect(readTimes("op-2")).toEqual([2_000, 3_000]);
  });

  it("reads at once with immediate (restored entries)", () => {
    const { scheduler, read, nextCheckAt } = setup();

    scheduler.ensure(OP, { immediate: true });

    expect(read).toHaveBeenCalledTimes(1);
    expect(nextCheckAt.get(OP)).toBeUndefined();
  });

  it("stops when a read returns stop (terminal snapshot)", async () => {
    const { scheduler, read, onSchedule, replySequence } = setup();
    replySequence("ok", "stop");

    scheduler.ensure(OP);
    await advance(3_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onSchedule).toHaveBeenLastCalledWith(OP, undefined);

    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    // Stopped, so a new ensure follows again.
    scheduler.ensure(OP);
    await advance(1_500);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("stop and stopAll clear pending timers and nextCheckAt", async () => {
    const { scheduler, read, nextCheckAt } = setup();

    scheduler.ensure(OP);
    scheduler.ensure("op-2");
    scheduler.ensure("op-3");
    scheduler.stop(OP);
    expect(nextCheckAt.get(OP)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(2);

    scheduler.stopAll();
    expect(nextCheckAt.get("op-2")).toBeUndefined();
    expect(nextCheckAt.get("op-3")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    await advance(60_000);
    expect(read).not.toHaveBeenCalled();
  });

  it("drops the result of a read that was in flight when stopped", async () => {
    const { scheduler, read, setReply } = setup();
    const reply = deferred<ReadOutcome>();
    setReply(() => reply.promise);

    scheduler.ensure(OP);
    await advance(1_500);
    scheduler.stop(OP);
    reply.resolve("ok");
    await advance(60_000);

    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("visibility", () => {
    it("pauses while hidden and reads every operation at once when visible", async () => {
      const { scheduler, visibility, readTimes, nextCheckAt } = setup();
      scheduler.ensure(OP);
      scheduler.ensure("op-2");

      visibility.setHidden(true);
      await advance(30_000);
      expect(readTimes(OP)).toEqual([]);
      expect(readTimes("op-2")).toEqual([]);
      expect(nextCheckAt.get(OP)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);

      visibility.setHidden(false);
      expect(readTimes(OP)).toEqual([30_000]);
      expect(readTimes("op-2")).toEqual([30_000]);

      await advance(1_500);
      expect(readTimes(OP)).toEqual([30_000, 31_500]);
    });

    it("reads at once on visible even when a timer is still pending", async () => {
      const { scheduler, visibility, readTimes } = setup();
      scheduler.ensure(OP);
      await advance(500);

      visibility.setHidden(true);
      visibility.setHidden(false);
      expect(readTimes()).toEqual([500]);

      // The old timer was replaced, not kept.
      await advance(1_500);
      expect(readTimes()).toEqual([500, 2_000]);
    });

    it("never starts a second read while one is in flight", async () => {
      const { scheduler, visibility, read, setReply } = setup();
      const reply = deferred<ReadOutcome>();
      setReply(() => reply.promise);
      scheduler.ensure(OP);
      await advance(1_500);

      visibility.setHidden(true);
      visibility.setHidden(false);
      expect(read).toHaveBeenCalledTimes(1);

      reply.resolve("ok");
      await advance(1_500);
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("parks an immediate read while hidden", () => {
      const { scheduler, visibility, read } = setup();
      visibility.setHidden(true);

      scheduler.ensure(OP, { immediate: true });
      expect(read).not.toHaveBeenCalled();

      visibility.setHidden(false);
      expect(read).toHaveBeenCalledTimes(1);
    });

    it("subscribes on the first ensure and unsubscribes when nothing is followed", () => {
      const { scheduler, visibility } = setup();
      expect(visibility.listenerCount()).toBe(0);

      scheduler.ensure(OP);
      scheduler.ensure("op-2");
      expect(visibility.listenerCount()).toBe(1);

      scheduler.stop(OP);
      expect(visibility.listenerCount()).toBe(1);
      scheduler.stopAll();
      expect(visibility.listenerCount()).toBe(0);
    });
  });
});

describe("documentVisibility", () => {
  it("reads document.hidden and listens to visibilitychange", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const source = documentVisibility(document);
    const onChange = vi.fn();

    expect(source.isHidden()).toBe(true);
    const unsubscribe = source.subscribe(onChange);
    document.dispatchEvent(new Event("visibilitychange"));
    unsubscribe();
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onChange).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });

  it("is always visible without a document", () => {
    const source = documentVisibility(null);
    const unsubscribe = source.subscribe(() => undefined);

    expect(source.isHidden()).toBe(false);
    expect(unsubscribe).not.toThrow();
  });
});
