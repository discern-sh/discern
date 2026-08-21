/**
 * Select changed pages that belong to discern's published manual.
 *
 * The checkpoint engine pre-scopes the change to the configured Map and passes
 * versioned facts through `DISCERN_CHECKPOINT_INPUT`. This script validates
 * those facts again at the process boundary, reads the governing Map location
 * from the policy commit, and delegates both audience tiers and page-level
 * publication to the document model. Deleted pages are read from that same Git
 * tree, so removing a published page still receives audience judgment.
 *
 * The command is deliberately read-only: bounded local file and Git reads, no
 * network, and `DISCERN_MATCH` output only for paths already admitted by the
 * checkpoint input.
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
import { parseConfig } from "../../src/shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../src/shared/environment_variables.ts";
import { normalizeMapDir } from "../../src/shared/map_path.ts";
import {
  projectRelativePathIssue,
  resolveContainedProjectReadPath,
} from "../../src/shared/project_path.ts";
import { type GitResult, runGit } from "../../src/shared/subprocess.ts";
import { parseFrontmatter } from "../../src/lib/frontmatter.ts";
import { type DocEntry, isPublicDoc } from "../../src/lib/docs.ts";
import {
  BUNDLED_PUBLIC_DOC_DIRS,
  MANUAL_SECTION_REGISTRY,
  type ManualSectionRegistration,
} from "../../src/lib/paths.ts";

/** The one checkpoint this command is safe to serve. */
export const PUBLIC_DOC_CHECKPOINT_ID = "public-doc-audience";

/** Maximum size of the engine-authored v1 input file. */
export const PUBLIC_DOC_CHECKPOINT_INPUT_MAX_BYTES = 512 * 1024;

/** Maximum number of changed-file facts one invocation will inspect. */
export const PUBLIC_DOC_CHECKPOINT_MAX_CHANGED_FILES = 2_048;

/** Maximum UTF-8 bytes read from one candidate Markdown page. */
export const PUBLIC_DOC_CHECKPOINT_MAX_PAGE_BYTES = 1024 * 1024;

/** Maximum UTF-8 bytes read across every candidate page. */
export const PUBLIC_DOC_CHECKPOINT_MAX_TOTAL_PAGE_BYTES = 4 * 1024 * 1024;

const POLICY_CONFIG_MAX_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const GIT_TIMEOUT_MS = 2_000;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** The document-model dependencies the matcher consults. The production value
 * points directly at the canonical registries and predicate; the seam lets a
 * focused test prove that a future tier or publication rule enrolls without a
 * copied directory list or `publish` condition here. */
export interface PublicDocCheckpointModel {
  readonly manualSections: readonly ManualSectionRegistration[];
  readonly bundledPublicDirs: readonly string[];
  readonly isPublic: (entry: Pick<DocEntry, "publish">) => boolean;
}

/** The live document model used by the command. */
export const CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL: PublicDocCheckpointModel = {
  manualSections: MANUAL_SECTION_REGISTRY,
  bundledPublicDirs: BUNDLED_PUBLIC_DOC_DIRS,
  isPublic: isPublicDoc,
};

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
  return fail(`${label} is not a supported change kind`);
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

/** Parse and strictly validate one version-1 checkpoint input document. */
export function parsePublicDocCheckpointInput(
  text: string,
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
  if (id !== PUBLIC_DOC_CHECKPOINT_ID) {
    fail(`checkpoint.id must be ${PUBLIC_DOC_CHECKPOINT_ID}`);
  }
  const mode = checkpointMode(checkpoint.mode);
  if (mode !== "stop") {
    fail(`${PUBLIC_DOC_CHECKPOINT_ID} must run in stop mode`);
  }

  const policyCommit = stringValue(input.policy_commit, "policy_commit");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(policyCommit)) {
    fail("policy_commit must be a lowercase Git object id");
  }
  if (!Array.isArray(input.changed_files)) {
    fail("changed_files must be an array");
  }
  if (input.changed_files.length > PUBLIC_DOC_CHECKPOINT_MAX_CHANGED_FILES) {
    fail(
      `changed_files exceeds the ${PUBLIC_DOC_CHECKPOINT_MAX_CHANGED_FILES}-file limit`,
    );
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

/** Decode bytes as strict UTF-8. */
function exactUtf8(bytes: Uint8Array, label: string): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return fail(`${label} is not valid UTF-8`);
  }
}

