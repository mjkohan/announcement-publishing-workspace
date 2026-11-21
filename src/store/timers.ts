/** `setTimeout`/`clearTimeout`, injectable so tests can drive the restore retry waits. */
export interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** Global timers, resolved at call time so test fake timers installed later still apply. */
export const browserTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};
