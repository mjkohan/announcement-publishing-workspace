import type { Timers } from "../store/timers";

/** Timers that never fire: restore retry waits never end in tests that drive every step by hand. */
export const inertTimers: Timers = {
  setTimeout: () => undefined,
  clearTimeout: () => undefined,
};
