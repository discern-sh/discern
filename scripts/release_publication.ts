/** Observe publication outside the binary and validate immutable release source. */
import { z } from "@zod/zod";
import { fromFileUrl, toFileUrl } from "@std/path";
import { type GitResult, runGit } from "../src/shared/subprocess.ts";
import { parseVersion, versionFamily } from "../src/shared/semver.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { BUILD_TARGETS, releaseArtifactPaths } from "./build_targets.ts";
import {
  assertPublishedCodenames,
  type AuthoredRelease,
  currentRelease,
  loadReleaseRecords,
  parseReleaseRecords,
} from "../site/releases/records.ts";
import { type Publication, releaseCatalogue } from "../site/releases/model.ts";

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.iso.datetime().nullable(),
  assets: z.array(
    z.object({ name: z.string(), state: z.string(), size: z.number() }),
  ),
});
export interface ReleaseContext {
  records: AuthoredRelease[];
  published: Publication[];
  ancestors: string[];
}
const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Parse complete paginated GitHub evidence, requiring native assets for the selected version. */
export function publishedReleases(
  input: unknown,
  currentVersion: string = DISCERN_VERSION,
): Publication[] {
  const pages = z.array(z.array(githubReleaseSchema)).parse(input);
  return pages.flat().filter((release) => !release.draft).map((release) => {
    const version = release.tag_name.startsWith("v")
      ? release.tag_name.slice(1)
      : "";
    const parsed = parseVersion(version);
    if (release.prerelease !== ((parsed.prerelease?.length ?? 0) > 0)) {
      throw new Error(
        `${release.tag_name}: GitHub prerelease flag disagrees with SemVer`,
      );
    }
    if (release.published_at === null) {
      throw new Error(`${release.tag_name}: missing publication date`);
    }
    const assets = new Set(
      release.assets.filter((asset) =>
        asset.state === "uploaded" && asset.size > 0
      ).map((asset) => asset.name),
    );
    const required = version === currentVersion
      ? BUILD_TARGETS.flatMap(releaseArtifactPaths).map((path) =>
        path.replace(/^dist\//, "")
      )
      : [...assets].filter((name) =>
        name.startsWith("discern-") && !name.endsWith(".sha256")
      ).flatMap((name) => [name, `${name}.sha256`]);
    if (required.length === 0 || required.some((name) => !assets.has(name))) {
      throw new Error(
        `${release.tag_name}: published release is missing required binary/checksum assets`,
      );
    }
    return { version, date: release.published_at.slice(0, 10) };
  });
}

/** Keep release-history reads usable without exposing the CI environment. */
function releaseGit(args: string[], root: string): Promise<GitResult> {
  return runGit(args, {
    cwd: root,
    bin: "git",
    environmentPermissionFallback: "isolated-read-only",
  });
}

/** Read tagged authoring bytes through Git, preserving named diagnostics. */
async function taggedRecords(
  version: string,
  root: string,
): Promise<AuthoredRelease[]> {
  const tag = `v${version}`;
  const listed = await releaseGit([
    "ls-tree",
    "-r",
    "--name-only",
    tag,
    "--",
    "site/releases/records/",
  ], root);
  if (!listed.success) {
    throw new Error(
      `${tag}: cannot read release records; fetch immutable release tags: ${listed.stderr}`,
    );
  }
  const sources = [];
  for (const path of listed.stdout.trim().split("\n").filter(Boolean)) {
    const read = await releaseGit(["show", `${tag}:${path}`], root);
    if (!read.success) {
      throw new Error(
        `${tag}:${path}: cannot read published release record: ${read.stderr}`,
      );
    }
    sources.push({ path: `${tag}/${path}`, markdown: read.stdout });
  }
  return parseReleaseRecords(sources);
}

/** Reconcile the current authority with fresh publication observations and tag ancestry. */
export async function loadReleaseContext(
  snapshotPath: string,
  root: string = ROOT,
  currentVersion: string = DISCERN_VERSION,
): Promise<ReleaseContext> {
  const published = publishedReleases(
    JSON.parse(await Deno.readTextFile(snapshotPath)),
    currentVersion,
  );
  const records = await loadReleaseRecords(
    toFileUrl(`${root}/site/releases/records/`),
  );
  releaseCatalogue(records, published);
  const ancestors: string[] = [];
  for (const release of published) {
    const baseline = await taggedRecords(release.version, root);
    currentRelease(baseline, release.version);
    const publishedFamilies = baseline.filter((record) =>
      record.version === release.version ||
      (record.declaredCodename !== undefined &&
        versionFamily(record.version) === versionFamily(release.version))
    );
    assertPublishedCodenames(records, publishedFamilies);
    const ancestor = await releaseGit([
      "merge-base",
      "--is-ancestor",
      `v${release.version}`,
      "HEAD",
    ], root);
    if (ancestor.success) ancestors.push(release.version);
    else if (ancestor.code !== 1) {
      throw new Error(
        `v${release.version}: cannot establish release ancestry: ${ancestor.stderr}`,
      );
    }
  }
  return { records, published, ancestors };
}
