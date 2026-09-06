/** Select the tagged release that anchors public-schema compatibility. */

import type { PublicSchemaPublication } from "../src/shared/public_schemas.ts";
import { runGit } from "../src/shared/subprocess.ts";

interface ReleaseTag {
  readonly tag: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[];
}

const RELEASE_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Parse exactly `v<SemVer>`, rejecting unsafe numeric components. */
function releaseTag(value: string): ReleaseTag | undefined {
  const match = RELEASE_TAG_PATTERN.exec(value);
  if (match === null) return undefined;
  const [majorText, minorText, patchText] = match.slice(1, 4);
  if (
    majorText === undefined || minorText === undefined ||
    patchText === undefined
  ) {
    return undefined;
  }
  const core = [majorText, minorText, patchText].map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return undefined;
  const prerelease = match[4] === undefined
    ? []
    : match[4].split(".").map((part): number | string =>
      /^[0-9]+$/.test(part) ? Number(part) : part
    );
  return {
    tag: value,
    major: core[0] ?? 0,
    minor: core[1] ?? 0,
    patch: core[2] ?? 0,
    prerelease,
  };
}

/** SemVer precedence, with the tag spelling as a stable build-metadata tie-break. */
function compareReleaseTags(left: ReleaseTag, right: ReleaseTag): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const order = left[key] - right[key];
    if (order !== 0) return order;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) {
      return left.tag.localeCompare(right.tag);
    }
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const before = left.prerelease[index];
    const after = right.prerelease[index];
    if (before === undefined || after === undefined) {
      return before === after ? 0 : before === undefined ? -1 : 1;
    }
    if (before === after) continue;
    if (typeof before === "number" && typeof after === "number") {
      return before - after;
    }
    if (typeof before === "number") return -1;
    if (typeof after === "number") return 1;
    return before.localeCompare(after);
  }
  return left.tag.localeCompare(right.tag);
}

/**
 * Select the release publication that freezes the current compatibility floor.
 *
 * Ordinary commits compare with the highest valid version tag. A release
 * candidate at `HEAD` excludes every tag on that commit, so it compares with
 * its predecessor instead of baselining itself. No predecessor leaves the
 * ratchet deliberately unarmed until that first publication exists beneath a
 * later commit.
 */
export async function publicSchemaBaselineTag(
  cwd: string,
): Promise<string | undefined> {
  const listed = await runGit(["tag", "--list"], { cwd });
  if (!listed.success) {
    throw new Error(`cannot list release tags: ${listed.stderr}`);
  }
  const atHead = await runGit(["tag", "--points-at", "HEAD", "--list"], {
    cwd,
  });
  if (!atHead.success) {
    throw new Error(`cannot list release tags at HEAD: ${atHead.stderr}`);
  }
  const excluded = new Set(
    atHead.stdout.split("\n").map((tag) => tag.trim()).filter(Boolean),
  );
  const candidates = listed.stdout.split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !excluded.has(tag))
    .flatMap((tag) => {
      const parsed = releaseTag(tag);
      return parsed === undefined ? [] : [parsed];
    })
    .sort(compareReleaseTags);
  return candidates.at(-1)?.tag;
}

/** The first published contract starts at one; only a predecessor can justify a later major. */
export function initialPublicationIssues(
  predecessor: string | undefined,
  publications: readonly PublicSchemaPublication[],
): string[] {
  return predecessor === undefined
    ? publications.filter((publication) => publication.major !== 1).map((
      publication,
    ) =>
      `${publication.artifactPath}: the first publication must use major 1; no predecessor publication exists`
    )
    : [];
}
