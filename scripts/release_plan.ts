/** Validate a release tag and derive its native build matrix. */

import { compareVersions, parseVersion } from "../src/shared/semver.ts";
import {
  type AuthoredRelease,
  currentRelease,
} from "../site/releases/records.ts";
import type { Publication } from "../site/releases/model.ts";
import { releaseLabel } from "../site/releases/presentation.ts";
import { loadReleaseContext } from "./release_publication.ts";
import { verifyReleaseMetadata } from "./release_metadata.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { BUILD_TARGETS, type BuildTarget } from "./build_targets.ts";
import type { EnvReader } from "../src/shared/env.ts";

export interface ReleaseMatrixRow {
  os: string;
  output: string;
  target: string;
}

export interface ReleasePlan {
  makeLatest: boolean;
  body: string;
  title: string;
  matrix: { include: ReleaseMatrixRow[] };
  prerelease: boolean;
  version: string;
}

export interface ReleasePlanOptions {
  repositoryPrivate: boolean;
  records: readonly AuthoredRelease[];
  published: readonly Publication[];
  ancestors: readonly string[];
  targets?: readonly BuildTarget[];
  version?: string;
}

/** Refuse version skew before any artifact is built or published. */
export function releasePlan(
  tag: string,
  options: ReleasePlanOptions,
): ReleasePlan {
  if (options.repositoryPrivate) {
    throw new Error(
      `release tag ${tag} cannot run while the repository is private; ` +
        "make the repository public and complete launch lock-down 8A before tagging",
    );
  }
  const version = options.version ?? DISCERN_VERSION;
  const targets = options.targets ?? BUILD_TARGETS;
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(
      `release tag ${tag} does not match package version ${expectedTag}`,
    );
  }
  const selected = currentRelease(options.records, version);
  for (const published of options.published) {
    currentRelease(options.records, published.version);
    if (!options.ancestors.includes(published.version)) {
      throw new Error(
        `release ${tag} would regress the production catalogue: source must descend from published tag v${published.version}; compose the current release source before tagging`,
      );
    }
  }
  const prerelease = (parseVersion(version).prerelease?.length ?? 0) > 0;
  const stable = options.published.filter((release) =>
    (parseVersion(release.version).prerelease?.length ?? 0) === 0
  );
  const makeLatest = !prerelease &&
    stable.every((release) => compareVersions(version, release.version) >= 0);
  return {
    version,
    prerelease,
    makeLatest,
    body: `${selected.summary}\n\n${selected.body}\n`,
    title: `discern ${releaseLabel(selected)}`,
    matrix: {
      include: targets.map((target) => ({
        target: target.triple,
        output: target.output,
        os: target.runner,
      })),
    },
  };
}

/** Validate the release tag and append its version and native build matrix to GitHub output. */
async function main(env: EnvReader = Deno.env): Promise<void> {
  const tag = Deno.args[0];
  const githubOutput = Deno.args[1];
  const snapshotPath = Deno.args[2];
  const bodyPath = Deno.args[3];
  if (
    tag === undefined || githubOutput === undefined ||
    snapshotPath === undefined || bodyPath === undefined
  ) {
    throw new Error(
      "usage: release_plan.ts <release-tag> <github-output-path> <github-releases-json> <release-body-path>",
    );
  }
  const repositoryPrivate = env.get("REPOSITORY_PRIVATE");
  if (repositoryPrivate !== "true" && repositoryPrivate !== "false") {
    throw new Error("REPOSITORY_PRIVATE must be exactly true or false");
  }
  const context = await loadReleaseContext(snapshotPath);
  await verifyReleaseMetadata();
  const plan = releasePlan(tag, {
    ...context,
    repositoryPrivate: repositoryPrivate === "true",
  });
  await Deno.writeTextFile(bodyPath, plan.body);
  await Deno.writeTextFile(
    githubOutput,
    `title=${plan.title}\n` +
      `version=${plan.version}\n` +
      `matrix=${JSON.stringify(plan.matrix)}\n` +
      `prerelease=${plan.prerelease}\n` +
      `make_latest=${plan.makeLatest}\n`,
    { append: true },
  );
}

if (import.meta.main) {
  await main();
}
