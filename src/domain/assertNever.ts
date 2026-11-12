/** Compile-time exhaustiveness check. Throws if reached at runtime. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
