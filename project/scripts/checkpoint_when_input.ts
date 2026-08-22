/**
 * Strict reader for the versioned input artifact supplied to checkpoint
 * `when` commands. Project-authored matchers share this boundary so a new
 * command cannot drift into a looser interpretation of the Engine contract.
 */

import { isAbsolute } from "@std/path";
import {
  CHECKPOINT_CHANGE_KINDS,
  CHECKPOINT_MODES,
  CHECKPOINT_WHEN_INPUT_VERSION,
  type CheckpointChangeKind,
  type CheckpointMode,
  type CheckpointWhenInput,
} from "../../src/shared/checkpoints.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../src/shared/environment_variables.ts";
import { projectRelativePathIssue } from "../../src/shared/project_path.ts";

/** Default maximum size of the Engine-authored input file. */
export const CHECKPOINT_WHEN_INPUT_MAX_BYTES = 512 * 1024;

/** Default maximum changed-file population one matcher will inspect. */
export const CHECKPOINT_WHEN_MAX_CHANGED_FILES = 2_048;

const MAX_PATH_BYTES = 4_096;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** The exact checkpoint identity one matcher is licensed to serve. */
export interface CheckpointWhenInputContract {
  readonly id: string;
  readonly mode: CheckpointMode;
  readonly maxInputBytes?: number;
  readonly maxChangedFiles?: number;
}

/** Raise one boundary-validation failure with a stable message. */
function fail(message: string): never {
  throw new Error(message);
}

/** Require a decoded JSON object. */
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** Require an object's exact versioned field set. */
function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const admitted = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !admitted.has(key));
  if (missing.length > 0 || extra.length > 0) {
    const facts = [
      ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
      ...(extra.length > 0 ? [`unknown ${extra.join(", ")}`] : []),
    ];
    fail(`${label} has the wrong fields (${facts.join("; ")})`);
  }
}

/** Require one JSON string field. */
function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") return fail(`${label} must be a string`);
  return value;
}

/** Require one non-negative safe integer field. */
function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

/** Decode one checkpoint mode against the shared registry. */
function checkpointMode(value: unknown): CheckpointMode {
  for (const mode of CHECKPOINT_MODES) {
    if (value === mode) return mode;
  }
  return fail("checkpoint.mode is not a supported checkpoint mode");
}

/** Decode one change kind against the shared registry. */
function changeKind(value: unknown, label: string): CheckpointChangeKind {
  for (const kind of CHECKPOINT_CHANGE_KINDS) {
    if (value === kind) return kind;
  }
  return fail(`${label} is not a supported checkpoint change kind`);
}

/** Decode one bounded changed-file fact. */
function changedFile(
  value: unknown,
  index: number,
): CheckpointWhenInput["changed_files"][number] {
  const label = `changed_files[${index}]`;
  const item = record(value, label);
  exactKeys(
    item,
    ["path", "kind", "insertions", "deletions", "binary"],
    [],
    label,
  );
  const path = stringValue(item.path, `${label}.path`);
  if (
    UTF8_ENCODER.encode(path).byteLength > MAX_PATH_BYTES ||
    projectRelativePathIssue(path) !== undefined
  ) {
    fail(`${label}.path must be a bounded portable project-relative path`);
  }
  if (typeof item.binary !== "boolean") {
    fail(`${label}.binary must be a Boolean`);
  }
  return {
    path,
    kind: changeKind(item.kind, `${label}.kind`),
    insertions: nonNegativeInteger(item.insertions, `${label}.insertions`),
    deletions: nonNegativeInteger(item.deletions, `${label}.deletions`),
    binary: item.binary,
  };
}

/** Decode optional checkpoint replay history. */
function historyValue(
  value: unknown,
): NonNullable<CheckpointWhenInput["history"]> {
  const history = record(value, "history");
  exactKeys(history, ["count", "fingerprint"], [], "history");
  const fingerprint = stringValue(
    history.fingerprint,
    "history.fingerprint",
  );
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    fail("history.fingerprint must be a lowercase SHA-256 digest");
  }
  return {
    count: nonNegativeInteger(history.count, "history.count"),
    fingerprint,
  };
}

