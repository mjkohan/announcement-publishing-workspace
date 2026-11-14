import { useEffect, useState } from "react";
import { formatFullDate, formatRelativeTime, type TimeDirection } from "./formatTime";

export interface RelativeTimeProps {
  /** A timestamp (ms), an ISO string or a Date. */
  value: number | string | Date;
  /** "past" gives "3s ago", "future" gives "in 3s". Default "past". */
  direction?: TimeDirection;
  /** How often the text refreshes. Default 5 s. */
  updateEveryMs?: number;
  className?: string;
}

function toMs(value: RelativeTimeProps["value"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return value.getTime();
}

/**
 * `<time>` with relative text and the full localized date as its title.
 *
 * Its interval is the one timer allowed in a component: purely presentational, cleared on
 * unmount, and it touches no app state and no service.
 */
export function RelativeTime({ value, ...props }: RelativeTimeProps) {
  const timeMs = toMs(value);
  if (Number.isNaN(timeMs)) return null;
  // A new value remounts the ticker, so its clock starts fresh instead of up to one tick old.
  return <Ticker key={timeMs} timeMs={timeMs} {...props} />;
}

function Ticker({
  timeMs,
  direction = "past",
  updateEveryMs = 5_000,
  className,
}: Omit<RelativeTimeProps, "value"> & { timeMs: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const handle = setInterval(() => {
      setNow(Date.now());
    }, updateEveryMs);
    return () => {
      clearInterval(handle);
    };
  }, [updateEveryMs]);

  return (
    <time
      dateTime={new Date(timeMs).toISOString()}
      title={formatFullDate(timeMs)}
      className={className}
    >
      {formatRelativeTime(timeMs, now, direction)}
    </time>
  );
}
