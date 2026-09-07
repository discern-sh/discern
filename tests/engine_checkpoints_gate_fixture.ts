/**
 * Shared fixture definitions and read-only probes for checkpoint gate
 * journeys. A journey module builds one repository per top-level test and
 * walks a lifecycle in steps; the builders and probes here keep every module
 * reading the same governing policy, the same markers, and the same Logbook.
 */
import { assert } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import {
  type LogbookEvent,
  parseLogbookLine,
} from "../src/engine/logbook/schema.ts";
import { CompletionProofPointerSchema } from "../src/shared/completion_proof.ts";
import {
  readDirIfExists,
  readTextIfExists,
} from "../src/shared/fs_presence.ts";
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

/** Read one Git-admin marker without creating it. */
export async function adminMarker(
  wt: string,
  name: "checkpointOpenQuestions" | "gateProof" | "lastGateRun",
): Promise<string | undefined> {
  const path = await gitAdminStatePath(wt, name);
  assert(path !== undefined, `${name} path must resolve`);
  return await readTextIfExists(path);
}

/**
 * The marker a {@link CHECK_TOUCHES} job or {@link WHEN_TOUCHES} probe leaves
 * beside the worktree — both run with the worktree as their cwd and write
 * `../<name>` — or the empty string while nothing has run.
 */
export async function sidecarMarker(wt: string, name: string): Promise<string> {
  return (await readTextIfExists(join(wt, "..", name))) ?? "";
}

/** Every raw Logbook line under the project, in file order — raw text first,
 * so exclusion claims cover every byte, then the parsed events. */
export async function readLogbook(
  dir: string,
): Promise<{ raw: string; events: LogbookEvent[] }> {
  const logDir = join(dir, ".git", "discern", "logbook");
  const entries = await readDirIfExists(logDir);
  if (entries === undefined) {
    return { raw: "", events: [] };
  }
  const names = entries
    .filter((entry) => entry.isFile && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();
  let raw = "";
  const events: LogbookEvent[] = [];
  for (const name of names) {
    const text = await Deno.readTextFile(join(logDir, name));
    raw += text;
    for (const line of text.split("\n").filter((item) => item !== "")) {
      const parsed = parseLogbookLine(line);
      assert(parsed.kind === "event", `unparseable logbook line: ${line}`);
      events.push(parsed.event);
    }
  }
  return { raw, events };
}

/** Count Logbook verb events carrying checkpoint lifecycle observations. Read
 * surfaces still record their ordinary invocation event; they must never
 * counterfeit a firing, reopen, declaration, or advisory serving. */
export async function checkpointObservationEvents(
  dir: string,
): Promise<number> {
  const { events } = await readLogbook(dir);
  return events.filter((event) =>
    event.kind === "verb" && event.checkpoints !== undefined
  ).length;
}

export const QUESTION_API =
  "A changed API surface is described in its docs before it lands.";

export const QUESTION_NOTES =
  "A risky change names what could break, for review.";

export const LINE_SEPARATOR = "\u2028";
export const PARAGRAPH_SEPARATOR = "\u2029";

/** A question carrying the two Unicode separators a single-line terminal sink
 * must render as visible, inert notation. */
export const HOSTILE_QUESTION =
  `Does the ${LINE_SEPARATOR} changed surface preserve ${PARAGRAPH_SEPARATOR} its contract?`;

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

/** Two stop checkpoints on the same paths — the batched-refusal shape. */
export const CONFIG_TWO_CHECKPOINTS = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION_API}"

[checkpoints.risk-notes]
paths = ["api/**"]
question = "${QUESTION_NOTES}"
`;

/** A stop checkpoint vetoed by any docs change in the effort. */
export const CONFIG_UNLESS_CHANGED = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
unless_changed = ["docs/**"]
question = "${QUESTION_API}"
`;

/** A stop checkpoint whose trigger ends in a `when` command the fixture
 * supplies through {@link WHEN_TOUCHES}. */
export const CONFIG_WHEN = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh when-probe.sh"
question = "${QUESTION_API}"
`;

export const CONFIG_NO_CHECKPOINTS = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"
`;

/** The one-checkpoint gate whose question carries hostile separators. */
export const CONFIG_SEPARATOR_QUESTION = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = ${JSON.stringify(HOSTILE_QUESTION)}
teach = "State the failure modes; note what callers must revisit."
`;

export const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Marker file the check job writes when it RUNS — proof of "no gate job ran". */
export const CHECK_TOUCHES =
  "#!/usr/bin/env sh\necho ran >> ../gate-ran.log\nexit 0\n";

/** A check job that fails, for red-gate journeys. */
export const CHECK_RED = "#!/usr/bin/env sh\nexit 9\n";

/** A `when` command that PROVES it ran by leaving a marker. A read surface
 * must never run it, so the marker must never appear from `checkpoints`. */
export const WHEN_TOUCHES =
  "#!/usr/bin/env sh\necho ran >> ../when-ran.log\nexit 0\n";

/** Scaffold main with `config`, then a worktree carrying one committed change
 * under `api/` — the state whose `done` the checkpoint governs. `whenProbe`
 * commits a `when-probe.sh` on main for configs that name one. */
export async function worktreeWithApiChange(
  dir: string,
  config: string,
  check: string = CHECK_OK,
  opts: { changedPath?: string; whenProbe?: string } = {},
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), check);
  if (opts.whenProbe !== undefined) {
    await writeExecutable(join(dir, "when-probe.sh"), opts.whenProbe);
  }
  await gitInit(dir);
  const wt = await addWorktree(dir, "checkpointed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(
    join(wt, opts.changedPath ?? "api/surface.txt"),
    "endpoint\n",
  );
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

/** Restore the worktree's committed state after a fixer surface ran:
 * `prepare` refreshes generated agent artifacts by design, so a journey step
 * that runs it restores the tree it committed before any step that expects a
 * clean checkout — a green `done` only records Proof over a clean tree. */
export async function restoreCommittedTree(wt: string): Promise<void> {
  await git(wt, "checkout", "--", ".");
  await git(wt, "clean", "-fdq");
}

/** Commit a docs file beside the api change — the edit that makes an
 * `unless_changed = ["docs/**"]` trigger idle. */
export async function commitDocs(wt: string): Promise<void> {
  await Deno.mkdir(join(wt, "docs"), { recursive: true });
  await Deno.writeTextFile(join(wt, "docs", "api.md"), "documented\n");
  await git(wt, "add", "docs/api.md");
  await git(
    wt,
    "commit",
    "-q",
    "-m",
    "docs: describe the api",
    "--no-gpg-sign",
  );
}
