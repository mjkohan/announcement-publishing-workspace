import { describe, expect, it } from "vitest";
import { deriveAnnouncementView } from "./derive";
import { entry, processing, published, rejected } from "./testFactories";

describe("deriveAnnouncementView", () => {
  it("is idle without operations", () => {
    expect(deriveAnnouncementView([])).toEqual({ kind: "idle" });
  });

  describe("published wins", () => {
    it("over a later rejected attempt", () => {
      const first = entry({ operationId: "op-1", createdAt: 1, snapshot: published("op-1") });
      const later = entry({ operationId: "op-2", createdAt: 2, snapshot: rejected("op-2") });

      const view = deriveAnnouncementView([first, later]);

      expect(view).toEqual({ kind: "published", op: first });
    });

    it("over a later processing attempt", () => {
      const first = entry({ operationId: "op-1", createdAt: 1, snapshot: published("op-1") });
      const later = entry({ operationId: "op-2", createdAt: 2, snapshot: processing("op-2") });

      expect(deriveAnnouncementView([later, first]).kind).toBe("published");
    });
  });

  it("lets the latest attempt decide after a rejection", () => {
    const first = entry({ operationId: "op-1", createdAt: 1, snapshot: rejected("op-1") });
    const retry = entry({ operationId: "op-2", createdAt: 2, snapshot: processing("op-2") });

    const view = deriveAnnouncementView([first, retry]);

    expect(view).toEqual({ kind: "processing", op: retry, stale: false });
  });

  it("shows the rejection reason", () => {
    const op = entry({ snapshot: rejected("op-1", "Too long.") });

    expect(deriveAnnouncementView([op])).toEqual({ kind: "rejected", op, reason: "Too long." });
  });

  describe("processing stale flag", () => {
    it("is stale after a failed status read", () => {
      const op = entry({
        snapshot: processing(),
        lastError: { kind: "status-unavailable", at: 10 },
      });

      expect(deriveAnnouncementView([op])).toEqual({ kind: "processing", op, stale: true });
    });

    it("is not stale for other errors", () => {
      const op = entry({ snapshot: processing(), lastError: { kind: "response-lost", at: 10 } });

      expect(deriveAnnouncementView([op])).toMatchObject({ kind: "processing", stale: false });
    });
  });

  describe("without a snapshot", () => {
    it("is unconfirmed after a lost response", () => {
      const op = entry({ lastError: { kind: "response-lost", at: 10 } });

      expect(deriveAnnouncementView([op])).toEqual({ kind: "unconfirmed", op, notRecorded: false });
    });

    it("is unconfirmed with notRecorded when the service has no record", () => {
      const op = entry({ lastError: { kind: "not-recorded", at: 10 } });

      expect(deriveAnnouncementView([op])).toEqual({ kind: "unconfirmed", op, notRecorded: true });
    });

    it("stays unconfirmed (not submitting) while a retry is in flight after an error", () => {
      const op = entry({ publishInFlight: true, lastError: { kind: "response-lost", at: 10 } });

      expect(deriveAnnouncementView([op]).kind).toBe("unconfirmed");
    });

    it("is submitting while the first publish is in flight", () => {
      const op = entry({ publishInFlight: true });

      expect(deriveAnnouncementView([op])).toEqual({ kind: "submitting", op });
    });

    it("is checking (never unconfirmed) with no snapshot, no error and no publish in flight", () => {
      const restored = entry();

      expect(deriveAnnouncementView([restored])).toEqual({ kind: "checking", op: restored });
    });

    it("is checking while the first status read is in flight", () => {
      const restored = entry({ checkInFlight: true });

      expect(deriveAnnouncementView([restored]).kind).toBe("checking");
    });
  });

  it("orders two attempts with the same createdAt by seq", () => {
    const first = entry({ operationId: "op-1", createdAt: 5, seq: 1, snapshot: rejected("op-1") });
    const second = entry({ operationId: "op-2", createdAt: 5, seq: 2, publishInFlight: true });

    expect(deriveAnnouncementView([second, first])).toEqual({ kind: "submitting", op: second });
    expect(deriveAnnouncementView([first, second])).toEqual({ kind: "submitting", op: second });
  });

  it("does not mutate the input array", () => {
    const later = entry({ operationId: "op-2", createdAt: 2 });
    const earlier = entry({ operationId: "op-1", createdAt: 1 });
    const ops = Object.freeze([later, earlier]);

    deriveAnnouncementView(ops);

    expect(ops).toEqual([later, earlier]);
  });
});
