/** Shared fixture definitions for checkpoint gate journeys. */
import { assert } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { CompletionProofPointerSchema } from "../src/shared/completion_proof.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import type {
  CheckpointsData,
  GateCheckpointsData,
  GateWireData,
} from "../src/shared/result_schemas.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import {
  addWorktree,
  git,
  gitInit,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

type DoneEnvelope = CliResultForCommand<"done">;

type GateDoneEnvelope = DoneEnvelope & {
  data: GateWireData;
};

/** The wire fields payload-specific assertions read from a `done` envelope. */
type CheckpointDoneEnvelope = GateDoneEnvelope & {
  data: GateWireData & { checkpoints: GateCheckpointsData };
};

type CheckpointsEnvelope =
  & Omit<
    CliResultForCommand<"checkpoints">,
    "data"
  >
  & { data: CheckpointsData };

const ProofMarkerDataSchema = z.object({
  checkpoints: z.object({
    declared_met: z.array(z.object({ id: z.string() }).passthrough())
      .optional(),
    declared_unmet: z.array(z.object({ why: z.string() }).passthrough())
      .optional(),
  }).passthrough(),
}).passthrough();

const GateProofMarkerSchema = z.strictObject({
  completion: CompletionProofPointerSchema.optional(),
  version: z.literal(ON_DISK_FORMATS.gateProof.version),
  head: z.string().min(1),
  mode: z.enum(["strict", "report"]),
  proof: ProofMarkerDataSchema.optional(),
  evidence: z.string().min(1).optional(),
});

/** Decode one done envelope without requiring a gate payload on refusals or previews. */
export function parseJson(stdout: string): DoneEnvelope {
  return decodeCliResult(stdout, "done");
}

/** Decode a done result whose assertions consume gate data but no checkpoint state. */
export function parseGateJson(stdout: string): GateDoneEnvelope {
  const result = parseJson(stdout);
  assertResultDataKey(result, "failed_stage");
  return result;
}

/** Decode a done result whose assertions consume checkpoint gate data. */
export function parseCheckpointGateJson(
  stdout: string,
): CheckpointDoneEnvelope {
  const result = parseGateJson(stdout);
  assert(
    result.data.checkpoints !== undefined,
    `done result must carry checkpoint data: ${stdout}`,
  );
  return {
    ...result,
    data: { ...result.data, checkpoints: result.data.checkpoints },
  };
}

/** Decode a checkpoints read result with its command-owned data present. */
export function parseCheckpointsJson(stdout: string): CheckpointsEnvelope {
  const result = decodeCliResult(stdout, "checkpoints");
  assert(
    result.data !== undefined && "checkpoints" in result.data,
    `checkpoints result must carry report data: ${stdout}`,
  );
  return { ...result, data: result.data };
}

/** The recorded gate-proof marker's registered JSON content. */
export async function proofMarker(wt: string): Promise<string> {
  const path = await gitAdminStatePath(wt, "gateProof");
  assert(path !== undefined, "the gate-proof path must resolve");
  return await Deno.readTextFile(path);
}

/** Decode the registered Gate Proof fixture through its frozen format. */
export function decodedProofMarker(
  raw: string,
): z.infer<typeof GateProofMarkerSchema> {
  return decodeWith(GateProofMarkerSchema, raw);
}

export const QUESTION_API =
  "A changed API surface is described in its docs before it lands.";

export const QUESTION_NOTES =
  "A risky change names what could break, for review.";

/** A gate whose one check always passes, plus one stop checkpoint watching
 * `api/**`. The config is committed by `gitInit`, so the worktree's
 * merge-base carries it — the governing copy. */
export const CONFIG_ONE_CHECKPOINT = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION_API}"
teach = "State the failure modes; note what callers must revisit."
`;

export const CONFIG_ADVISE = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
mode = "advise"
question = "${QUESTION_API}"
`;

export const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Marker file the check job writes when it RUNS — proof of "no gate job ran". */
export const CHECK_TOUCHES =
  "#!/usr/bin/env sh\necho ran >> ../gate-ran.log\nexit 0\n";

/** Scaffold main with `config`, then a worktree carrying one committed change
 * under `api/` — the state whose `done` the checkpoint governs. */
export async function worktreeWithApiChange(
  dir: string,
  config: string,
  check: string = CHECK_OK,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), check);
  await gitInit(dir);
  const wt = await addWorktree(dir, "checkpointed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}
