/**
 * Short checksum-protected handles for repository-local state relayed through
 * an agent. One prefixed family per store: the random identity is
 * collision-checked by the owning store, and the 2-symbol check catches every
 * one-symbol substitution and adjacent transposition before a damaged handle
 * reaches the filesystem. Handles identify state; they are never authority or
 * secrets.
 */

import { type SecureEntropy, SYSTEM_SECURE_ENTROPY } from "./entropy.ts";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_SYMBOLS = 8;
const CHECK_SYMBOLS = 2;
const CHECK_MODULUS = 32 ** CHECK_SYMBOLS;

/** One handle family: a short uppercase prefix naming the owning store. */
export interface ShortHandleFamily {
  readonly prefix: string;
  readonly length: number;
  readonly pattern: RegExp;
}

/** Declare a family; the prefix distinguishes stores at a glance. */
export function shortHandleFamily(prefix: string): ShortHandleFamily {
  return {
    prefix,
    // `<prefix>-XXXX-XXXX-XX`: three dashes, eight data symbols, two check symbols.
    length: prefix.length + 13,
    pattern: new RegExp(
      `^${prefix}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$`,
      "u",
    ),
  };
}

/** Fold Crockford symbols into the 2-symbol substitution-and-transposition check. */
function checksum(data: string): number {
  let value = 0;
  for (const symbol of data) {
    const index = CROCKFORD_BASE32.indexOf(symbol);
    if (index < 0) {
      return -1;
    }
    value = (value * 33 + index) % CHECK_MODULUS;
  }
  return value;
}

/** Encode the bounded numeric check as 2 Crockford Base32 symbols. */
function encodeChecksum(value: number): string {
  return `${CROCKFORD_BASE32[Math.floor(value / 32)] ?? ""}${
    CROCKFORD_BASE32[value % 32] ?? ""
  }`;
}

/** Create one canonical handle. The owning store rejects and retries collisions. */
export function createShortHandle(
  family: ShortHandleFamily,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): string {
  const bytes = new Uint8Array(RANDOM_SYMBOLS);
  entropy.fillBytes(bytes);
  let data = "";
  for (const byte of bytes) {
    data += CROCKFORD_BASE32[byte & 31] ?? "";
  }
  const check = encodeChecksum(checksum(data));
  return `${family.prefix}-${data.slice(0, 4)}-${data.slice(4)}-${check}`;
}

/**
 * Return the canonical uppercase handle when its grammar and checksum hold.
 * Case is harmlessly normalized; every other changed symbol is rejected.
 */
export function normalizeShortHandle(
  family: ShortHandleFamily,
  candidate: string,
): string | undefined {
  const normalized = candidate.toUpperCase();
  if (
    normalized.length !== family.length || !family.pattern.test(normalized)
  ) {
    return undefined;
  }
  const parts = normalized.split("-");
  const data = `${parts.at(-3) ?? ""}${parts.at(-2) ?? ""}`;
  const supplied = parts.at(-1);
  if (supplied === undefined || supplied !== encodeChecksum(checksum(data))) {
    return undefined;
  }
  return normalized;
}
