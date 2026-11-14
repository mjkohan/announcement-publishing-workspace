import type { ReactNode } from "react";
import { cx } from "./cx";

export type BannerTone = "info" | "warning" | "error";

export interface BannerProps {
  tone?: BannerTone;
  /** Shown before the message, for example a `Spinner`. */
  icon?: ReactNode;
  /** Shown after the message, for example a `Button`. Wraps below it on narrow screens. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BannerTone, string> = {
  info: "border-status-submitting/30 bg-status-submitting-bg text-status-submitting",
  warning: "border-status-processing/30 bg-status-processing-bg text-status-processing",
  error: "border-status-rejected/30 bg-status-rejected-bg text-status-rejected",
};

/** Inline message. "info" is a polite live region (`status`); the other tones are `alert`. */
export function Banner({ tone = "info", icon, action, children, className }: BannerProps) {
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-48 items-start gap-2">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <p className="min-w-0 break-words">{children}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