/** Preserve Git output bytes when the subprocess supplied them. */
function gitBytes(result: GitResult): Uint8Array {
  return result.stdoutBytes ?? UTF8_ENCODER.encode(result.stdout);
}

/** Convert an unsuccessful Git operation into a bounded validation failure. */
function requireGitSuccess(result: GitResult, label: string): void {
  if (!result.success) {
    const reason = result.timedOut === true
      ? "timed out"
      : result.outputLimitExceeded === true
      ? "exceeded its output limit"
      : `exited ${result.code}`;
    fail(`${label} ${reason}`);
  }
}

/** Resolve and canonicalize the enclosing Git worktree root. */
async function projectRoot(cwd: string): Promise<string> {
  const result = await runGit(["rev-parse", "--show-toplevel"], {
    cwd,
    bin: "git",
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: 16 * 1024,
  });
  requireGitSuccess(result, "Git root discovery");
  const root = exactUtf8(gitBytes(result), "Git root output").trim();
  if (!isAbsolute(root) || root === "") {
    return fail("Git root discovery returned no absolute project path");
  }
  return await Deno.realPath(root);
}

/** Read the configured Map directory from the governing policy commit. */
async function governingMapDir(
  root: string,
  policyCommit: string,
): Promise<string> {
  const result = await runGit(
    ["show", `${policyCommit}:discern.toml`],
    {
      cwd: root,
      bin: "git",
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: POLICY_CONFIG_MAX_BYTES,
    },
  );
  requireGitSuccess(result, "governing discern.toml read");
  const parsed = parseConfig(
    exactUtf8(gitBytes(result), "governing discern.toml"),
  );
  if (parsed.config === undefined || parsed.issues.length > 0) {
    return fail(
      "governing discern.toml does not satisfy the live config schema",
    );
  }
  return normalizeMapDir(parsed.config.map.dir);
}

interface BoundedText {
  readonly text: string;
  readonly bytes: number;
}

/** Read one present candidate page through the shared project boundary. */
async function currentPage(root: string, path: string): Promise<BoundedText> {
  const absolute = await resolveContainedProjectReadPath(root, path);
  if (absolute === undefined) {
    return fail(`${path} does not resolve inside the candidate worktree`);
  }
  const info = await Deno.lstat(absolute).catch(() => undefined);
  if (info === undefined || !info.isFile) {
    return fail(`${path} is not a regular candidate-worktree file`);
  }
  if (info.size > PUBLIC_DOC_CHECKPOINT_MAX_PAGE_BYTES) {
    return fail(`${path} exceeds the public-page read limit`);
  }
  const bytes = await Deno.readFile(absolute);
  if (bytes.byteLength > PUBLIC_DOC_CHECKPOINT_MAX_PAGE_BYTES) {
    return fail(`${path} exceeded the public-page read limit while reading`);
  }
  return { text: exactUtf8(bytes, path), bytes: bytes.byteLength };
}

/** Read one deleted candidate page from the governing Git tree. */
async function deletedPage(
  root: string,
  policyCommit: string,
  path: string,
): Promise<BoundedText> {
  const listed = await runGit(
    ["--literal-pathspecs", "ls-tree", "-z", policyCommit, "--", path],
    {
      cwd: root,
      bin: "git",
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: 16 * 1024,
    },
  );
  requireGitSuccess(listed, `governing tree lookup for ${path}`);
  const records = exactUtf8(gitBytes(listed), `tree entry for ${path}`)
    .split("\0").filter((entry) => entry !== "");
  const entry = records.length === 1 ? records[0] : undefined;
  if (entry === undefined) {
    return fail(`${path} is not one regular blob in the governing tree`);
  }
  const tab = entry.indexOf("\t");
  const metadata = tab < 0 ? [] : entry.slice(0, tab).split(" ");
  const treePath = tab < 0 ? undefined : entry.slice(tab + 1);
  const [mode, type, oid] = metadata;
  if (
    (mode !== "100644" && mode !== "100755") || type !== "blob" ||
    oid === undefined || treePath !== path
  ) {
    return fail(`${path} is not a regular blob in the governing tree`);
  }

  const shown = await runGit(["cat-file", "blob", oid], {
    cwd: root,
    bin: "git",
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: PUBLIC_DOC_CHECKPOINT_MAX_PAGE_BYTES + 4_096,
  });
  requireGitSuccess(shown, `governing page read for ${path}`);
  const bytes = gitBytes(shown);
  if (bytes.byteLength > PUBLIC_DOC_CHECKPOINT_MAX_PAGE_BYTES) {
    return fail(`${path} exceeds the public-page read limit`);
  }
  return { text: exactUtf8(bytes, path), bytes: bytes.byteLength };
}

