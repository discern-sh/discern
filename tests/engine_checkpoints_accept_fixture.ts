/** Shared fixture definitions for checkpoint accept journeys. */
import { assert, assertEquals } from "@std/assert";
import { decodeBase64 } from "@std/encoding/base64";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { ProofNotePayloadSchema } from "../src/shared/result_schemas.ts";
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
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

export type AcceptEnvelope = CliResultForCommand<"accept">;

export type AcceptWireData = Exclude<
  NonNullable<AcceptEnvelope["data"]>,
  { issues: unknown }
>;

type AcceptMessageEnvelope = AcceptEnvelope & { message: string };

type AppliedAcceptEnvelope = Omit<AcceptEnvelope, "data"> & {
  data: AcceptWireData & {
    root: string;
    consent: NonNullable<AcceptWireData["consent"]>;
    landing: NonNullable<AcceptWireData["landing"]>;
  };
};

const DSSE_ENVELOPE_SCHEMA = z.object({ payload: z.string() }).passthrough();

/** Decode one accept envelope without requiring review or landing data. */
export function parseAcceptJson(stdout: string): AcceptEnvelope {
  return decodeCliResult(stdout, "accept");
}

/** Decode an accept refusal whose assertions consume its authored message. */
export function parseAcceptMessageJson(stdout: string): AcceptMessageEnvelope {
  const result = parseAcceptJson(stdout);
  assert(typeof result.message === "string");
  return { ...result, message: result.message };
}

/** Decode an acceptance that crossed the landing boundary. */
export function parseAppliedAcceptJson(stdout: string): AppliedAcceptEnvelope {
  const result = parseAcceptJson(stdout);
  assertResultDataKey(result, "root");
  assert(typeof result.data.root === "string");
  const { consent, landing } = result.data;
  assert(consent !== undefined && landing !== undefined, stdout);
  assert(landing.trunk_landed, stdout);
  return {
    ...result,
    data: { ...result.data, root: result.data.root, consent, landing },
  };
}

export const QUESTION =
  "A changed surface is described in its docs before it lands.";

export const RATIONALE =
  "The docs lag the new surface; a follow-up covers them.";

/** A gate whose one check always passes, plus one stop checkpoint watching
 * `api/**` — the policy every accept journey's effort is governed by. */
export const CONFIG_ONE_STOP = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION}"
`;

/** The same gate plus a trunk-recorded standing grant covering EVERY path the
 * effort changes — the authority that must still never cover a variance. */
export const CONFIG_WITH_GRANT = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[scopes.api]
paths = ["api/**"]

[checkpoints.api-review]
scope = "api"
question = "${QUESTION}"

[acceptance]
pre_authorized = ["api"]
`;

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Scaffold main + a worktree with one committed change under `api/`. */
export async function checkpointedWorktree(
  dir: string,
  config: string = CONFIG_ONE_STOP,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), CHECK_OK);
  await gitInit(dir);
  const wt = await addWorktree(dir, "varianced");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

/** Drive the worktree to a green gate with a declared-unmet conclusion: the
 * opening run both serves the question and records the conclusion. */
export async function greenWithUnmet(wt: string): Promise<void> {
  const green = await runAgent(wt, [
    "done",
    "--unmet",
    "api-review",
    "--why",
    RATIONALE,
    "--json",
  ]);
  assertEquals(green.code, 0, green.output);
}

/** Decode the landed Proof note's DSSE payload at `commit`. */
export async function landedNotePayload(
  dir: string,
  commit: string,
): Promise<z.output<typeof ProofNotePayloadSchema>> {
  const note = await gitOut(
    dir,
    "notes",
    "--ref=discern",
    "show",
    commit,
  );
  const envelope = decodeWith(DSSE_ENVELOPE_SCHEMA, note);
  return decodeWith(
    ProofNotePayloadSchema,
    new TextDecoder().decode(decodeBase64(envelope.payload)),
  );
}
