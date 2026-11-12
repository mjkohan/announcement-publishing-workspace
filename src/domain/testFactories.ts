import type { OperationEntry, SnapshotWithStatus } from "./types";

// Test-only builders for domain tests.

const ANNOUNCEMENT_ID = "announcement-1";

export function entry(overrides: Partial<OperationEntry> = {}): OperationEntry {
  return {
    operationId: "op-1",
    announcementId: ANNOUNCEMENT_ID,
    createdAt: 1_000,
    seq: 0,
    epoch: 0,
    publishInFlight: false,
    checkInFlight: false,
    checkSeq: 0,
    ...overrides,
  };
}

function identity(operationId: string) {
  return {
    operationId,
    announcementId: ANNOUNCEMENT_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export function processing(operationId = "op-1"): SnapshotWithStatus<"processing"> {
  return { ...identity(operationId), status: "processing", version: 1 };
}

export function published(operationId = "op-1"): SnapshotWithStatus<"published"> {
  return {
    ...identity(operationId),
    status: "published",
    version: 2,
    publicationId: `pub-${operationId}`,
    publishedAt: "2026-01-01T00:00:05.000Z",
  };
}

export function rejected(
  operationId = "op-1",
  reason = "Declined.",
): SnapshotWithStatus<"rejected"> {
  return { ...identity(operationId), status: "rejected", version: 2, reason };
}
