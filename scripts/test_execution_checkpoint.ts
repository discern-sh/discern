/** Bounded, read-only checkpoint host for expensive test execution growth. */
import {
  CHECKPOINT_WHEN_FIRE_EXIT_CODE,
  CHECKPOINT_WHEN_MATCH_LINE_PREFIX,
  CHECKPOINT_WHEN_PASS_EXIT_CODE,
  type CheckpointWhenInput,
} from "../src/shared/checkpoints.ts";
import { resolveContainedProjectReadPath } from "../src/shared/project_path.ts";
import {
  checkpointExactUtf8,
  checkpointGitBytes,
  checkpointInvocationRoot,
  checkpointProjectRoot,
  checkpointWhenInputFromEnvironment,
  runCheckpointGit,
} from "./checkpoint_when_input.ts";
import {
  type TestExecutionFinding,
  testExecutionGrowth,
  type TestExecutionSource,
} from "./test_execution_analysis.ts";

export const TEST_EXECUTION_CHECKPOINT_ID = "test-execution-cost";
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 2_048;

/** Executable test modules and helpers; inert fixtures are not review subjects. */
function isExecutionSource(path: string): boolean {
  return path.startsWith("tests/") && path.endsWith(".ts") &&
    !path.startsWith("tests/fixtures/");
}

/** Read bounded Git bytes through the shared isolated capability. */
async function gitBytes(
  root: string,
  args: string[],
  stdin?: string,
): Promise<Uint8Array> {
  const result = await runCheckpointGit(args, {
    cwd: root,
    timeoutMs: 2_000,
    maxOutputBytes: MAX_BYTES,
    ...(stdin === undefined ? {} : { stdin }),
  });
  if (
    !result.success || result.outputLimitExceeded === true ||
    result.timedOut === true
  ) {
    throw new Error(
      `test execution checkpoint could not read Git ${args[0]}: ${
        result.stderr.slice(0, 240)
      }`,
    );
  }
  return checkpointGitBytes(result);
}

/** Read a Git snapshot with one tree query and one batched blob query. */
export async function committedExecutionSources(
  root: string,
  commit: string,
): Promise<TestExecutionSource[]> {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("expected a resolved commit id");
  }
  const listing = checkpointExactUtf8(
    await gitBytes(root, ["ls-tree", "-r", "-z", commit, "--", "tests"]),
    "test tree",
  );
  const entries = listing.split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
    if (match === null) throw new Error("unexpected test tree entry");
    return { mode: match[1], oid: match[2] ?? "", path: match[3] ?? "" };
  }).filter((entry) => isExecutionSource(entry.path));
  if (entries.length > MAX_FILES) {
    throw new Error("test source population exceeds read bound");
  }
  if (
    entries.some((entry) => !["100644", "100755"].includes(entry.mode ?? ""))
  ) {
    throw new Error("test source must be a regular Git blob");
  }
  if (entries.length === 0) return [];
  const bytes = await gitBytes(
    root,
    ["cat-file", "--batch"],
    entries.map((entry) => entry.oid).join("\n") + "\n",
  );
  let offset = 0;
  return entries.map(({ oid, path }) => {
    const end = bytes.indexOf(10, offset);
    const header = checkpointExactUtf8(
      bytes.subarray(offset, end),
      "blob header",
    );
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
    const size = Number(match?.[2]);
    if (
      end < offset || match?.[1] !== oid || !Number.isSafeInteger(size) ||
      size < 0 ||
      end + size + 1 >= bytes.length || bytes[end + size + 1] !== 10
    ) {
      throw new Error(`invalid batched blob for ${path}`);
    }
    offset = end + size + 2;
    return {
      path,
      text: checkpointExactUtf8(bytes.subarray(end + 1, end + size + 1), path),
    };
  });
}

/** Read candidate dependencies without following paths out of the checkout. */
async function currentExecutionSources(
  root: string,
  paths: readonly string[],
): Promise<TestExecutionSource[]> {
  if (paths.length > MAX_FILES) {
    throw new Error("test source population exceeds read bound");
  }
  const sources: TestExecutionSource[] = [];
  let total = 0;
  for (const path of paths) {
    const absolute = await resolveContainedProjectReadPath(root, path);
    if (absolute === undefined) throw new Error(`${path} leaves the checkout`);
    const info = await Deno.lstat(absolute);
    if (!info.isFile || info.isSymlink) {
      throw new Error(`${path} is not a regular test source`);
    }
    total += info.size;
    if (total > MAX_BYTES) throw new Error("test sources exceed read bound");
    const bytes = await Deno.readFile(absolute);
    total += bytes.byteLength - info.size;
    if (total > MAX_BYTES) {
      throw new Error("test sources grew beyond read bound");
    }
    sources.push({ path, text: checkpointExactUtf8(bytes, path) });
  }
  return sources;
}

/** Compare the governing tree with current bytes; dependencies inform only matched subjects. */
export async function matchingExecutionChanges(
  root: string,
  input: CheckpointWhenInput,
): Promise<TestExecutionFinding[]> {
  const paths = new Set(
    input.changed_files.filter((file) => isExecutionSource(file.path)).map((
      file,
    ) => file.path),
  );
  if (paths.size === 0) return [];
  const before = await committedExecutionSources(root, input.policy_commit);
  const deleted = new Set(
    input.changed_files.filter((file) => file.kind === "deleted").map((file) =>
      file.path
    ),
  );
  const after = await currentExecutionSources(
    root,
    [...new Set([...before.map((source) => source.path), ...paths])].filter((
      path,
    ) => !deleted.has(path)),
  );
  return testExecutionGrowth(before, after, paths);
}

/** Serve only changed subjects whose syntax calls for a cost judgment. */
async function main(): Promise<number> {
  const input = await checkpointWhenInputFromEnvironment({
    id: TEST_EXECUTION_CHECKPOINT_ID,
    mode: "stop",
  });
  const root = await checkpointProjectRoot(checkpointInvocationRoot());
  const findings = await matchingExecutionChanges(root, input);
  for (const finding of findings) {
    console.log(`${CHECKPOINT_WHEN_MATCH_LINE_PREFIX} ${finding.path}`);
    console.error(`${finding.path}: ${finding.reason}`);
  }
  return findings.length > 0
    ? CHECKPOINT_WHEN_FIRE_EXIT_CODE
    : CHECKPOINT_WHEN_PASS_EXIT_CODE;
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      `${TEST_EXECUTION_CHECKPOINT_ID}: ${
        error instanceof Error ? error.message : String(error)
      }; review required`,
    );
    Deno.exit(1);
  }
}
