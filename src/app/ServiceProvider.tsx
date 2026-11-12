import { useState, type ReactNode } from "react";
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

  return <PublicationContext value={value}>{children}</PublicationContext>;
}
