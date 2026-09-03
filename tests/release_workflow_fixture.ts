/** Test support that executes release commands from the workflow itself. */

import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import { assert } from "@std/assert";

const RELEASE_WORKFLOW = new URL(
  "../.github/workflows/release.yml",
  import.meta.url,
);

interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
  readonly "working-directory"?: string;
}

interface ReleaseWorkflow {
  readonly jobs?: {
    readonly build?: { readonly steps?: readonly WorkflowStep[] };
  };
}

/** Read one named build step from the parsed release workflow. */
export async function releaseBuildStep(name: string): Promise<WorkflowStep> {
  const parsed = parseYaml(await Deno.readTextFile(RELEASE_WORKFLOW)) as
    | ReleaseWorkflow
    | undefined;
  const step = parsed?.jobs?.build?.steps?.find((candidate) =>
    candidate.name === name
  );
  assert(step !== undefined, `release workflow has a ${name} build step`);
  return step;
}

/** Run the workflow's exact checksum command against one fixture artifact. */
export async function createWorkflowChecksum(
  root: string,
  output: string,
): Promise<string> {
  const step = await releaseBuildStep("Checksum");
  assert(step.run !== undefined, "checksum step has a shell command");
  assert(
    step["working-directory"] === "dist",
    "checksum step runs in dist",
  );
  const command = step.run.replaceAll("${{ matrix.output }}", output);
  const result = await new Deno.Command("/bin/sh", {
    args: ["-c", command],
    cwd: join(root, "dist"),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `release checksum command failed: ${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  }
  return join(root, "dist", `${output}.sha256`);
}
