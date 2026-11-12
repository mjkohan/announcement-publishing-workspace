import type { PublicationOperation } from "../mocks";
import type { OperationEntry } from "./types";

/**
 * Applies a service snapshot to an entry.
 *
 * Returns `current` unchanged (same reference) when the snapshot is ignored:
 * - it belongs to another operationId,
 * - the current snapshot is terminal (version 2 is immutable),
 * - it is older than the current snapshot (late, out-of-order reply).
 *
 * Otherwise the snapshot is accepted (`incoming.version >= current.version`) and `checkSeq` is
 * bumped. `lastError` is left untouched: errors and snapshots are independent.
 */
export function mergeSnapshot(
  current: OperationEntry,
  incoming: PublicationOperation,
): OperationEntry {
  if (incoming.operationId !== current.operationId) return current;

  const existing = current.snapshot;
  if (existing) {
    if (existing.version === 2) return current;
    if (incoming.version < existing.version) return current;
  }

  return { ...current, snapshot: incoming, checkSeq: current.checkSeq + 1 };
}
