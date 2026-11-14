import type { ReactNode } from "react";
import { assertNever, type AnnouncementView, type AnnouncementViewKind } from "../../domain";
import { cx, Spinner } from "../../ui";

const STATUS_LABELS: Record<AnnouncementViewKind, string> = {
  idle: "Not submitted",
  checking: "Checking…",
  submitting: "Sending…",
  processing: "Processing",
  published: "Published",
  rejected: "Rejected",
  unconfirmed: "Outcome unknown",
};

const TONE_CLASSES: Record<AnnouncementViewKind, string> = {
  idle: "bg-status-idle-bg text-status-idle",
  checking: "bg-status-idle-bg text-status-idle",
  submitting: "bg-status-submitting-bg text-status-submitting",
  processing: "bg-status-processing-bg text-status-processing",
  published: "bg-status-published-bg text-status-published",
  rejected: "bg-status-rejected-bg text-status-rejected",
  unconfirmed: "bg-status-unconfirmed-bg text-status-unconfirmed",
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
    >
      {children}
    </svg>
  );
}

function StatusIcon({ kind }: { kind: AnnouncementViewKind }) {
  switch (kind) {
    case "idle":
      return (
        <Icon>
          <circle cx="8" cy="8" r="5.5" />
        </Icon>
      );
    case "checking":
    case "submitting":
      return <Spinner size="sm" className="size-3.5" />;
    case "processing":
      return (
        <Icon>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3l2 1.5" />
        </Icon>
      );
    case "published":
      return (
        <Icon>
          <path d="M3.5 8.5l3 3 6-7" />
        </Icon>
      );
    case "rejected":
      return (
        <Icon>
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </Icon>
      );
    case "unconfirmed":
      return (
        <Icon>
          <path d="M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5" />
          <path d="M8 12h.01" />
        </Icon>
      );
    default:
      return assertNever(kind);
  }
}

export interface StatusBadgeProps {
  view: AnnouncementView;
  className?: string;
}

/** Publication status as icon and text, so it never relies on color alone. */
export function StatusBadge({ view, className }: StatusBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[view.kind],
        className,
      )}
    >
      <StatusIcon kind={view.kind} />
      {STATUS_LABELS[view.kind]}
    </span>
  );
}
