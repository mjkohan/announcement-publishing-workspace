import { describe, expect, it } from "vitest";
import type { OperationEntry } from "../domain";
import { selectAttempts, selectView } from "./selectors";

function entry(
  operationId: string,
  announcementId: string,
  createdAt: number,
  seq: number,
): OperationEntry {
  return {
    operationId,
    announcementId,
    createdAt,
    seq,
    epoch: 0,
    publishInFlight: true,
    checkInFlight: false,
    checkSeq: 0,
  };
}

const a1 = entry("op-1", "sel-a", 100, 0);
const a2 = entry("op-2", "sel-a", 200, 1);
const b1 = entry("op-3", "sel-b", 150, 2);

describe("selectAttempts", () => {
  it("returns attempts of one announcement, newest first", () => {
    const state = { operations: { "op-1": a1, "op-2": a2, "op-3": b1 } };

    expect(selectAttempts("sel-a")(state)).toEqual([a2, a1]);
  });

  it("orders attempts with the same createdAt by seq, newest first", () => {
    const x = entry("op-x", "sel-seq", 100, 5);
    const y = entry("op-y", "sel-seq", 100, 6);

    expect(selectAttempts("sel-seq")({ operations: { "op-y": y, "op-x": x } })).toEqual([y, x]);
  });

  it("returns the same selector function for the same announcement", () => {
    expect(selectAttempts("sel-a")).toBe(selectAttempts("sel-a"));
    expect(selectView("sel-a")).toBe(selectView("sel-a"));
  });

  it("keeps the same reference when only another announcement changes", () => {
    const select = selectAttempts("sel-a");
    const first = select({ operations: { "op-1": a1, "op-2": a2, "op-3": b1 } });

    const changedB = { ...b1, publishInFlight: false };
    const second = select({ operations: { "op-1": a1, "op-2": a2, "op-3": changedB } });

    expect(second).toBe(first);
  });

  it("returns a new reference when one of its entries changes", () => {
    const select = selectAttempts("sel-a");
    const first = select({ operations: { "op-1": a1, "op-2": a2 } });

    const second = select({ operations: { "op-1": a1, "op-2": { ...a2, checkSeq: 1 } } });

    expect(second).not.toBe(first);
  });

  it("returns a stable empty array without attempts", () => {
    const select = selectAttempts("sel-none");

    expect(select({ operations: {} })).toBe(select({ operations: { "op-1": a1 } }));
  });
});

describe("selectView", () => {
  it("keeps the same view reference when other announcements change", () => {
    const select = selectView("sel-a");
    const first = select({ operations: { "op-1": a1, "op-3": b1 } });

    const second = select({ operations: { "op-1": a1, "op-3": { ...b1, checkSeq: 9 } } });

    expect(first).toEqual({ kind: "submitting", op: a1 });
    expect(second).toBe(first);
  });

  it("recomputes when its attempts change", () => {
    const select = selectView("sel-a");
    const first = select({ operations: { "op-1": a1 } });

    const second = select({
      operations: {
        "op-1": { ...a1, publishInFlight: false, lastError: { kind: "response-lost", at: 1 } },
      },
    });

    expect(first.kind).toBe("submitting");
    expect(second).toMatchObject({ kind: "unconfirmed", notRecorded: false });
  });

  it("returns a stable idle view", () => {
    const select = selectView("sel-idle");

    expect(select({ operations: {} })).toEqual({ kind: "idle" });
    expect(select({ operations: { "op-1": a1 } })).toBe(select({ operations: {} }));
  });
});
