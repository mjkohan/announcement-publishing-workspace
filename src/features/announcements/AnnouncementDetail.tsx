import { useId } from "react";
import { usePublicationStore } from "../../app/hooks";
import { PublicationStatusCard } from "./PublicationStatusCard";

/** The selected announcement: title, id, full body and its publication status. */
export function AnnouncementDetail() {
  const announcement = usePublicationStore((state) =>
    state.announcements.items.find((item) => item.id === state.selectedId),
  );
  const headingId = useId();

  if (!announcement) {
    return (
      <>
        <h2 className="text-lg font-semibold">Details</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Select an announcement to see its details.
        </p>
      </>
    );
  }

  return (
    <article aria-labelledby={headingId} className="space-y-4">
      <header className="space-y-1">
        <h2 id={headingId} className="text-xl font-semibold break-words">
          {announcement.title}
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          ID: <span className="font-mono break-all">{announcement.id}</span>
        </p>
      </header>
      <p className="text-sm leading-relaxed break-words whitespace-pre-line">{announcement.body}</p>
      <PublicationStatusCard announcementId={announcement.id} />
    </article>
  );
}
