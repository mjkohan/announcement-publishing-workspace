import { useId, type ReactNode } from "react";
import { usePublicationStore } from "../../app/hooks";
import {
  assertNever,
  type AnnouncementView,
  type AnnouncementViewKind,
  type OperationEntry,
} from "../../domain";
import { selectView } from "../../store";
import { Banner, cx, RelativeTime } from "../../ui";

interface StatusContent {
  title: string;
  description: ReactNode;
  /** Shown below the description. */
  details?: ReactNode;
}

const ACCENT_CLASSES: Record<AnnouncementViewKind, string> = {
  idle: "border-l-status-idle",
  checking: "border-l-status-idle",
  submitting: "border-l-status-submitting",
  processing: "border-l-status-processing",
  published: "border-l-status-published",
  rejected: "border-l-status-rejected",
  unconfirmed: "border-l-status-unconfirmed",
};

function contentFor(view: AnnouncementView): StatusContent {
  switch (view.kind) {
    case "idle":
      return {
        title: "Not submitted",
        description: "This announcement hasn't been sent to the publishing service yet.",
      };
    case "checking":
      return {
        title: "Checking status…",
        description: "Looking up this attempt with the publishing service.",
      };
    case "submitting":
      return {
        title: "Sending…",
        description: "Submitting to the publishing service.",
      };
    case "processing":
      return {
        title: "Processing",
        description:
          "The service accepted this announcement and is publishing it. Use “Check status” to see if it has finished.",
        ...(view.stale && { details: <StaleWarning op={view.op} /> }),
      };
    case "published":
      return {
        title: "Published",
        description: (
          <>
            Publication confirmed <RelativeTime value={view.op.snapshot.publishedAt} />.
          </>
        ),
        details: (
          <dl className="text-sm">
            <dt className="text-slate-600 dark:text-slate-400">Publication ID</dt>
            <dd className="font-mono break-all">{view.op.snapshot.publicationId}</dd>
          </dl>
        ),
      };
    case "rejected":
      return {
        title: "Rejected",
        description: "The service declined this announcement:",
        details: (
          <blockquote className="border-l-2 border-slate-300 pl-3 text-sm break-words italic dark:border-slate-600">
            {view.reason}
          </blockquote>
        ),
      };
    case "unconfirmed":
      return view.notRecorded
        ? {
            title: "Not received by the service",
            description: "The service has no record of this attempt. You can safely resend it.",
          }
        : {
            title: "Outcome unknown",
            description:
              "We lost contact with the service, so we can't confirm whether this was published. Checking or retrying won't create a duplicate.",
          };
    default:
      return assertNever(view);
  }
}

/** The last status read failed while processing. */
function StaleWarning({ op }: { op: OperationEntry }) {
  return (
    <Banner tone="warning" live={false}>
      Couldn&apos;t refresh status. Showing the last known status — this doesn&apos;t mean
      publication failed.
      {op.checkInFlight ? " Checking again…" : " Use “Check status” to try again."}
    </Banner>
  );
}

export interface PublicationStatusCardProps {
  announcementId: string;
}

/** Publication status of one announcement, derived from its operations. */
export function PublicationStatusCard({ announcementId }: PublicationStatusCardProps) {
  const view = usePublicationStore(selectView(announcementId));
  const headingId = useId();
  const { title, description, details } = contentFor(view);
  const lastCheckedAt = view.kind === "idle" ? undefined : view.op.lastCheckedAt;

  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        "space-y-3 rounded-md border border-l-4 border-slate-200 p-4 dark:border-slate-800",
        ACCENT_CLASSES[view.kind],
      )}
    >
      <h3
        id={headingId}
        className="text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400"
      >
        Publication status
      </h3>

      {/* Not a live region: the badge and this card show status changes visually. */}
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-sm break-words">{description}</p>
      {details}

      {lastCheckedAt !== undefined && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Last checked <RelativeTime value={lastCheckedAt} />
        </p>
      )}
    </section>
  );
}
