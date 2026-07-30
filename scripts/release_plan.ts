/** Validate a release tag and derive its native build matrix. */

import { KIT_VERSION } from "../src/lib/version.ts";
import { BUILD_TARGETS, type BuildTarget } from "./build_targets.ts";

export interface ReleaseMatrixRow {
  gateBeforeBuild: boolean;
  os: string;
  output: string;
  target: string;
}

export interface ReleasePlan {
  matrix: { include: ReleaseMatrixRow[] };
  version: string;
}

/** Refuse version skew before any artifact is built or published. */
export function releasePlan(
  tag: string,
  version = KIT_VERSION,
  targets: readonly BuildTarget[] = BUILD_TARGETS,
): ReleasePlan {
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(
      `release tag ${tag} does not match package version ${expectedTag}`,
    );
  }
  return {
    version,
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

async function main(): Promise<void> {
  const tag = Deno.args[0];
  const githubOutput = Deno.args[1];
  if (tag === undefined || githubOutput === undefined) {
    throw new Error(
      "usage: release_plan.ts <release-tag> <github-output-path>",
    );
  }
  const plan = releasePlan(tag);
  await Deno.writeTextFile(
    githubOutput,
    `version=${plan.version}\nmatrix=${JSON.stringify(plan.matrix)}\n`,
    { append: true },
  );
}

if (import.meta.main) {
  await main();
}
