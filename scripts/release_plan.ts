/** Validate a release tag and derive its native build matrix. */

import { DISCERN_VERSION } from "../src/lib/version.ts";
import { BUILD_TARGETS, type BuildTarget } from "./build_targets.ts";
import type { EnvReader } from "../src/shared/env.ts";

export interface ReleaseMatrixRow {
  gateBeforeBuild: boolean;
  os: string;
  output: string;
  target: string;
}

export interface ReleasePlan {
  makeLatest: boolean;
  matrix: { include: ReleaseMatrixRow[] };
  prerelease: boolean;
  version: string;
}

export interface ReleasePlanOptions {
  repositoryPrivate: boolean;
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
  const prerelease = version.includes("-");
  return {
    version,
    prerelease,
    makeLatest: !prerelease,
    matrix: {
      include: targets.map((target) => ({
        gateBeforeBuild: target.gateBeforeBuild === true,
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
  if (tag === undefined || githubOutput === undefined) {
    throw new Error(
      "usage: release_plan.ts <release-tag> <github-output-path>",
    );
  }
  const repositoryPrivate = env.get("REPOSITORY_PRIVATE");
  if (repositoryPrivate !== "true" && repositoryPrivate !== "false") {
    throw new Error("REPOSITORY_PRIVATE must be exactly true or false");
  }
  const plan = releasePlan(tag, {
    repositoryPrivate: repositoryPrivate === "true",
  });
  await Deno.writeTextFile(
    githubOutput,
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
