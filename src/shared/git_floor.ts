/** The supported Git floor and the feature tokens that constrain it. */

/** A parsed numeric Git release. Vendor suffixes remain outside this value. */
export interface GitVersionNumber {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** The oldest Git release discern supports. */
export const MIN_GIT_VERSION: GitVersionNumber = {
  major: 2,
  minor: 30,
  patch: 0,
};

/** One source token whose use requires a particular Git release. */
export interface GitFeatureFloor {
  readonly token: string;
  readonly subcommand?: string;
  readonly minimum: GitVersionNumber;
  readonly feature: string;
}

/**
 * Git argv/ref spellings with a release floor. The structural guard scans the
 * complete authored TypeScript universe for these tokens, so reintroducing a
 * feature newer than {@link MIN_GIT_VERSION} fails the gate automatically.
 */
export const GIT_FEATURE_FLOORS = [
  {
    token: "--format=%(",
    subcommand: "ls-tree",
    minimum: { major: 2, minor: 36, patch: 0 },
    feature: "git ls-tree custom formatting",
  },
  {
    token: "--fixed-value",
    subcommand: "config",
    minimum: { major: 2, minor: 30, patch: 0 },
    feature: "literal git config value matching",
  },
  {
    token: "switch",
    subcommand: "switch",
    minimum: { major: 2, minor: 23, patch: 0 },
    feature: "git switch",
  },
  {
    token: "--show-current",
    subcommand: "branch",
    minimum: { major: 2, minor: 22, patch: 0 },
    feature: "current-branch reporting",
  },
  {
    token: "--worktree",
    subcommand: "config",
    minimum: { major: 2, minor: 20, patch: 0 },
    feature: "worktree-scoped configuration",
  },
  {
    token: "refs/worktree/",
    minimum: { major: 2, minor: 20, patch: 0 },
    feature: "per-worktree refs",
  },
] as const satisfies readonly GitFeatureFloor[];

/** Parse `git --version`, accepting ordinary vendor suffixes. */
export function parseGitVersion(raw: string): GitVersionNumber | undefined {
  const match = /^git version\s+(\d+)\.(\d+)(?:\.(\d+))?/u.exec(raw.trim());
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? "0");
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) &&
      Number.isSafeInteger(patch)
    ? { major, minor, patch }
    : undefined;
}

/** Render a numeric Git release for diagnostics and documentation parity. */
export function formatGitVersion(version: GitVersionNumber): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Compare two numeric Git releases. */
export function compareGitVersions(
  left: GitVersionNumber,
  right: GitVersionNumber,
): number {
  return left.major - right.major || left.minor - right.minor ||
    left.patch - right.patch;
}

/** Whether a raw `git --version` line satisfies discern's declared floor. */
export function supportedGitVersion(raw: string): boolean {
  const parsed = parseGitVersion(raw);
  return parsed !== undefined &&
    compareGitVersions(parsed, MIN_GIT_VERSION) >= 0;
}
