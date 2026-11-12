import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createOperationId,
  deriveAnnouncementView,
  mergeSnapshot,
  toPublicationError,
  type AnnouncementViewKind,
  type OperationEntry,
} from "../domain";
import type { IAnnouncement, IAnnouncementService, PublicationOperation } from "../mocks";
import type { Journal } from "../persistence/journal";

export interface PublicationStoreDeps {
  service: IAnnouncementService;
  journal: Journal;
  now: () => number;
}

export interface PublicationState {
  /** Bumped on reset/restore. Async work started in an older epoch drops its result. */
  epoch: number;
  announcements: { status: "idle" | "loading" | "ready" | "error"; items: IAnnouncement[] };
  /** Keyed by operationId. An announcement's status is derived from these, never stored. */
  operations: Record<string, OperationEntry>;
  restore: "idle" | "loading" | "ready" | "degraded";
  /** The journal could not be written, so the publish was not sent. */
  publishBlocked: { announcementId: string; at: number } | null;
}

export interface PublicationActions {
  loadAnnouncements(): Promise<void>;
  /** Starts the first attempt. Only from "idle". Returns the new operationId, if any. */
  publish(announcementId: string): string | undefined;
  /** Starts a new attempt with a new operationId. Only from "rejected". */
  startNewAttempt(announcementId: string): string | undefined;
  /**
   * Sends `publish` again with the SAME operationId. Only for an unconfirmed attempt (failed
   * request, no snapshot) with no publish in flight. Returns whether a request was sent.
   */
  retrySameAttempt(operationId: string): boolean;
  /** Reads the status of one operation. Skipped when terminal or when a read is in flight. */
  check(operationId: string): Promise<void>;
  /** Applies snapshots; creates entries for operations the store does not know yet. */
  applySnapshots(snapshots: readonly PublicationOperation[]): void;
  dismissPublishBlocked(): void;
}

export type PublicationStore = PublicationState & PublicationActions;
export type PublicationStoreApi = StoreApi<PublicationStore>;

type EntryUpdate = (entry: OperationEntry) => OperationEntry;

const keep: EntryUpdate = (entry) => entry;

function withoutError(entry: OperationEntry): OperationEntry {
  if (!entry.lastError) return entry;
  const next = { ...entry };
  delete next.lastError;
  return next;
}

