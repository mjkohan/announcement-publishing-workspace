const PREFIX = "op-";

/** `randomUUID` exists only in secure contexts; `getRandomValues` exists everywhere. */
type CryptoLike = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>;

/** RFC 4122 version 4 UUID built from `getRandomValues`. */
function uuidFromRandomValues(crypto: CryptoLike): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    let value = byte;
    if (index === 6) value = (byte & 0x0f) | 0x40; // version 4
    if (index === 8) value = (byte & 0x3f) | 0x80; // variant 10xx
    return value.toString(16).padStart(2, "0");
  }).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** New operation ID: "op-" + UUID v4. Always nonblank and at most 100 characters (39). */
export function createOperationId(crypto: CryptoLike = globalThis.crypto): string {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : uuidFromRandomValues(crypto);
  return PREFIX + uuid;
}
