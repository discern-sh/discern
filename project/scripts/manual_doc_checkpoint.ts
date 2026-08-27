/**
 * Select changed product-manual pages for one purpose-specific comprehension
 * checkpoint. The engine has already applied the broad manual path selector;
 * this bounded read-only matcher validates that input again, admits paths and
 * kinds through the canonical manual registries, and reads deleted pages from
 * the governing Git tree. Any malformed or unavailable fact fires closed: an
 * exit-zero verdict without a declared path makes the engine serve the
 * checkpoint over its complete structural match.
 */

import type { CheckpointWhenInput } from "../../src/shared/checkpoints.ts";
import { lstatIfExists } from "../../src/shared/fs_presence.ts";
import { resolveContainedProjectReadPath } from "../../src/shared/project_path.ts";
import { type GitResult, runGit } from "../../src/shared/subprocess.ts";
import {
  parseFrontmatter,
  readFrontmatterBlock,
  validateFrontmatter,
} from "../../src/lib/frontmatter.ts";
import { MANUAL_PAGE_MAX_BYTES } from "../../src/lib/manual.ts";
import {
  isManualMarkdownPath,
  MANUAL_KIND_REGISTRY,
  type ManualKind,
  manualKindForCheckpoint,
  REPOSITORY_MANUAL_REL,
} from "../../src/shared/manual.ts";
import {
  checkpointExactUtf8,
  checkpointGitBytes,
  checkpointInvocationRoot,
  checkpointProjectRoot,
  checkpointWhenInputFromEnvironment,
  parseCheckpointWhenInput,
} from "./checkpoint_when_input.ts";

/** Maximum size of the engine-authored v1 input file. */
export const MANUAL_CHECKPOINT_INPUT_MAX_BYTES = 512 * 1024;

/** Maximum number of changed-file facts one invocation will inspect. */
export const MANUAL_CHECKPOINT_MAX_CHANGED_FILES = 2_048;

/** Maximum UTF-8 bytes read across every candidate page. */
export const MANUAL_CHECKPOINT_MAX_TOTAL_PAGE_BYTES = 4 * 1024 * 1024;

const GIT_TIMEOUT_MS = 2_000;

/** Registry seam used only to prove future-member enrollment. */
export interface ManualCheckpointModel {
  readonly rootRel: string;
  readonly isMarkdownPath: (relative: string) => boolean;
  readonly kindForCheckpoint: (checkpointId: string) => ManualKind | undefined;
}

/** The live corpus and kind model used by the matcher. */
export const CANONICAL_MANUAL_CHECKPOINT_MODEL: ManualCheckpointModel = {
  rootRel: REPOSITORY_MANUAL_REL,
  isMarkdownPath: isManualMarkdownPath,
  kindForCheckpoint: manualKindForCheckpoint,
};

/** Raise one boundary-validation failure with a stable message. */
function fail(message: string): never {
  throw new Error(message);
}

/** Parse and strictly validate one version-1 matcher input. */
export function parseManualCheckpointInput(
  text: string,
  checkpointId: string,
): CheckpointWhenInput {
  if (manualKindForCheckpoint(checkpointId) === undefined) {
    return fail(`${checkpointId} is not a registered manual checkpoint`);
  }
  return parseCheckpointWhenInput(text, {
    id: checkpointId,
    mode: "stop",
    maxInputBytes: MANUAL_CHECKPOINT_INPUT_MAX_BYTES,
    maxChangedFiles: MANUAL_CHECKPOINT_MAX_CHANGED_FILES,
  });
}

/** Convert an unsuccessful Git operation into a bounded validation failure. */
function requireGitSuccess(result: GitResult, label: string): void {
  if (result.success) return;
  const reason = result.timedOut === true
    ? "timed out"
    : result.outputLimitExceeded === true
    ? "exceeded its output limit"
    : `exited ${result.code}`;
  fail(`${label} ${reason}`);
}

interface BoundedText {
  readonly text: string;
  readonly bytes: number;
}

/** Read one present page through the shared contained-project boundary. */
async function currentPage(root: string, path: string): Promise<BoundedText> {
  const absolute = await resolveContainedProjectReadPath(root, path);
  if (absolute === undefined) {
    return fail(`${path} does not resolve inside the candidate worktree`);
  }
  const info = await lstatIfExists(absolute);
  if (info === undefined || !info.isFile || info.isSymlink) {
    return fail(`${path} is not a regular candidate-worktree file`);
  }
  if (info.size > MANUAL_PAGE_MAX_BYTES) {
    return fail(`${path} exceeds the manual-page read limit`);
  }
  const bytes = await Deno.readFile(absolute);
  if (bytes.byteLength > MANUAL_PAGE_MAX_BYTES) {
    return fail(`${path} exceeded the manual-page read limit while reading`);
  }
  return {
    text: checkpointExactUtf8(bytes, path),
    bytes: bytes.byteLength,
  };
}

