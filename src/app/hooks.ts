import { use } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { IAnnouncementService } from "../mocks";
import type { PublicationActions, PublicationStore } from "../store";
import { PublicationContext, type PublicationContextValue } from "./context";

function usePublicationContext(hookName: string): PublicationContextValue {
  const value = use(PublicationContext);
  if (!value) throw new Error(`${hookName} must be used inside <ServiceProvider>`);
  return value;
}

/**
 * Subscribes to the store. The selector must return a primitive or a stable reference (for
 * example `selectView(id)` or `selectAttempts(id)`). For new objects or arrays use
 * `usePublicationStoreShallow`.
 */
export function usePublicationStore<T>(selector: (state: PublicationStore) => T): T {
  return useStore(usePublicationContext("usePublicationStore").store, selector);
}

/** Like `usePublicationStore`, but compares the result shallowly (objects and arrays). */
export function usePublicationStoreShallow<T>(selector: (state: PublicationStore) => T): T {
  const { store } = usePublicationContext("usePublicationStoreShallow");
  return useStore(store, useShallow(selector));
}

const pickActions = (state: PublicationStore): PublicationActions => ({
  loadAnnouncements: state.loadAnnouncements,
  restore: state.restore,
  retryRestore: state.retryRestore,
  resetSimulation: state.resetSimulation,
  connect: state.connect,
  disconnect: state.disconnect,
  publish: state.publish,
  startNewAttempt: state.startNewAttempt,
  retrySameAttempt: state.retrySameAttempt,
  check: state.check,
  applySnapshots: state.applySnapshots,
  dismissPublishBlocked: state.dismissPublishBlocked,
  selectAnnouncement: state.selectAnnouncement,
  setScenario: state.setScenario,
});

/** Store actions. The returned object keeps its reference across renders. */
export function usePublicationActions(): PublicationActions {
  const { store } = usePublicationContext("usePublicationActions");
  return useStore(store, useShallow(pickActions));
}

export function useService(): IAnnouncementService {
  return usePublicationContext("useService").service;
}