/** Parse and validate one version-1 input against a matcher's identity. */
export function parseCheckpointWhenInput(
  text: string,
  contract: CheckpointWhenInputContract,
): CheckpointWhenInput {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return fail("checkpoint input is not valid JSON");
  }
  const input = record(decoded, "checkpoint input");
  exactKeys(
    input,
    ["version", "checkpoint", "policy_commit", "changed_files"],
    ["history"],
    "checkpoint input",
  );
  if (input.version !== CHECKPOINT_WHEN_INPUT_VERSION) {
    fail(
      `checkpoint input version must be ${CHECKPOINT_WHEN_INPUT_VERSION}`,
    );
  }

  const checkpoint = record(input.checkpoint, "checkpoint");
  exactKeys(checkpoint, ["id", "mode"], [], "checkpoint");
  const id = stringValue(checkpoint.id, "checkpoint.id");
  if (id !== contract.id) fail(`checkpoint.id must be ${contract.id}`);
  const mode = checkpointMode(checkpoint.mode);
  if (mode !== contract.mode) {
    fail(`${contract.id} must run in ${contract.mode} mode`);
  }

  const policyCommit = stringValue(input.policy_commit, "policy_commit");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(policyCommit)) {
    fail("policy_commit must be a lowercase Git object id");
  }
  if (!Array.isArray(input.changed_files)) {
    fail("changed_files must be an array");
  }
  const maxChangedFiles = contract.maxChangedFiles ??
    CHECKPOINT_WHEN_MAX_CHANGED_FILES;
  if (input.changed_files.length > maxChangedFiles) {
    fail(`changed_files exceeds the ${maxChangedFiles}-file limit`);
  }
  const changedFiles = input.changed_files.map(changedFile);
  for (let index = 1; index < changedFiles.length; index += 1) {
    const previous = changedFiles[index - 1]?.path;
    const current = changedFiles[index]?.path;
    if (
      previous === undefined || current === undefined || previous >= current
    ) {
      fail("changed_files paths must be unique and sorted");
    }
  }

  const history = input.history === undefined
    ? undefined
    : historyValue(input.history);
  return {
    version: CHECKPOINT_WHEN_INPUT_VERSION,
    checkpoint: { id, mode },
    policy_commit: policyCommit,
    changed_files: changedFiles,
    ...(history === undefined ? {} : { history }),
  };
}

/** Decode bounded bytes as strict UTF-8. */
function exactUtf8(bytes: Uint8Array): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return fail("DISCERN_CHECKPOINT_INPUT is not valid UTF-8");
  }
}

/** Read and validate the Engine-authored input named by its environment key. */
export async function checkpointWhenInputFromEnvironment(
  contract: CheckpointWhenInputContract,
): Promise<CheckpointWhenInput> {
  const variable = DISCERN_ENVIRONMENT_VARIABLES.checkpointInput;
  const path = Deno.env.get(variable);
  if (path === undefined || path === "") return fail(`${variable} is not set`);
  if (!isAbsolute(path)) {
    return fail("DISCERN_CHECKPOINT_INPUT must be an absolute path");
  }
  const info = await Deno.lstat(path).catch(() => undefined);
  if (info === undefined || !info.isFile || info.isSymlink) {
    return fail("DISCERN_CHECKPOINT_INPUT must name a regular file");
  }
  const maxBytes = contract.maxInputBytes ?? CHECKPOINT_WHEN_INPUT_MAX_BYTES;
  if (info.size > maxBytes) {
    return fail("DISCERN_CHECKPOINT_INPUT exceeds the input-size limit");
  }
  const bytes = await Deno.readFile(path);
  if (bytes.byteLength > maxBytes) {
    return fail("DISCERN_CHECKPOINT_INPUT grew beyond the input-size limit");
  }
  return parseCheckpointWhenInput(exactUtf8(bytes), contract);
}
