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
  /**
   * Refresh recovery. "idle" until `restore()` runs; "degraded" when the operation list could
   * not be read. New attempts are refused until "ready".
   */
  restoreStatus: "idle" | "loading" | "ready" | "degraded";
  /** The journal could not be written, so the publish was not sent. */
  publishBlocked: { announcementId: string; at: number } | null;
}

export interface PublicationActions {
  loadAnnouncements: () => Promise<void>;
  /**
   * Rebuilds operations from the journal and the service after a refresh. Runs once, only when
   * `restoreStatus` is "idle"; later calls return the running (or a resolved) promise. Never publishes.
   */
  restore: () => Promise<void>;
  /** Runs the restore again. Only when `restoreStatus` is "degraded". */
  retryRestore: () => Promise<void>;
  /**
   * Dev tool: clears the service records, the journal and all operations, starts a new epoch
   * (late results from before are dropped), then restores again. Returns the new restore.
   */
  resetSimulation: () => Promise<void>;
  /**
   * The UI is mounted: runs `restore()` (once) and, if restore is done, follows every unresolved
   * operation again. Pair with `disconnect()`. Safe under StrictMode's effect re-run.
   */
  connect: () => void;
  /**
   * The UI unmounted: stops all polling timers and following. Work in flight settles normally
   * but follows nothing new until `connect()`.
   */
  disconnect: () => void;
  /**
   * Starts the first attempt. Only from "idle" and once restore is "ready". Returns the new
   * operationId, if any.
   */
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

/** Waits before each `listOperations` retry during restore (5 tries in total). */
export const RESTORE_RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 4_000];

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

    function attemptsOf(announcementId: string): OperationEntry[] {
      return Object.values(get().operations).filter(
        (entry) => entry.announcementId === announcementId,
      );
    }

    function viewKindOf(announcementId: string): AnnouncementViewKind {
      return deriveAnnouncementView(attemptsOf(announcementId)).kind;
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
        // The reply carries the state from when the request was sent. It clears an error only
        // when it brings newer data (a first snapshot or a higher version); a same-version or
        // older reply must not hide a newer failed status read.
        apply = (current) => {
          const merged = mergeSnapshot(current, snapshot);
          const newer = snapshot.version > (current.snapshot?.version ?? 0);
          return newer ? withoutError(merged) : merged;
        };
      } catch (error) {
        // A lost response means "outcome unknown", never "failed". Once a status read has
        // brought a snapshot, the operation is known to be recorded and the error adds nothing
        // (it would only sit next to a confirmed result).
        const lastError = { kind: toPublicationError(error), at: now() };
        apply = (current) => (current.snapshot ? current : { ...current, lastError });
      } finally {
        if (!isStale(epoch)) {
          patch(operationId, (current) => ({ ...apply(current), publishInFlight: false }));
          settleTerminal(operationId);
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
      // A read from an older epoch was already dropped from the map by the reset; never remove
      // a newer in-flight read for the same id.
      if (!isStale(epoch)) inFlightChecks.delete(operationId);
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
        } else if (current.snapshot) {
          // The service had reported this operation before (records cleared elsewhere?). Keep
          // the snapshot, show it as stale, and keep following with backoff.
          next = { ...current, lastError: { kind: "not-recorded", at }, lastCheckedAt: at };
          outcome = "failed";
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
      if (!isTerminal(next)) return outcome;
      settleTerminal(operationId);
      return "stop";
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

    // `resetSimulation` calls `scheduler.stopAll()` before following again, so that reads from
    // the old epoch (which return "stop") cannot end the new following.
    const scheduler = createScheduler({
      read: (operationId) => startCheck(operationId).outcome,
      onSchedule: (operationId, at) => {
        patch(operationId, (current) => withNextCheckAt(current, at));
      },
      now,
      timers,
      visibility,
    });

    /** `false` after `disconnect()` (the provider unmounted): nothing new is followed. */
    let connected = true;

    /** Follows an unresolved operation. A restored entry ("checking") is read at once. */
    function follow(operationId: string): void {
      if (!connected) return;
      const entry = get().operations[operationId];
      if (!entry || isTerminal(entry)) return;
      const restored = !entry.snapshot && !entry.lastError && !entry.publishInFlight;
      scheduler.ensure(operationId, { immediate: restored });
    }

    /**
     * Once the service reports a terminal snapshot: stop following and drop the journal entry.
     * Safe, because the service keeps the record and a later restore still lists it.
     */
    function settleTerminal(operationId: string): void {
      if (!isTerminal(get().operations[operationId])) return;
      scheduler.stop(operationId);
      journal.remove(operationId);
    }

    /** Follows every unresolved operation, except "not-recorded" ones (asking again changes nothing). */
    function followUnresolved(): void {
      for (const entry of Object.values(get().operations)) {
        if (entry.lastError?.kind !== "not-recorded") follow(entry.operationId);
      }
    }

    /** Restore retry waits, so a reset can cancel them instead of leaving timers behind. */
    const pendingWaits = new Set<{ handle: unknown; resolve: () => void }>();

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const pending = { handle: undefined as unknown, resolve };
        pending.handle = timers.setTimeout(() => {
          pendingWaits.delete(pending);
          resolve();
        }, ms);
        pendingWaits.add(pending);
      });

    /** Clears the wait timers and resolves the waits; their restore then exits on the epoch check. */
    function cancelWaits(): void {
      for (const pending of pendingWaits) {
        timers.clearTimeout(pending.handle);
        pending.resolve();
      }
      pendingWaits.clear();
    }

    /**
     * `listOperations` with retries. Returns `undefined` when every try failed and `"stale"`
     * when the epoch changed while waiting.
     */
    async function listWithRetry(
      epoch: number,
    ): Promise<readonly PublicationOperation[] | "stale" | undefined> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const snapshots = await service.listOperations();
          return isStale(epoch) ? "stale" : snapshots;
        } catch {
          // In status-check-failure each failing list consumes one pending failure, so several
          // failures in a row are expected.
          if (isStale(epoch)) return "stale";
        }
        const delay = RESTORE_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return undefined;
        await wait(delay);
        if (isStale(epoch)) return "stale";
      }
    }

    /** Seeds journal entries with no snapshot and no error: their view is "checking". */
    function seedFromJournal(epoch: number): void {
      const known = get().operations;
      const seeded: Record<string, OperationEntry> = {};
      for (const { operationId, announcementId, createdAt } of journal.read().entries) {
        if (known[operationId]) continue;
        seeded[operationId] = {
          operationId,
          announcementId,
          createdAt,
          seq: nextSeq++,
          epoch,
          publishInFlight: false,
          checkInFlight: false,
          checkSeq: 0,
        };
      }
      set((state) => ({ operations: { ...state.operations, ...seeded } }));
    }

    /**
     * Rebuilds operations after a refresh from the journal and the service. Only reads
     * (`listOperations`, `getStatus`); never calls `publish`.
     */
    async function runRestore(): Promise<void> {
      const epoch = get().epoch;
      set({ restoreStatus: "loading" });
      seedFromJournal(epoch);

      const snapshots = await listWithRetry(epoch);
      if (snapshots === "stale") return;
      if (!snapshots) {
        // Entries stay "checking": a failed list is not a failed read of one operation.
        set({ restoreStatus: "degraded" });
        return;
      }

      // The service is the source of truth: operations the journal does not know are added too.
      const listed = new Set<string>();
      for (const snapshot of snapshots) {
        listed.add(snapshot.operationId);
        upsertSnapshot(snapshot);
        settleTerminal(snapshot.operationId);
      }

      // `null` here gives "not-recorded": the user may resend with the same operationId.
      const missing = journal
        .read()
        .entries.map((entry) => entry.operationId)
        .filter((operationId) => !listed.has(operationId));
      await Promise.all(missing.map((operationId) => startCheck(operationId).outcome));
      if (isStale(epoch)) return;

      set({ restoreStatus: "ready" });
      followUnresolved();
    }

    let restoreRun: Promise<void> | undefined;

    function startRestore(from: "idle" | "degraded"): Promise<void> {
      if (get().restoreStatus !== from) return restoreRun ?? Promise.resolve();
      restoreRun = runRestore();
      return restoreRun;
    }

    /** Creates an attempt. Fully synchronous up to the request, so a double click is a no-op. */
    function beginAttempt(
      announcementId: string,
      allowedFrom: "idle" | "rejected",
    ): string | undefined {
      // Until restore is done, existing attempts are unknown: a new one could be a duplicate.
      if (get().restoreStatus !== "ready") return undefined;
      if (viewKindOf(announcementId) !== allowedFrom) return undefined;
      // The view follows the latest attempt by `createdAt`, which mixes the local clock (journal)
      // and the service clock (listed operations). Never rely on that order alone: no new
      // operationId while ANY attempt of this announcement is unresolved.
      if (attemptsOf(announcementId).some((entry) => !isTerminal(entry))) return undefined;

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
      restoreStatus: "idle",
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

      restore() {
        return startRestore("idle");
      },

      retryRestore() {
        return startRestore("degraded");
      },

      resetSimulation() {
        // Stop first: in-flight scheduler reads are dropped and no timer fires after the reset.
        scheduler.stopAll();
        service.reset();
        // A failed clear is safe: a leftover entry restores as "not-recorded".
        journal.clear();
        inFlightChecks.clear();
        // New epoch: every promise from before the reset drops its result when it settles.
        set((state) => ({
          epoch: state.epoch + 1,
          operations: {},
          restoreStatus: "idle",
          publishBlocked: null,
          // A load in flight is dropped by the epoch check; without this, its "loading" status
          // would stay forever and block every later load.
          announcements:
            state.announcements.status === "loading"
              ? { ...state.announcements, status: "idle" }
              : state.announcements,
        }));
        // After the epoch bump: a cancelled wait resumes its restore, which then sees it is stale.
        cancelWaits();
        return startRestore("idle");
      },

      connect() {
        connected = true;
        void startRestore("idle");
        // Reconnected after a disconnect (StrictMode remount): resume following.
        if (get().restoreStatus === "ready") followUnresolved();
      },

      disconnect() {
        connected = false;
        scheduler.stopAll();
      },

      applySnapshots(snapshots) {
        for (const snapshot of snapshots) {
          upsertSnapshot(snapshot);
          settleTerminal(snapshot.operationId);
        }
      },

      dismissPublishBlocked() {
        set({ publishBlocked: null });
      },
    };
  });
}
