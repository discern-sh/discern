/**
 * Short handles for continuation state relayed through an agent.
 *
 * The random identity is repository-local and collision-checked by the store.
 * The checksum catches every one-symbol substitution and adjacent transposition
 * within the random identity before a damaged handle reaches the filesystem.
 */

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_SYMBOLS = 8;
const CHECK_SYMBOLS = 2;
const CHECK_MODULUS = 32 ** CHECK_SYMBOLS;

export const CONTINUATION_HANDLE_LENGTH = 15;
export const CONTINUATION_HANDLE_PATTERN =
  /^C1-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/u;

/** Test seam for deterministic collision and checksum coverage. */
export type ContinuationRandomBytes = (length: number) => Uint8Array;

/** Return the checksum. */
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

/** Encode the checksum. */
function encodeChecksum(value: number): string {
  return `${CROCKFORD_BASE32[Math.floor(value / 32)] ?? ""}${
    CROCKFORD_BASE32[value % 32] ?? ""
  }`;
}

/** Return the system random bytes. */
function systemRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Create one canonical handle. The store rejects and retries collisions. */
export function createContinuationHandle(
  randomBytes: ContinuationRandomBytes = systemRandomBytes,
): string {
  const bytes = randomBytes(RANDOM_SYMBOLS);
  if (bytes.length !== RANDOM_SYMBOLS) {
    throw new Error(
      `continuation randomness returned ${bytes.length} bytes; expected ${RANDOM_SYMBOLS}`,
    );
  }
  let data = "";
  for (const byte of bytes) {
    data += CROCKFORD_BASE32[byte & 31] ?? "";
  }
  const check = encodeChecksum(checksum(data));
  return `C1-${data.slice(0, 4)}-${data.slice(4)}-${check}`;
}

/**
 * Return the canonical uppercase handle when its grammar and checksum hold.
 * Case is harmlessly normalized; every other changed symbol is rejected.
 */
export function normalizeContinuationHandle(
  candidate: string,
): string | undefined {
  const normalized = candidate.toUpperCase();
  if (
    normalized.length !== CONTINUATION_HANDLE_LENGTH ||
    !CONTINUATION_HANDLE_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  const parts = normalized.split("-");
  const data = `${parts[1] ?? ""}${parts[2] ?? ""}`;
  const supplied = parts[3];
  if (supplied === undefined || supplied !== encodeChecksum(checksum(data))) {
    return undefined;
  }
  return normalized;
}