/** Whether a path falls under the configured Map and a registered public manual
 * tier that the bundled public projection admits. */
export function isCanonicalPublicDocPath(
  path: string,
  mapDir: string,
  model: PublicDocCheckpointModel = CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL,
): boolean {
  const prefix = normalizeMapDir(mapDir);
  if (!path.startsWith(prefix)) return false;
  const relative = path.slice(prefix.length);
  if (!relative.endsWith(".md")) return false;
  const separator = relative.indexOf("/");
  if (separator <= 0) return false;
  const section = relative.slice(0, separator);
  const registered = model.manualSections.find((entry) =>
    entry.dir === section
  );
  return registered?.audience === "public" &&
    model.bundledPublicDirs.includes(section);
}

/** Apply the canonical page-level publication predicate to one tier-admitted
 * Markdown source. */
export function matchesCanonicalPublicDoc(
  path: string,
  markdown: string,
  mapDir: string,
  model: PublicDocCheckpointModel = CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL,
): boolean {
  if (!isCanonicalPublicDocPath(path, mapDir, model)) return false;
  const { meta } = parseFrontmatter(markdown);
  return model.isPublic({ publish: meta.publish ?? true });
}

/** Resolve the exact changed paths this checkpoint question covers. */
export async function matchingPublicDocChanges(
  cwd: string,
  input: CheckpointWhenInput,
  model: PublicDocCheckpointModel = CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL,
): Promise<string[]> {
  const root = await projectRoot(cwd);
  const mapDir = await governingMapDir(root, input.policy_commit);
  const matches: string[] = [];
  let totalPageBytes = 0;
  for (const file of input.changed_files) {
    if (!isCanonicalPublicDocPath(file.path, mapDir, model)) continue;
    if (file.binary) {
      return fail(`${file.path} is binary and cannot be judged as Markdown`);
    }
    const page = file.kind === "deleted"
      ? await deletedPage(root, input.policy_commit, file.path)
      : await currentPage(root, file.path);
    totalPageBytes += page.bytes;
    if (totalPageBytes > PUBLIC_DOC_CHECKPOINT_MAX_TOTAL_PAGE_BYTES) {
      return fail("candidate pages exceed the total public-page read limit");
    }
    if (matchesCanonicalPublicDoc(file.path, page.text, mapDir, model)) {
      matches.push(file.path);
    }
  }
  return matches;
}

/** Read and validate the engine-authored input artifact. */
async function checkpointInputFromFile(
  path: string,
): Promise<CheckpointWhenInput> {
  if (!isAbsolute(path)) {
    return fail("DISCERN_CHECKPOINT_INPUT must be an absolute path");
  }
  const info = await Deno.lstat(path).catch(() => undefined);
  if (info === undefined || !info.isFile || info.isSymlink) {
    return fail("DISCERN_CHECKPOINT_INPUT must name a regular file");
  }
  if (info.size > PUBLIC_DOC_CHECKPOINT_INPUT_MAX_BYTES) {
    return fail("DISCERN_CHECKPOINT_INPUT exceeds the input-size limit");
  }
  const bytes = await Deno.readFile(path);
  if (bytes.byteLength > PUBLIC_DOC_CHECKPOINT_INPUT_MAX_BYTES) {
    return fail("DISCERN_CHECKPOINT_INPUT grew beyond the input-size limit");
  }
  return parsePublicDocCheckpointInput(
    exactUtf8(bytes, "DISCERN_CHECKPOINT_INPUT"),
  );
}

/** Run the read-only checkpoint command. */
async function main(): Promise<number> {
  const variable = DISCERN_ENVIRONMENT_VARIABLES.checkpointInput;
  const inputPath = Deno.env.get(variable);
  if (inputPath === undefined || inputPath === "") {
    return fail(`${variable} is not set`);
  }
  const input = await checkpointInputFromFile(inputPath);
  const matches = await matchingPublicDocChanges(Deno.cwd(), input);
  for (const path of matches) console.log(`DISCERN_MATCH ${path}`);
  return matches.length > 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${PUBLIC_DOC_CHECKPOINT_ID}: ${message}`);
    Deno.exit(2);
  }
}
