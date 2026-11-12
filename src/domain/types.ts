import type { PublicationOperation } from "../mocks";

/** Why the last request for an operation failed. Never means "rejected". */
export type PublicationErrorKind =
  "response-lost" | "status-unavailable" | "not-recorded" | "unexpected";

export interface OperationError {
  kind: PublicationErrorKind;
  /** Local time (ms) when the error was recorded. */
  at: number;
}

/** App-side record of one publish attempt, keyed by `operationId`. */
export interface OperationEntry {
  operationId: string;
  announcementId: string;
  /**
   * Local time (ms) when the attempt was created. For an operation the journal does not know,
   * this is `Date.parse(snapshot.createdAt)`.
   */
  createdAt: number;
  /** Insertion order. Tie-breaker when two attempts share `createdAt`. */
  seq: number;
  /** Bumped on reset/restore. Stale async continuations compare against it and drop their result. */
  epoch: number;
  /** Latest accepted service snapshot. See `mergeSnapshot`. */
  snapshot?: PublicationOperation;
  /** A `publish` request for this operation is pending. */
  publishInFlight: boolean;
  /** A status read for this operation is pending. Independent of `publishInFlight`. */
  checkInFlight: boolean;
  /** Bumped by every started check and every applied snapshot. */
  checkSeq: number;
  /** Last request failure. Kept separate so it never erases the snapshot. */
  lastError?: OperationError;
  lastCheckedAt?: number;
  nextCheckAt?: number;
}

export type PublicationStatus = PublicationOperation["status"];

export type SnapshotWithStatus<S extends PublicationStatus> = Extract<
  PublicationOperation,
  { status: S }
>;

/** An entry whose accepted snapshot has the given status. */
export type OperationEntryWith<S extends PublicationStatus> = OperationEntry & {
  snapshot: SnapshotWithStatus<S>;
};

/** What the UI shows for one announcement. Always derived from its operations, never stored. */
export type AnnouncementView =
  | { kind: "idle" }
  /** Restored from the journal; the first status read is pending. */
  | { kind: "checking"; op: OperationEntry }
  | { kind: "submitting"; op: OperationEntry }
  /** `stale`: the last status read failed, so the processing snapshot may be outdated. */
  | { kind: "processing"; op: OperationEntryWith<"processing">; stale: boolean }
  | { kind: "published"; op: OperationEntryWith<"published"> }
  | { kind: "rejected"; op: OperationEntryWith<"rejected">; reason: string }
  /** A real request failed and the outcome is unknown. `notRecorded`: the service has no record. */
  | { kind: "unconfirmed"; op: OperationEntry; notRecorded: boolean };

export type AnnouncementViewKind = AnnouncementView["kind"];
