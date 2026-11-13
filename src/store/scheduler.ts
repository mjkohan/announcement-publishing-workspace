/**
 * Follows unresolved operations with one `setTimeout` loop per operationId (never `setInterval`).
 *
 * - Normal delay: 1500 ms. After a failed read: 1 s, 2 s, 4 s, 8 s, then 10 s; reset by a
 *   successful read.
 * - Pauses while the document is hidden. On "visible", every followed operation is read at once.
 * - Reports the time of the next read through `onSchedule`, so the UI can say "Retrying in 4s".
 *
 * Owns no app state and makes no service call itself: the store passes `read`, which is the
 * store's deduplicated status read.
 */

/** Result of one status read, as seen by the scheduler. */
export type ReadOutcome =
  /** The read succeeded and the operation is still unresolved. */
  | "ok"
  /** The read failed. Back off. */
  | "failed"
  /** Following is pointless: terminal snapshot, operation not recorded, unknown, or stale. */
  | "stop";

export interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface VisibilitySource {
  isHidden: () => boolean;
  /** Returns the unsubscribe function. */
  subscribe: (onChange: () => void) => () => void;
}

export interface SchedulerDeps {
  read: (operationId: string) => Promise<ReadOutcome>;
  /** `undefined`: no read is planned (reading, paused, or stopped). */
  onSchedule: (operationId: string, nextCheckAt: number | undefined) => void;
  now: () => number;
  timers: Timers;
  visibility: VisibilitySource;
}

export interface Scheduler {
  /** Starts following. Idempotent: no-op when the operation is already followed. */
  ensure: (operationId: string, options?: { immediate?: boolean }) => void;
  stop: (operationId: string) => void;
  stopAll: () => void;
}

export const POLL_DELAY_MS = 1_500;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 10_000;

/** Delay after `failures` consecutive failed reads (1 or more): 1 s, 2 s, 4 s, 8 s, capped at 10 s. */
export function backoffDelay(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

/** Global timers, resolved at call time so test fake timers installed later still apply. */
export const browserTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

const ALWAYS_VISIBLE: VisibilitySource = {
  isHidden: () => false,
  subscribe: () => () => undefined,
};

/** Visibility of a document. Without a document (`null`, non-browser), always visible. */
export function documentVisibility(
  doc: Document | null = typeof document === "undefined" ? null : document,
): VisibilitySource {
  if (!doc) return ALWAYS_VISIBLE;
  return {
    isHidden: () => doc.hidden,
    subscribe: (onChange) => {
      doc.addEventListener("visibilitychange", onChange);
      return () => {
        doc.removeEventListener("visibilitychange", onChange);
      };
    },
  };
}

interface Followed {
  /** Pending timer handle; `undefined` while reading, paused, or right after creation. */
  timer: unknown;
  /** Consecutive failed reads. */
  failures: number;
  reading: boolean;
}

export function createScheduler({
  read,
  onSchedule,
  now,
  timers,
  visibility,
}: SchedulerDeps): Scheduler {
  const followed = new Map<string, Followed>();
  let unsubscribe: (() => void) | undefined;

  function clearTimer(record: Followed): void {
    if (record.timer === undefined) return;
    timers.clearTimeout(record.timer);
    record.timer = undefined;
  }

  // No jitter on purpose: one client and at most three operations, nothing to de-synchronize.
  function schedule(operationId: string, record: Followed, delay: number): void {
    clearTimer(record);
    record.timer = timers.setTimeout(() => {
      record.timer = undefined;
      void run(operationId);
    }, delay);
    onSchedule(operationId, now() + delay);
  }

  async function run(operationId: string): Promise<void> {
    const record = followed.get(operationId);
    if (!record || record.reading) return;
    clearTimer(record);
    onSchedule(operationId, undefined);
    // Hidden: park without a timer. The "visible" event reads it again.
    if (visibility.isHidden()) return;

    record.reading = true;
    let outcome: ReadOutcome;
    try {
      outcome = await read(operationId);
    } catch {
      outcome = "failed";
    }
    // Stopped (or stopped and followed again) during the read: this result is dropped.
    if (followed.get(operationId) !== record) return;
    record.reading = false;

    if (outcome === "stop") {
      stop(operationId);
    } else if (outcome === "failed") {
      record.failures += 1;
      schedule(operationId, record, backoffDelay(record.failures));
    } else {
      record.failures = 0;
      schedule(operationId, record, POLL_DELAY_MS);
    }
  }

  function onVisibilityChange(): void {
    if (visibility.isHidden()) return;
    for (const [operationId, record] of followed) {
      if (!record.reading) void run(operationId);
    }
  }

  function stop(operationId: string): void {
    const record = followed.get(operationId);
    if (!record) return;
    clearTimer(record);
    followed.delete(operationId);
    onSchedule(operationId, undefined);
    if (followed.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = undefined;
    }
  }

  return {
    ensure(operationId, options = {}) {
      if (followed.has(operationId)) return;
      const record: Followed = { timer: undefined, failures: 0, reading: false };
      followed.set(operationId, record);
      // Subscribed lazily, so creating the scheduler has no side effect.
      unsubscribe ??= visibility.subscribe(onVisibilityChange);
      if (options.immediate) void run(operationId);
      else schedule(operationId, record, POLL_DELAY_MS);
    },

    stop,

    stopAll() {
      for (const operationId of [...followed.keys()]) stop(operationId);
    },
  };
}
