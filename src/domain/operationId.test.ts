import { describe, expect, it } from "vitest";
import { createOperationId } from "./operationId";

const FORMAT = /^op-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createOperationId", () => {
  it("has the op- prefix and UUID v4 format", () => {
    expect(createOperationId()).toMatch(FORMAT);
  });

  it("is nonblank and at most 100 characters", () => {
    const id = createOperationId();

    expect(id.trim()).not.toBe("");
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it("is unique", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => createOperationId()));

    expect(ids.size).toBe(1_000);
  });

  describe("without randomUUID (non-secure context)", () => {
    const insecureCrypto: Pick<Crypto, "getRandomValues"> = {
      getRandomValues: (array) => crypto.getRandomValues(array),
    };

    it("falls back to getRandomValues with the same format", () => {
      const id = createOperationId(insecureCrypto);

      expect(id).toMatch(FORMAT);
      expect(id.length).toBeLessThanOrEqual(100);
    });

    it("is unique", () => {
      const ids = new Set(Array.from({ length: 1_000 }, () => createOperationId(insecureCrypto)));

      expect(ids.size).toBe(1_000);
    });
  });
});