export function createPublicationStore({
  service,
  journal,
  now,
}: PublicationStoreDeps): PublicationStoreApi {
  return createStore<PublicationStore>()((set, get) => {
    let nextSeq = 0;

    const isStale = (epoch: number) => get().epoch !== epoch;

    /** Replaces one entry immutably, reading it fresh from the current state. */
    function patch(operationId: string, update: EntryUpdate): void {
      set((state) => {
        const current = state.operations[operationId];
        if (!current) return state;
        const next = update(current);
        if (next === current) return state;
        return { operations: { ...state.operations, [operationId]: next } };
      });
    }

    function viewKindOf(announcementId: string): AnnouncementViewKind {
      const attempts = Object.values(get().operations).filter(
        (entry) => entry.announcementId === announcementId,
      );
      return deriveAnnouncementView(attempts).kind;
    }

    function entryFromSnapshot(snapshot: PublicationOperation, epoch: number): OperationEntry {
      const parsed = Date.parse(snapshot.createdAt);
      return {
        operationId: snapshot.operationId,
        announcementId: snapshot.announcementId,
        createdAt: Number.isFinite(parsed) ? parsed : now(),
        seq: nextSeq++,
        epoch,
        snapshot,
        publishInFlight: false,
        checkInFlight: false,
        checkSeq: 1,
      };
    }

    function upsertSnapshot(snapshot: PublicationOperation): void {
      set((state) => {
        const current = state.operations[snapshot.operationId];
        const next = current
          ? mergeSnapshot(current, snapshot)
          : entryFromSnapshot(snapshot, state.epoch);
        if (next === current) return state;
        return { operations: { ...state.operations, [snapshot.operationId]: next } };
      });
    }

    /**
     * Shared publish request for first attempts, new attempts and retries. Touches only
     * `publishInFlight`, never `checkInFlight`.
     */
    async function sendPublish(operationId: string): Promise<void> {
      const entry = get().operations[operationId];
      if (!entry) return;
      const epoch = get().epoch;
      patch(operationId, (current) =>
        current.publishInFlight ? current : { ...current, publishInFlight: true },
      );

      let apply = keep;
      try {
        const snapshot = await service.publish(entry.announcementId, operationId);
        apply = (current) => withoutError(mergeSnapshot(current, snapshot));
      } catch (error) {
        // A lost response means "outcome unknown", never "failed". The snapshot is kept.
        const lastError = { kind: toPublicationError(error), at: now() };
        apply = (current) => ({ ...current, lastError });
      } finally {
        if (!isStale(epoch)) {
          patch(operationId, (current) => ({ ...apply(current), publishInFlight: false }));
        }
      }
    }

    /** Creates an attempt. Fully synchronous up to the request, so a double click is a no-op. */
    function beginAttempt(
      announcementId: string,
      allowedFrom: "idle" | "rejected",
    ): string | undefined {
      if (viewKindOf(announcementId) !== allowedFrom) return undefined;

      const operationId = createOperationId();
      const createdAt = now();
      // Write-ahead: the journal entry must exist before the service records the operation.
      if (!journal.add({ operationId, announcementId, createdAt })) {
        set({ publishBlocked: { announcementId, at: createdAt } });
        return undefined;
      }

      const entry: OperationEntry = {
        operationId,
        announcementId,
        createdAt,
        seq: nextSeq++,
        epoch: get().epoch,
        publishInFlight: true,
        checkInFlight: false,
        checkSeq: 0,
      };
      set((state) => ({
        operations: { ...state.operations, [operationId]: entry },
        publishBlocked: null,
      }));
      void sendPublish(operationId);
      return operationId;
    }

    return {
      epoch: 0,
      announcements: { status: "idle", items: [] },
      operations: {},
      restore: "ready",
      publishBlocked: null,

      async loadAnnouncements() {
        if (get().announcements.status === "loading") return;
        const epoch = get().epoch;
        set((state) => ({ announcements: { ...state.announcements, status: "loading" } }));
        try {
          const items = await service.getAnnouncements();
          if (isStale(epoch)) return;
          set({ announcements: { status: "ready", items } });
        } catch {
          if (isStale(epoch)) return;
          set((state) => ({ announcements: { ...state.announcements, status: "error" } }));
        }
      },

      publish(announcementId) {
        return beginAttempt(announcementId, "idle");
      },

      startNewAttempt(announcementId) {
        return beginAttempt(announcementId, "rejected");
      },

      retrySameAttempt(operationId) {
        const entry = get().operations[operationId];
        if (!entry || entry.snapshot || !entry.lastError || entry.publishInFlight) return false;
        void sendPublish(operationId);
        return true;
      },

      async check(operationId) {
        const entry = get().operations[operationId];
        if (!entry || entry.snapshot?.version === 2 || entry.checkInFlight) return;

        const epoch = get().epoch;
        const seq = entry.checkSeq + 1;
        patch(operationId, (current) => ({ ...current, checkInFlight: true, checkSeq: seq }));

        // Every update below runs on the entry read fresh from state, not on `entry`.
        let apply = keep;
        try {
          const snapshot = await service.getStatus(operationId);
          const at = now();
          if (snapshot) {
            apply = (current) => ({
              ...withoutError(mergeSnapshot(current, snapshot)),
              lastCheckedAt: at,
            });
          } else {
            // `null` = not recorded (yet). Not a rejection. While the publish request is still
            // in flight the service may simply not have answered it yet.
            apply = (current) =>
              current.publishInFlight || current.checkSeq !== seq
                ? current
                : { ...current, lastError: { kind: "not-recorded", at }, lastCheckedAt: at };
          }
        } catch (error) {
          // A failed status read never means "rejected"; it only marks the data as stale.
          const lastError = { kind: toPublicationError(error), at: now() };
          apply = (current) => (current.checkSeq === seq ? { ...current, lastError } : current);
        } finally {
          if (!isStale(epoch)) {
            patch(operationId, (current) => ({ ...apply(current), checkInFlight: false }));
          }
        }
      },

      applySnapshots(snapshots) {
        for (const snapshot of snapshots) upsertSnapshot(snapshot);
      },

      dismissPublishBlocked() {
        set({ publishBlocked: null });
      },
    };
  });
}
