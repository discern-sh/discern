/**
 * Short handles for continuation state relayed through an agent.
 *
 * The `C1` family of the shared short-handle machinery: the random identity is
 * repository-local and collision-checked by the continuation store, and the
 * checksum catches every one-symbol substitution and adjacent transposition
 * within the random identity before a damaged handle reaches the filesystem.
 */

import type { SecureEntropy } from "./entropy.ts";
import {
  createShortHandle,
  normalizeShortHandle,
  shortHandleFamily,
} from "./short_handle.ts";

const CONTINUATION_FAMILY = shortHandleFamily("C1");

export const CONTINUATION_HANDLE_LENGTH = CONTINUATION_FAMILY.length;
export const CONTINUATION_HANDLE_PATTERN = CONTINUATION_FAMILY.pattern;

/** Create one canonical handle. The store rejects and retries collisions. */
export function createContinuationHandle(
  entropy?: SecureEntropy,
): string {
  return createShortHandle(CONTINUATION_FAMILY, entropy);
}

/**
 * Return the canonical uppercase handle when its grammar and checksum hold.
 * Case is harmlessly normalized; every other changed symbol is rejected.
 */
export function normalizeContinuationHandle(
  candidate: string,
): string | undefined {
  return normalizeShortHandle(CONTINUATION_FAMILY, candidate);
}
