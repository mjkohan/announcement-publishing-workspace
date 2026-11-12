import { describe, expect, it } from "vitest";
import { AnnouncementMockError, type AnnouncementErrorCode } from "../mocks";
import { toPublicationError } from "./errors";
import type { PublicationErrorKind } from "./types";

describe("toPublicationError", () => {
  it.each<[AnnouncementErrorCode, PublicationErrorKind]>([
    ["RESPONSE_LOST", "response-lost"],
    ["STATUS_UNAVAILABLE", "status-unavailable"],
    ["UNKNOWN_ANNOUNCEMENT", "unexpected"],
    ["OPERATION_ID_CONFLICT", "unexpected"],
  ])("maps %s to %s", (code, kind) => {
    expect(toPublicationError(new AnnouncementMockError(code, "req-1", "op-1"))).toBe(kind);
  });

  it("maps an unknown mock error code to unexpected", () => {
    const error = new AnnouncementMockError("RESPONSE_LOST", "req-1");
    Object.defineProperty(error, "code", { value: "SOMETHING_NEW" });

    expect(toPublicationError(error)).toBe("unexpected");
  });

  it("maps a TypeError to unexpected", () => {
    expect(toPublicationError(new TypeError("Failed to fetch"))).toBe("unexpected");
  });

  it("maps a plain Error to unexpected", () => {
    expect(toPublicationError(new Error("boom"))).toBe("unexpected");
  });

  it("maps a look-alike object with a known code to unexpected", () => {
    expect(toPublicationError({ code: "RESPONSE_LOST" })).toBe("unexpected");
  });

  it("maps non-error values to unexpected", () => {
    expect(toPublicationError(undefined)).toBe("unexpected");
    expect(toPublicationError("RESPONSE_LOST")).toBe("unexpected");
  });
});
