import { describe, expect, it } from "vitest";
import { formatFullDate, formatRelativeTime } from "./formatTime";

const NOW = 1_000_000_000;

describe("formatRelativeTime", () => {
  it.each([
    [0, "just now"],
    [999, "just now"],
    [3_000, "3s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [3_599_999, "59m ago"],
    [3_600_000, "1h ago"],
    [86_400_000 * 2, "2d ago"],
  ])("past, %i ms ago: %s", (agoMs, text) => {
    expect(formatRelativeTime(NOW - agoMs, NOW, "past")).toBe(text);
  });

  it.each([
    [0, "now"],
    [1, "in 1s"],
    [4_000, "in 4s"],
    [3_200, "in 4s"],
    [90_000, "in 2m"],
  ])("future, in %i ms: %s", (inMs, text) => {
    expect(formatRelativeTime(NOW + inMs, NOW, "future")).toBe(text);
  });

  it("clamps a time on the wrong side of now", () => {
    expect(formatRelativeTime(NOW + 2_000, NOW, "past")).toBe("just now");
    expect(formatRelativeTime(NOW - 2_000, NOW, "future")).toBe("now");
  });
});

describe("formatFullDate", () => {
  it("includes the year and the time", () => {
    const text = formatFullDate(Date.UTC(2026, 0, 15, 12, 30, 0));

    expect(text).toMatch(/2026/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});
