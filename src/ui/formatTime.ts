export type TimeDirection = "past" | "future";

const UNITS: [limitMs: number, unitMs: number, suffix: string][] = [
  [60_000, 1_000, "s"],
  [3_600_000, 60_000, "m"],
  [86_400_000, 3_600_000, "h"],
  [Number.POSITIVE_INFINITY, 86_400_000, "d"],
];

function amount(diffMs: number, round: (value: number) => number): string {
  for (const [limitMs, unitMs, suffix] of UNITS) {
    if (diffMs < limitMs) return `${String(round(diffMs / unitMs))}${suffix}`;
  }
  return "";
}

/**
 * Short relative text: "3s ago", "5m ago" (past) or "in 4s" (future).
 * A time on the wrong side of `now` (for example a clock that has not ticked yet) is clamped:
 * "just now" for the past, "now" for the future.
 */
export function formatRelativeTime(timeMs: number, nowMs: number, direction: TimeDirection) {
  if (direction === "past") {
    const diff = nowMs - timeMs;
    return diff < 1_000 ? "just now" : `${amount(diff, Math.floor)} ago`;
  }
  const diff = timeMs - nowMs;
  return diff <= 0 ? "now" : `in ${amount(diff, Math.ceil)}`;
}

/** Full localized date and time, for a tooltip. */
export function formatFullDate(timeMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" }).format(
    timeMs,
  );
}
