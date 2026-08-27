/** Fire when the manual root adds or replaces a promoted journey. */

import { isAbsolute } from "@std/path";
import type { CheckpointWhenInput } from "../../src/shared/checkpoints.ts";
import { lstatIfExists } from "../../src/shared/fs_presence.ts";
import { resolveContainedProjectReadPath } from "../../src/shared/project_path.ts";
import { type GitResult, runGit } from "../../src/shared/subprocess.ts";
import {
  MANUAL_FRONT_DOORS_END,
  MANUAL_FRONT_DOORS_START,
  MANUAL_PAGE_MAX_BYTES,
  manualFrontDoorDestinations,
} from "../../src/lib/manual.ts";
import { REPOSITORY_MANUAL_REL } from "../../src/shared/manual.ts";
import { checkpointWhenInputFromEnvironment } from "./checkpoint_when_input.ts";

export const MANUAL_FRONT_DOOR_CHECKPOINT_ID = "manual-front-door-promotion";
export const MANUAL_FRONT_DOOR_PATH = `${REPOSITORY_MANUAL_REL}/README.md`;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UTF8_ENCODER = new TextEncoder();

/** Convert malformed or unreadable matcher input into one fail-closed error. */
function fail(message: string): never {
  throw new Error(message);
}

/** Decode bounded source bytes without replacing malformed input. */
function exactUtf8(bytes: Uint8Array, label: string): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return fail(`${label} is not valid UTF-8`);
  }
}

/** Preserve exact Git output bytes when the subprocess boundary provides them. */
function gitBytes(result: GitResult): Uint8Array {
  return result.stdoutBytes ?? UTF8_ENCODER.encode(result.stdout);
}

/** Resolve and canonicalize the invoking checkout root through Git. */
async function rootPath(cwd: string): Promise<string> {
  const result = await runGit(["rev-parse", "--show-toplevel"], {
    cwd,
    bin: "git",
    timeoutMs: 2_000,
    maxOutputBytes: 16 * 1024,
  });
  if (!result.success) return fail("Git root discovery failed");
  const root = exactUtf8(gitBytes(result), "Git root output").trim();
  if (!isAbsolute(root)) {
    return fail("Git root discovery returned no absolute path");
  }
  return await Deno.realPath(root);
}

/** Read a non-empty promoted-destination list from one root README. */
function destinations(markdown: string, label: string): string[] {
  const values = manualFrontDoorDestinations(markdown);
  if (values.length === 0) {
    return fail(
      `${label} must carry direct links between ${MANUAL_FRONT_DOORS_START} and ${MANUAL_FRONT_DOORS_END}`,
    );
  }
  return values;
}

/** True when the current authority promotes any destination the base did not. */
export function addsOrReplacesFrontDoor(
  before: readonly string[],
  after: readonly string[],
): boolean {
  const existing = new Set(before);
  return after.some((destination) => !existing.has(destination));
}

/** Read the policy commit's exact manual-root authority with a byte bound. */
async function governingRoot(
  root: string,
  commit: string,
): Promise<string> {
  const result = await runGit(["show", `${commit}:${MANUAL_FRONT_DOOR_PATH}`], {
    cwd: root,
    bin: "git",
    timeoutMs: 2_000,
    maxOutputBytes: MANUAL_PAGE_MAX_BYTES + 4_096,
  });
  if (!result.success || result.outputLimitExceeded === true) {
    return fail("the governing manual front door could not be read");
  }
  return exactUtf8(gitBytes(result), "governing manual front door");
}

/** Read the current bounded regular manual-root authority inside the checkout. */
async function currentRoot(root: string): Promise<string> {
  const path = await resolveContainedProjectReadPath(
    root,
    MANUAL_FRONT_DOOR_PATH,
  );
  if (path === undefined) {
    return fail("the current manual front door leaves the project");
  }
  const info = await lstatIfExists(path);
  if (
    info === undefined || !info.isFile || info.isSymlink ||
    info.size > MANUAL_PAGE_MAX_BYTES
  ) {
    return fail(
      "the current manual front door is not one bounded regular file",
    );
  }
  return exactUtf8(await Deno.readFile(path), "current manual front door");
}

/** Decide whether the current root adds or replaces a promoted destination. */
async function promotionChanged(
  cwd: string,
  input: CheckpointWhenInput,
): Promise<boolean> {
  const change = input.changed_files.find((file) =>
    file.path === MANUAL_FRONT_DOOR_PATH
  );
  if (change === undefined) return false;
  if (change.binary) return fail("the manual front door is binary");
  if (change.kind === "deleted") return false;
  const root = await rootPath(cwd);
  const [before, after] = await Promise.all([
    governingRoot(root, input.policy_commit),
    currentRoot(root),
  ]);
  return addsOrReplacesFrontDoor(
    destinations(before, "governing manual front door"),
    destinations(after, "current manual front door"),
  );
}

/** Emit a match only when the governed front door grows or replaces a member. */
async function main(): Promise<number> {
  const input = await checkpointWhenInputFromEnvironment({
    id: MANUAL_FRONT_DOOR_CHECKPOINT_ID,
    mode: "stop",
  });
  if (!(await promotionChanged(Deno.cwd(), input))) return 1;
  console.log(`DISCERN_MATCH ${MANUAL_FRONT_DOOR_PATH}`);
  return 0;
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `${MANUAL_FRONT_DOOR_CHECKPOINT_ID}: ${message}; firing closed`,
    );
    Deno.exit(0);
  }
}
