import type { Timers } from "../store/scheduler";

/** Timers that never fire: turns off status polling for tests that drive every read by hand. */
export const inertTimers: Timers = {
  setTimeout: () => undefined,
  clearTimeout: () => undefined,
};
