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

// Any console.error or console.warn fails the test that caused it (React act() warnings, key
// warnings, unexpected logs). A test that expects a log replaces the method with its own spy,
// so its calls never reach these recorders.
const consoleCalls: string[] = [];
function recorder(level: string, original: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    consoleCalls.push(`console.${level}: ${args.map(String).join(" ")}`);
    original(...args);
  };
}
console.error = recorder("error", console.error.bind(console));
console.warn = recorder("warn", console.warn.bind(console));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  const calls = consoleCalls.splice(0);
  if (calls.length > 0) {
    throw new Error(`Unexpected console output during the test:\n${calls.join("\n")}`);
  }
});
