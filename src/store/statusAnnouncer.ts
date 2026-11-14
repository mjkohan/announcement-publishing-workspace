import { assertNever, type AnnouncementView } from "../domain";
import type { PublicationState, PublicationStoreApi } from "./publicationStore";
import { selectView } from "./selectors";

/** Text for the live region when an announcement's status changes to `view`, if any. */
export function describeTransition(title: string, view: AnnouncementView): string | undefined {
  switch (view.kind) {
    case "processing":
      return `${title} is processing.`;
    case "published":
      return `${title} was published.`;
    case "rejected":
      return `${title} was rejected.`;
    case "unconfirmed":
      return view.notRecorded
        ? `${title}: not received by the service.`
        : `${title}: outcome unknown.`;
    // Started by the user (the button shows it) or a lookup in progress: not announced.
    case "idle":
    case "checking":
    case "submitting":
      return undefined;
    default:
      return assertNever(view);
  }
}

/**
 * What counts as a status change. A poll that only refreshes data (same snapshot, a stale
 * flag, a new `lastCheckedAt`) keeps the same key.
 */
function statusKey(view: AnnouncementView): string {
  return view.kind === "unconfirmed" && view.notRecorded ? "unconfirmed:not-recorded" : view.kind;
}

type WatchedState = Pick<PublicationState, "announcements" | "operations">;

function statusKeys(state: WatchedState): Map<string, string> {
  const ids = new Set(state.announcements.items.map((item) => item.id));
  for (const entry of Object.values(state.operations)) ids.add(entry.announcementId);
  const keys = new Map<string, string>();
  for (const id of ids) keys.set(id, statusKey(selectView(id)(state)));
  return keys;
}

/**
 * Subscribes to the store and writes `liveAnnouncement` when any announcement (selected or
 * not) changes status. Until restore is "ready", changes only update the baseline: the
 * history rebuilt after a refresh is not news. Returns the unsubscribe function.
 */
export function watchStatusTransitions(store: PublicationStoreApi): () => void {
  let known = statusKeys(store.getState());
  let nextId = 1;

  return store.subscribe((state, previous) => {
    if (
      state.operations === previous.operations &&
      state.announcements === previous.announcements &&
      state.restoreStatus === previous.restoreStatus
    ) {
      return;
    }

    const current = statusKeys(state);
    const messages: string[] = [];
    if (state.restoreStatus === "ready") {
      for (const [id, key] of current) {
        if ((known.get(id) ?? "idle") === key) continue;
        const title = state.announcements.items.find((item) => item.id === id)?.title ?? id;
        const text = describeTransition(title, selectView(id)(state));
        if (text) messages.push(text);
      }
    }
    known = current;

    if (messages.length > 0) {
      store.setState({ liveAnnouncement: { id: nextId++, text: messages.join(" ") } });
    }
  });
}
