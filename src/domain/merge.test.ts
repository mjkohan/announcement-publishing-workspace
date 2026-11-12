import { describe, expect, it } from "vitest";
import { mergeSnapshot } from "./merge";
import { entry, processing, published, rejected } from "./testFactories";

describe("mergeSnapshot", () => {
  it("accepts the first snapshot and bumps checkSeq", () => {
    const current = entry({ checkSeq: 3 });

    const merged = mergeSnapshot(current, processing());

    expect(merged.snapshot).toEqual(processing());
    expect(merged.checkSeq).toBe(4);
  });

  it("accepts v2 after v1", () => {
    const current = entry({ snapshot: processing() });

    expect(mergeSnapshot(current, published()).snapshot).toEqual(published());
  });

  it("accepts a v1 refresh over v1 (equal version)", () => {
    const current = entry({ snapshot: processing(), checkSeq: 1 });

    expect(mergeSnapshot(current, processing()).checkSeq).toBe(2);
  });

  it("ignores a stale v1 that arrives after v2", () => {
    const current = entry({ snapshot: published() });

    expect(mergeSnapshot(current, processing())).toBe(current);
  });

  it("keeps a terminal v2 immutable", () => {
    const current = entry({ snapshot: published() });

    expect(mergeSnapshot(current, rejected())).toBe(current);
    expect(mergeSnapshot(current, { ...published(), publicationId: "other" })).toBe(current);
  });

  it("ignores a snapshot for a different operationId", () => {
    const current = entry({ operationId: "op-1" });

    expect(mergeSnapshot(current, published("op-2"))).toBe(current);
  });

  it("keeps lastError when a snapshot is applied", () => {
    const lastError = { kind: "status-unavailable", at: 5 } as const;
    const current = entry({ snapshot: processing(), lastError });

    expect(mergeSnapshot(current, processing()).lastError).toEqual(lastError);
  });

  it("does not mutate the current entry", () => {
    const current = entry();
    const before = structuredClone(current);

    mergeSnapshot(current, published());

    expect(current).toEqual(before);
  });
});
