/** Source observation reads checkout identity through the shared bounded reader. */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  captureGitSnapshot,
  decodeCheckoutIdentity,
} from "../src/engine/execution/snapshot.ts";
import { observeSourceSnapshot } from "../src/engine/execution/source_snapshot.ts";
import { SOURCE_OBSERVATION_FORMAT } from "../src/engine/execution/snapshot_schema.ts";
import { git, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";

const BOUNDS = {
  maxFiles: 100,
  maxBytes: 1024 * 1024,
  gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
};

const IDENTITY_QUERY = "rev-parse HEAD HEAD^{tree} --symbolic-full-name HEAD";

/** The git subcommand behind the runner's inline configuration pairs. */
function subcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-c") {
      index += 1;
      continue;
    }
    if (arg !== undefined && !arg.startsWith("-")) return arg;
  }
  return undefined;
}

/** One committed repository on an attached branch, without any tracked file. */
async function emptyRepository(root: string): Promise<void> {
  await git(root, "init", "-q", "-b", "main");
  await git(
    root,
    "-c",
    "user.name=Snapshot",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "empty",
  );
}

/** Observe each native git launch while the real commands keep running. */
async function withGitSpawns<T>(
  onSpawn: (args: readonly string[]) => void,
  operation: () => Promise<T>,
): Promise<T> {
  const Command = Deno.Command;
  Deno.Command = class extends Command {
    /** Record the argv of each git process at its actual launch boundary. */
    constructor(command: string | URL, options?: Deno.CommandOptions) {
      super(command, options);
      if (command === "git") onSpawn(options?.args ?? []);
    }
  };
  try {
    return await operation();
  } finally {
    Deno.Command = Command;
  }
}

Deno.test("source observation reads checkout identity in one bounded Git process per pass and keeps both passes", async () => {
  await withTempDir(async (root) => {
    await emptyRepository(root);
    const spawns: string[][] = [];
    const snapshot = await withGitSpawns(
      (args) => spawns.push([...args]),
      () => observeSourceSnapshot(root, BOUNDS),
    );
    assertEquals(
      spawns.length,
      8,
      "four native queries in each of two complete observations",
    );
    assertEquals(
      spawns.filter((args) => args.slice(-5).join(" ") === IDENTITY_QUERY)
        .length,
      2,
      "one identity query per observation pass",
    );
    assertEquals(
      spawns.filter((args) => subcommand(args) === "status").length,
      2,
    );
    assertEquals(snapshot.format, SOURCE_OBSERVATION_FORMAT);
    assertEquals(snapshot.head, await gitOut(root, "rev-parse", "HEAD"));
    assertEquals(snapshot.tree, await gitOut(root, "rev-parse", "HEAD^{tree}"));
    assertEquals(snapshot.branch, "refs/heads/main");
    assertEquals(snapshot.index_entries, "");
    await git(root, "switch", "--detach", "HEAD");
    assertEquals((await observeSourceSnapshot(root, BOUNDS)).branch, null);
    await assertRejects(
      () => observeSourceSnapshot(root, { ...BOUNDS, maxBytes: 40 }),
      Error,
      "output limit 40 bytes",
    );
    let cancelled = 0;
    await assertRejects(() =>
      withGitSpawns(
        () => cancelled++,
        () =>
          observeSourceSnapshot(root, {
            ...BOUNDS,
            signal: AbortSignal.abort(),
          }),
      )
    );
    assertEquals(cancelled, 0, "a cancelled observation launches no git");
    let statuses = 0;
    await assertRejects(
      () =>
        withGitSpawns((args) => {
          // The second pass sees a new untracked file the first pass never saw.
          if (subcommand(args) === "status" && ++statuses === 2) {
            Deno.writeTextFileSync(join(root, "late"), "changed\n");
          }
        }, () => observeSourceSnapshot(root, BOUNDS)),
      Error,
      "changed during observation",
    );
    assertEquals(statuses, 2, "the second pass still ran its own status query");
  });
});

Deno.test("an unborn HEAD keeps the existing rejection for both observation forms", async () => {
  await withTempDir(async (root) => {
    await git(root, "init", "-q", "-b", "main");
    for (
      const observe of [
        () => observeSourceSnapshot(root, BOUNDS),
        () => captureGitSnapshot(root, BOUNDS),
      ]
    ) {
      const error = await assertRejects(observe, Error, "Git rev-parse failed");
      assertStringIncludes(error.message, "exit 128");
    }
  });
});

Deno.test("checkout identity decoding keeps attachment semantics and rejects incomplete or oversized fields", () => {
  const head = "a".repeat(40);
  const tree = "b".repeat(40);
  assertEquals(
    decodeCheckoutIdentity(`${head}\n${tree}\nrefs/heads/main\n`, BOUNDS),
    { head, tree, branch: "refs/heads/main" },
  );
  assertEquals(decodeCheckoutIdentity(`${head}\n${tree}\nHEAD\n`, BOUNDS), {
    head,
    tree,
    branch: null,
  });
  for (
    const incomplete of [
      "",
      `${head}\n`,
      `${head}\n${tree}\n`,
      `${head}\n${tree}\nHEAD`,
      `${head}\n${tree}\nHEAD\nextra\n`,
    ]
  ) {
    assertThrows(
      () => decodeCheckoutIdentity(incomplete, BOUNDS),
      Error,
      "incomplete checkout identity",
    );
  }
  assertThrows(
    () =>
      decodeCheckoutIdentity(`${head}\n${tree}\nHEAD\n`, {
        ...BOUNDS,
        maxBytes: 40,
      }),
    Error,
    "output limit 40 bytes",
  );
});
