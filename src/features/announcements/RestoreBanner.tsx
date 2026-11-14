import { usePublicationActions, usePublicationStore } from "../../app/hooks";
import { Banner, Button, Spinner } from "../../ui";

/** Refresh recovery state. The store keeps publishing blocked until restore is "ready". */
export function RestoreBanner() {
  const restoreStatus = usePublicationStore((state) => state.restoreStatus);
  const { retryRestore } = usePublicationActions();

  if (restoreStatus === "ready") return null;

  if (restoreStatus === "degraded") {
    return (
      <Banner
        tone="warning"
        action={
          <Button variant="secondary" onClick={() => void retryRestore()}>
            Retry
          </Button>
        }
      >
        Couldn&apos;t load publication history. Publishing is paused until it loads.
      </Banner>
    );
  }

  return (
    <Banner tone="info" icon={<Spinner size="sm" />}>
      Restoring publication status…
    </Banner>
  );
}