/** Read one deleted page as a regular blob from the governing Git tree. */
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
  const records = checkpointExactUtf8(
    checkpointGitBytes(listed),
    `tree entry for ${path}`,
  )
    .split("\0").filter((entry) => entry !== "");
  const record = records.length === 1 ? records[0] : undefined;
  const tab = record?.indexOf("\t") ?? -1;
  const metadata = tab < 0 ? [] : record?.slice(0, tab).split(" ") ?? [];
  const treePath = tab < 0 ? undefined : record?.slice(tab + 1);
  const [mode, type, oid] = metadata;
  if (
    record === undefined || (mode !== "100644" && mode !== "100755") ||
    type !== "blob" || oid === undefined || treePath !== path
  ) {
    return fail(`${path} is not one regular blob in the governing tree`);
  }
  const shown = await runGit(["cat-file", "blob", oid], {
    cwd: root,
    bin: "git",
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: MANUAL_PAGE_MAX_BYTES + 4_096,
  });
  requireGitSuccess(shown, `governing page read for ${path}`);
  const bytes = checkpointGitBytes(shown);
  if (bytes.byteLength > MANUAL_PAGE_MAX_BYTES) {
    return fail(`${path} exceeds the manual-page read limit`);
  }
  return {
    text: checkpointExactUtf8(bytes, path),
    bytes: bytes.byteLength,
  };
}

/** Whether a project-relative path is admitted by the canonical manual model. */
export function isCanonicalManualPath(
  path: string,
  model: ManualCheckpointModel = CANONICAL_MANUAL_CHECKPOINT_MODEL,
): boolean {
  const prefix = `${model.rootRel.replace(/\/+$/u, "")}/`;
  return path.startsWith(prefix) &&
    model.isMarkdownPath(path.slice(prefix.length));
}

/**
 * Whether one admitted page is published and belongs to the served kind.
 * Missing, malformed, or incomplete metadata is an error so the process-level
 * handler fires closed rather than treating bad policy input as a non-match.
 */
export function matchesManualPage(
  path: string,
  markdown: string,
  checkpointId: string,
  model: ManualCheckpointModel = CANONICAL_MANUAL_CHECKPOINT_MODEL,
): boolean {
  if (!isCanonicalManualPath(path, model)) return false;
  const kind = model.kindForCheckpoint(checkpointId);
  if (kind === undefined) {
    return fail(`${checkpointId} has no registered manual kind`);
  }
  const frontmatterIssues = validateFrontmatter(markdown);
  if (
    frontmatterIssues.length > 0 || readFrontmatterBlock(markdown) === undefined
  ) {
    return fail(
      `${path} has invalid manual frontmatter: ${
        frontmatterIssues.join("; ") || "no complete block"
      }`,
    );
  }
  const { meta } = parseFrontmatter(markdown);
  if (
    meta.id === undefined || meta.publish === undefined ||
    meta.kind === undefined
  ) {
    return fail(`${path} must declare id, publish, and kind`);
  }
  return meta.publish && meta.kind === kind;
}

/** Resolve the exact changed paths one kind-specific question covers. */
export async function matchingManualChanges(
  cwd: string,
  input: CheckpointWhenInput,
  model: ManualCheckpointModel = CANONICAL_MANUAL_CHECKPOINT_MODEL,
): Promise<string[]> {
  const root = await checkpointProjectRoot(cwd);
  const matches: string[] = [];
  let totalPageBytes = 0;
  for (const file of input.changed_files) {
    if (!isCanonicalManualPath(file.path, model)) continue;
    if (file.binary) {
      return fail(`${file.path} is binary and cannot be judged as Markdown`);
    }
    const page = file.kind === "deleted"
      ? await deletedPage(root, input.policy_commit, file.path)
      : await currentPage(root, file.path);
    totalPageBytes += page.bytes;
    if (totalPageBytes > MANUAL_CHECKPOINT_MAX_TOTAL_PAGE_BYTES) {
      return fail("candidate pages exceed the total manual-page read limit");
    }
    if (matchesManualPage(file.path, page.text, input.checkpoint.id, model)) {
      matches.push(file.path);
    }
  }
  return matches;
}

/** Run the bounded matcher for the checkpoint id passed by its config entry. */
async function main(checkpointId: string): Promise<number> {
  if (
    !MANUAL_KIND_REGISTRY.some((entry) => entry.checkpointId === checkpointId)
  ) {
    return fail(`${checkpointId} is not a registered manual checkpoint`);
  }
  const input = await checkpointWhenInputFromEnvironment({
    id: checkpointId,
    mode: "stop",
    maxInputBytes: MANUAL_CHECKPOINT_INPUT_MAX_BYTES,
    maxChangedFiles: MANUAL_CHECKPOINT_MAX_CHANGED_FILES,
  });
  const matches = await matchingManualChanges(
    checkpointInvocationRoot(),
    input,
  );
  for (const path of matches) console.log(`DISCERN_MATCH ${path}`);
  return matches.length > 0 ? 0 : 1;
}

if (import.meta.main) {
  const checkpointId = Deno.args[0] ?? "";
  try {
    Deno.exit(await main(checkpointId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`manual checkpoint matcher: ${message}; firing closed`);
    Deno.exit(0);
  }
}
