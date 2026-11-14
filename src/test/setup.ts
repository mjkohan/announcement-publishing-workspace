import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { installDialogPolyfill } from "./dialogPolyfill";

// jsdom 31 has no `showModal()`, `close()` or `returnValue` on <dialog>. The stub lives in
// ./dialogPolyfill; the real dialog behavior is covered by e2e.
installDialogPolyfill();

// Testing Library detects fake timers only through a global `jest`: after every user-event
// call it waits on `setTimeout(0)` and advances `jest` timers, else that wait never ends
// under Vitest fake timers. This shim forwards to `vi`; it changes nothing with real timers.
Object.defineProperty(globalThis, "jest", {
  configurable: true,
  value: {
    advanceTimersByTime: (ms: number) => {
      vi.advanceTimersByTime(ms);
    },
  },
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
});
