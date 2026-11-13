import type {
  AnnouncementView,
  OperationEntry,
  OperationEntryWith,
  PublicationStatus,
} from "./types";

const IDLE: AnnouncementView = { kind: "idle" };

function hasStatus<S extends PublicationStatus>(
  op: OperationEntry,
  status: S,
): op is OperationEntryWith<S> {
  return op.snapshot?.status === status;
}

/** Orders attempts oldest first: by `createdAt`, then by `seq`. */
export function compareAttempts(a: OperationEntry, b: OperationEntry): number {
  return a.createdAt - b.createdAt || a.seq - b.seq;
}

/**
 * Derives the view of one announcement from its operations (all for the same announcement).
 *
 * - Any published operation wins.
 * - Otherwise the latest attempt (by `createdAt`, then `seq`) decides.
 * - Without a snapshot: a real error gives "unconfirmed"; otherwise a pending publish gives
 *   "submitting"; otherwise the entry was restored and is "checking". Missing data alone never
 *   gives "unconfirmed".
 *
 * Does not mutate `ops`.
 */
export function deriveAnnouncementView(ops: readonly OperationEntry[]): AnnouncementView {
  const sorted = [...ops].sort(compareAttempts);

  const published = sorted.findLast((op) => hasStatus(op, "published"));
  if (published) return { kind: "published", op: published };

  const latest = sorted.at(-1);
  if (!latest) return IDLE;

  if (hasStatus(latest, "rejected")) {
    return { kind: "rejected", op: latest, reason: latest.snapshot.reason };
  }
  if (hasStatus(latest, "processing")) {
    return {
      kind: "processing",
      op: latest,
      // Any failed status read (unavailable, unexpected, not recorded) makes the snapshot
      // possibly outdated. "response-lost" is a publish error and says nothing about freshness.
      stale: latest.lastError !== undefined && latest.lastError.kind !== "response-lost",
    };
  }

  if (latest.lastError) {
    return {
      kind: "unconfirmed",
      op: latest,
      notRecorded: latest.lastError.kind === "not-recorded",
    };
  }
  if (latest.publishInFlight) return { kind: "submitting", op: latest };
  return { kind: "checking", op: latest };
}
