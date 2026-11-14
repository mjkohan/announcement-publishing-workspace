import { usePublicationActions, usePublicationStore } from "../../app/hooks";
import { Banner, Button, Skeleton } from "../../ui";

const SKELETON_ROWS = 3;

export function AnnouncementList() {
  const status = usePublicationStore((state) => state.announcements.status);
  const items = usePublicationStore((state) => state.announcements.items);
  const { loadAnnouncements } = usePublicationActions();

  if (status === "error") {
    return (
      <Banner
        tone="error"
        action={
          <Button variant="secondary" onClick={() => void loadAnnouncements()}>
            Try again
          </Button>
        }
      >
        Couldn&apos;t load announcements.
      </Banner>
    );
  }

  if (status !== "ready") {
    return (
      <div aria-busy="true">
        <p className="sr-only">Loading announcements…</p>
        <ul className="space-y-2" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-11" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No announcements.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((announcement) => (
        <li
          key={announcement.id}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm break-words dark:border-slate-800"
        >
          {announcement.title}
        </li>
      ))}
    </ul>
  );
}
