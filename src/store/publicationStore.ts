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
import {
  browserTimers,
  createScheduler,
  documentVisibility,
  type ReadOutcome,
  type Timers,
  type VisibilitySource,
} from "./scheduler";

export interface PublicationStoreDeps {
  service: IAnnouncementService;
  journal: Journal;
  now: () => number;
  /** Timers for status polling. Defaults to the global `setTimeout`/`clearTimeout`. */
  timers?: Timers;
  /** Pauses polling while hidden. Defaults to `document` visibility. */
  visibility?: VisibilitySource;
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
  loadAnnouncements: () => Promise<void>;
  /** Starts the first attempt. Only from "idle". Returns the new operationId, if any. */
  publish: (announcementId: string) => string | undefined;
  /** Starts a new attempt with a new operationId. Only from "rejected". */
  startNewAttempt: (announcementId: string) => string | undefined;
  /**
   * Sends `publish` again with the SAME operationId. Only for an unconfirmed attempt (failed
   * request, no snapshot) with no publish in flight. Returns whether a request was sent.
   */
  retrySameAttempt: (operationId: string) => boolean;
  /**
   * Reads the status of one operation. Skipped for terminal or unknown operations. While a read
   * for this operation is in flight (manual or scheduled), returns that same promise instead of
   * sending a second request.
   */
  check: (operationId: string) => Promise<void>;
  /** Applies snapshots; creates entries for operations the store does not know yet. */
  applySnapshots: (snapshots: readonly PublicationOperation[]) => void;
  dismissPublishBlocked: () => void;
}

export type PublicationStore = PublicationState & PublicationActions;
export type PublicationStoreApi = StoreApi<PublicationStore>;

type EntryUpdate = (entry: OperationEntry) => OperationEntry;

const keep: EntryUpdate = (entry) => entry;

/** One status read in flight. `done` is what `check()` returns; `outcome` feeds the scheduler. */
interface InFlightCheck {
  done: Promise<void>;
  outcome: Promise<ReadOutcome>;
}

const SKIPPED_CHECK: InFlightCheck = {
  done: Promise.resolve(),
  outcome: Promise.resolve("stop"),
};

const isTerminal = (entry: OperationEntry | undefined): boolean => entry?.snapshot?.version === 2;

function withNextCheckAt(entry: OperationEntry, at: number | undefined): OperationEntry {
  if (entry.nextCheckAt === at) return entry;
  if (at !== undefined) return { ...entry, nextCheckAt: at };
  const next = { ...entry };
  delete next.nextCheckAt;
  return next;
}

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
  timers = browserTimers,
  visibility = documentVisibility(),
}: PublicationStoreDeps): PublicationStoreApi {
  return createStore<PublicationStore>()((set, get) => {
    let nextSeq = 0;
    const inFlightChecks = new Map<string, InFlightCheck>();

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
          stopIfTerminal(operationId);
        }
      }
    }

    /**
     * One `getStatus` request. Never called while another read for the same operation is in
     * flight (see `startCheck`). Touches only `checkInFlight`, never `publishInFlight`.
     */
    async function readStatus(operationId: string, entry: OperationEntry): Promise<ReadOutcome> {
      const epoch = get().epoch;
      const seq = entry.checkSeq + 1;
      patch(operationId, (current) => ({ ...current, checkInFlight: true, checkSeq: seq }));

      let result:
        | { kind: "snapshot"; snapshot: PublicationOperation }
        | { kind: "missing" }
        | { kind: "error"; error: unknown };
      try {
        const snapshot = await service.getStatus(operationId);
        result = snapshot ? { kind: "snapshot", snapshot } : { kind: "missing" };
      } catch (error) {
        result = { kind: "error", error };
      }
      inFlightChecks.delete(operationId);
      if (isStale(epoch)) return "stop";

      // Every update below runs on the entry read fresh from state, not on `entry`.
      const current = get().operations[operationId];
      if (!current) return "stop";
      const at = now();
      let next: OperationEntry;
      let outcome: ReadOutcome = "ok";
      if (result.kind === "snapshot") {
        next = { ...withoutError(mergeSnapshot(current, result.snapshot)), lastCheckedAt: at };
      } else if (result.kind === "missing") {
        // `null` = not recorded (yet). Not a rejection. While the publish request is still in
        // flight the service may simply not have answered it yet.
        if (current.publishInFlight || current.checkSeq !== seq) {
          next = current;
        } else {
          next = { ...current, lastError: { kind: "not-recorded", at }, lastCheckedAt: at };
          // Asking again changes nothing. `retrySameAttempt` follows the operation again.
          outcome = "stop";
        }
      } else {
        // A failed status read never means "rejected"; it only marks the data as stale.
        const lastError = { kind: toPublicationError(result.error), at };
        next = current.checkSeq === seq ? { ...current, lastError } : current;
        outcome = "failed";
      }
      patch(operationId, () => ({ ...next, checkInFlight: false }));
      return isTerminal(next) ? "stop" : outcome;
    }

    /** Starts a status read, or joins the one already in flight for this operation. */
    function startCheck(operationId: string): InFlightCheck {
      const existing = inFlightChecks.get(operationId);
      if (existing) return existing;
      const entry = get().operations[operationId];
      if (!entry || isTerminal(entry)) return SKIPPED_CHECK;

      const outcome = readStatus(operationId, entry);
      const check: InFlightCheck = { outcome, done: outcome.then(() => undefined) };
      inFlightChecks.set(operationId, check);
      return check;
    }

    // A future reset/restore must call `scheduler.stopAll()` before following again, so that
    // reads from the old epoch (which return "stop") cannot end the new following.
    const scheduler = createScheduler({
      read: (operationId) => startCheck(operationId).outcome,
      onSchedule: (operationId, at) => {
        patch(operationId, (current) => withNextCheckAt(current, at));
      },
      now,
      timers,
      visibility,
    });

    /** Follows an unresolved operation. A restored entry ("checking") is read at once. */
    function follow(operationId: string): void {
      const entry = get().operations[operationId];
      if (!entry || isTerminal(entry)) return;
      const restored = !entry.snapshot && !entry.lastError && !entry.publishInFlight;
      scheduler.ensure(operationId, { immediate: restored });
    }

    function stopIfTerminal(operationId: string): void {
      if (isTerminal(get().operations[operationId])) scheduler.stop(operationId);
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
      // Follow from the start: a status read can beat a slow publish response.
      follow(operationId);
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
        // Following may have stopped on "not-recorded"; the retry records the operation again.
        follow(operationId);
        void sendPublish(operationId);
        return true;
      },

      check(operationId) {
        return startCheck(operationId).done;
      },

      applySnapshots(snapshots) {
        for (const snapshot of snapshots) {
          upsertSnapshot(snapshot);
          stopIfTerminal(snapshot.operationId);
        }
      },

      dismissPublishBlocked() {
        set({ publishBlocked: null });
      },
    };
  });
}
