import { createContext } from "react";
import type { IAnnouncementService } from "../mocks";
import type { PublicationStoreApi } from "../store";

export interface PublicationContextValue {
  service: IAnnouncementService;
  store: PublicationStoreApi;
}

export const PublicationContext = createContext<PublicationContextValue | null>(null);
