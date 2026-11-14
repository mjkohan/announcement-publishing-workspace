import { usePublicationStore } from "../../app/hooks";
import { deriveAnnouncementView, type OperationEntry } from "../../domain";
import { selectAttempts } from "../../store";
import { RelativeTime } from "../../ui";
import { StatusBadge } from "./StatusBadge";

const ID_PREFIX = "op-";
const SHORT_ID_LENGTH = 8;

/** "op-3f2a9c1e-…" → "3f2a9c1e…": enough to tell attempts apart. */
function shortId(operationId: string): string {
  const id = operationId.startsWith(ID_PREFIX) ? operationId.slice(ID_PREFIX.length) : operationId;
  return id.length > SHORT_ID_LENGTH ? `${id.slice(0, SHORT_ID_LENGTH)}…` : id;
}

export interface AttemptHistoryProps {
  announcementId: string;
}

/** Every attempt of one announcement, newest first. Renders nothing before the first one. */
export function AttemptHistory({ announcementId }: AttemptHistoryProps) {
  const attempts = usePublicationStore(selectAttempts(announcementId));
  if (attempts.length === 0) return null;

  return (
    <details className="rounded-md border border-slate-200 dark:border-slate-800">
      <summary className="cursor-pointer rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        Attempts ({attempts.length})
      </summary>
      <ol className="divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {attempts.map((attempt) => (
          <AttemptRow key={attempt.operationId} attempt={attempt} />
        ))}
      </ol>
    </details>
  );
}

function AttemptRow({ attempt }: { attempt: OperationEntry }) {
  // The status of this attempt alone, not of the announcement.
  const view = deriveAnnouncementView([attempt]);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <span className="font-mono" title={attempt.operationId}>
        <span className="sr-only">Attempt </span>
        {shortId(attempt.operationId)}
      </span>
      <span className="text-xs text-slate-600 dark:text-slate-400">
        Created <RelativeTime value={attempt.createdAt} />
      </span>
      <StatusBadge view={view} className="ml-auto" />
    </li>
  );
}
