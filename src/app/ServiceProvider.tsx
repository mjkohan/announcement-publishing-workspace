import { useEffect, useState, type ReactNode } from "react";
import type { IAnnouncementService } from "../mocks";
import { createJournal } from "../persistence/journal";
import { createPublicationStore } from "../store";
import { PublicationContext, type PublicationContextValue } from "./context";

export interface ServiceProviderProps {
  service: IAnnouncementService;
  /** Where the app journal lives. Defaults to `sessionStorage`. */
  storage?: Storage;
  children: ReactNode;
}

/**
 * Creates the journal and the store once per mount and provides them with the service.
 * `service` and `storage` are read at mount only; later prop changes are ignored.
 */
export function ServiceProvider({ service, storage, children }: ServiceProviderProps) {
  // The initializer is side-effect free (no service call, no storage access): StrictMode may
  // run it twice in development, and React keeps a single result for every render.
  const [value] = useState<PublicationContextValue>(() => ({
    service,
    store: createPublicationStore({
      service,
      journal: createJournal(storage ?? globalThis.sessionStorage),
      now: () => Date.now(),
    }),
  }));

  // `connect()` runs the refresh recovery (once per store) and resumes following; `disconnect()`
  // stops all polling on unmount. StrictMode's connect, disconnect, connect still sends one
  // `listOperations` and ends connected. The work itself (service calls, timers) stays in the store.
  useEffect(() => {
    const { connect, disconnect } = value.store.getState();
    connect();
    return disconnect;
  }, [value]);

  return <PublicationContext value={value}>{children}</PublicationContext>;
}
