import { describe, expect, it } from "vitest";
import { assertNever } from "./assertNever";

describe("assertNever", () => {
  it("throws when reached at runtime", () => {
    expect(() => assertNever("surprise" as never)).toThrow('Unexpected value: "surprise"');
  });
});
