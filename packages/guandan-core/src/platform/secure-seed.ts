/**
 * P3 authority seed boundary.  This module is deliberately synchronous and
 * platform-neutral: Workers obtain the entropy, while the core only validates
 * and deterministically consumes the already-generated 256-bit value.
 */
export const SECURE_SEED_HEX_LENGTH = 64;

declare const secureSeedBrand: unique symbol;
export type SecureSeed = string & { readonly [secureSeedBrand]: "SecureSeed" };

export function parseSecureSeed(value: string): SecureSeed {
  if (!new RegExp(`^[0-9a-f]{${SECURE_SEED_HEX_LENGTH}}$`, "u").test(value)) {
    throw new RangeError("secure seed must be 32 lowercase hexadecimal bytes");
  }
  if (/^0+$/u.test(value)) throw new RangeError("secure seed must not be zero");
  return value as SecureSeed;
}

export function isSecureSeed(value: unknown): value is SecureSeed {
  try {
    return typeof value === "string" && parseSecureSeed(value) === value;
  } catch {
    return false;
  }
}

const MASK_64 = (1n << 64n) - 1n;

function rotateLeft(value: bigint, count: bigint): bigint {
  return ((value << count) | (value >> (64n - count))) & MASK_64;
}

/** xoshiro256** consumes all four 64-bit seed words without environment APIs. */
export function createSecureSeedRandom(seed: SecureSeed): () => number {
  let [a, b, c, d] = [0, 16, 32, 48].map((offset) =>
    BigInt(`0x${seed.slice(offset, offset + 16)}`),
  );
  return () => {
    const result = rotateLeft((b * 5n) & MASK_64, 7n) * 9n & MASK_64;
    const temporary = (b << 17n) & MASK_64;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= temporary;
    d = rotateLeft(d, 45n);
    // 53 significant bits are enough for Fisher-Yates' integer choice.
    return Number(result >> 11n) / 9_007_199_254_740_992;
  };
}

/** Derives another full-width deterministic seed for subsequent rounds. */
export function deriveSecureSeed(seed: SecureSeed, roundNumber: number): SecureSeed {
  if (!Number.isSafeInteger(roundNumber) || roundNumber < 1)
    throw new RangeError("round number must be a positive safe integer");
  const random = createSecureSeedRandom(seed);
  for (let index = 0; index < roundNumber * 4; index += 1) random();
  const words = Array.from({ length: 4 }, () => {
    const high = BigInt(Math.floor(random() * 0x20_0000));
    const low = BigInt(Math.floor(random() * 0x1_0000_0000));
    return ((high << 32n) | low).toString(16).padStart(16, "0");
  });
  return parseSecureSeed(words.join(""));
}
