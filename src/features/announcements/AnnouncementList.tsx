import { usePublicationActions, usePublicationStore } from "../../app/hooks";
import type { IAnnouncement } from "../../mocks";
import { selectView } from "../../store";
import { Banner, Button, cx, Skeleton } from "../../ui";
import { StatusBadge } from "./StatusBadge";

const SKELETON_ROWS = 3;

export function AnnouncementList() {
  const status = usePublicationStore((state) => state.announcements.status);
  const items = usePublicationStore((state) => state.announcements.items);
  const selectedId = usePublicationStore((state) => state.selectedId);
  const { loadAnnouncements, selectAnnouncement } = usePublicationActions();

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
        <li key={announcement.id}>
          <AnnouncementItem
            announcement={announcement}
            selected={announcement.id === selectedId}
            onSelect={selectAnnouncement}
          />
        </li>
      ))}
    </ul>
  );
}

interface AnnouncementItemProps {
  announcement: IAnnouncement;
  selected: boolean;
  onSelect: (announcementId: string) => void;
}

/**
 * Plain button in the normal Tab order (no arrow keys: that belongs to a listbox with roving
 * tabindex). Its status is derived for this announcement whether it is selected or not.
 */
function AnnouncementItem({ announcement, selected, onSelect }: AnnouncementItemProps) {
  const view = usePublicationStore(selectView(announcement.id));

  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        onSelect(announcement.id);
      }}
      className={cx(
        "flex w-full flex-col items-start gap-1.5 rounded-md border px-3 py-2 text-left text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        selected
          ? "border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
          : "border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900",
      )}
    >
      <span className="min-w-0 font-medium break-words">{announcement.title}</span>
      <StatusBadge view={view} />
    </button>
  );
}
