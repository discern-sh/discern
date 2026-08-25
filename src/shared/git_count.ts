/** The explicit value used when Git cannot supply one trustworthy count. */
export const UNKNOWN_GIT_COUNT = "unknown" as const;

/** A non-negative integer reported by Git, or an explicit unavailable state. */
export type GitCount = number | typeof UNKNOWN_GIT_COUNT;

/** The command-result fields needed to decode one numeric Git fact. */
export interface GitCountRead {
  readonly success: boolean;
  readonly stdout: string;
}

/**
 * Parse Git's canonical non-negative integer output. Empty, non-canonical,
 * non-finite, and unsafe integers remain unknown rather than becoming zero.
 */
export function parseGitCount(raw: string): GitCount {
  const text = raw.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    return UNKNOWN_GIT_COUNT;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : UNKNOWN_GIT_COUNT;
}

/** Decode one numeric Git command, retaining command failure as unknown. */
export function gitCountFrom(read: GitCountRead): GitCount {
  return read.success ? parseGitCount(read.stdout) : UNKNOWN_GIT_COUNT;
}

/** Narrow an explicit Git count to a trustworthy number. */
export function isKnownGitCount(count: GitCount): count is number {
  return typeof count === "number";
}

/** True only for a trustworthy positive Git count. */
export function isPositiveGitCount(count: GitCount): count is number {
  return isKnownGitCount(count) && count > 0;
}
