import { usePublicationStore } from "../../app/hooks";
import { LiveRegion } from "../../ui";

/**
 * The one global live region for publication status changes. The store detects transitions
 * (`watchStatusTransitions`); this only renders the latest message.
 */
export function StatusLiveRegion() {
  const message = usePublicationStore((state) => state.liveAnnouncement);
  return <LiveRegion message={message} />;
}
