/**
 * The fleet change probe over one real fleet.
 *
 * The Desk adopts its last survey again whenever the fleet's fingerprint has
 * not moved, so the fingerprint must move whenever a survey would read
 * something different. Three observations share one project:
 *
 * - every path a status survey reads lies inside what the probe watches, so
 *   a new status input fails here until the probe watches it too;
 * - the probe costs one Git process per checkout plus two, and an unchanged
 *   fleet reads the same fingerprint twice;
 * - every discern administration entry the registry declares watched moves
 *   the fingerprint when written, every unwatched one does not, and so do
 *   commits, refs, working-tree edits and the ignored files status reads.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { basename, dirname, join, relative } from "@std/path";
import {
  FLEET_FINGERPRINT_GIT,
  fleetFingerprint,
  type FleetFingerprintGit,
  type FleetFingerprintLayout,
  fleetFingerprintLayout,
  type FleetFingerprintPath,
  fleetFingerprintPaths,
} from "../src/engine/status/fleet_fingerprint.ts";
import { statusResult } from "../src/engine/status/status.ts";
import { parseWorktreeList } from "../src/engine/worktree/git.ts";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  type GitAdminStateKey,
} from "../src/shared/git_admin_paths.ts";
import {
  createDeskTtyProject,
  deskCollision,
  deskFailedAction,
  deskFleetEntry,
  deskFleetFixture,
  deskLandingAuthority,
  deskOrphanBranch,
  deskProof,
  deskRunningAction,
  type DeskTtyProject,
} from "./fixtures/desk_tty_harness.ts";
import { git, gitOut } from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { withTempDir } from "./temp_dir.ts";

/** One task per kind of state a survey reads, a parked branch, and an overlap. */
const FLEET = deskFleetFixture([
  deskFleetEntry("proven-a1b2c3", {
    aheadCommits: 2,
    proof: deskProof(),
    landingAuthority: deskLandingAuthority("effort-grant"),
  }),
  deskFleetEntry("failed-b2c3d4", {
    aheadCommits: 1,
    action: deskFailedAction("done", {
      failedStage: "test",
      failures: [{
        producer: "test",
        name: "a failing case",
        message: "expected 1, received 2",
        partial: false,
      }],
    }),
  }),
  deskFleetEntry("running-c3d4e5", {
    aheadCommits: 1,
    action: deskRunningAction("done"),
  }),
  deskFleetEntry("editing-d4e5f6", {
    committedFiles: [{ path: "notes/one.md" }],
    dirtyFiles: [{ path: "notes/one.md", contents: "edited\n" }, {
      path: "notes/two.md",
    }],
  }),
  deskFleetEntry("setup-e5f6a7", { setup: "incomplete" }),
], {
  collisions: [
    deskCollision("shared/overlap.ts", ["proven-a1b2c3", "editing-d4e5f6"]),
  ],
  orphanBranches: [deskOrphanBranch("parked-f6a7b8", { parked: true })],
});

/** Git's files in a registration directory, as `git worktree list` reads them. */
const GIT_REGISTRATION_FILES: readonly string[] = [
  "HEAD",
  "commondir",
  "gitdir",
  "locked",
];

/** The Deno filesystem reads a survey can make, by name. */
const FILESYSTEM_READS = [
  "readTextFile",
  "readTextFileSync",
  "readFile",
  "readFileSync",
  "stat",
  "statSync",
  "lstat",
  "lstatSync",
  "readDir",
  "readDirSync",
  "open",
  "openSync",
  "realPath",
  "realPathSync",
  "readLink",
  "readLinkSync",
] as const;

/** Run `read` and return every filesystem path it touched. */
async function recordedReads(read: () => Promise<unknown>): Promise<string[]> {
  const host = Deno as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const paths = new Set<string>();
  for (const name of FILESYSTEM_READS) {
    const original = host[name];
    if (typeof original !== "function") continue;
    originals.set(name, original);
    host[name] = (...args: unknown[]): unknown => {
      const target = args[0];
      paths.add(target instanceof URL ? target.pathname : String(target));
      return Reflect.apply(original, Deno, args);
    };
  }
  try {
    await read();
  } finally {
    for (const [name, original] of originals) host[name] = original;
  }
  return [...paths].sort();
}

/**
 * One spelling for a path, missing or not: its deepest existing ancestor's
 * real path, then the rest. A survey and the probe may name the same file
 * through different links, such as macOS's `/var` and `/private/var`.
 */
async function canonical(path: string): Promise<string> {
  let existing = path;
  let rest = "";
  for (;;) {
    try {
      return join(await Deno.realPath(existing), rest);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      const parent = dirname(existing);
      if (parent === existing) return path;
      rest = join(basename(existing), rest);
      existing = parent;
    }
  }
}

/** The layout and its plan with every path in one spelling. */
async function canonicalLayout(layout: FleetFingerprintLayout): Promise<{
  readonly layout: FleetFingerprintLayout;
  readonly plan: readonly FleetFingerprintPath[];
}> {
  const all = (paths: readonly string[]): Promise<string[]> =>
    Promise.all(paths.map(canonical));
  return {
    layout: {
      ...layout,
      checkouts: await all(layout.checkouts),
      commonDir: await canonical(layout.commonDir),
      adminDirs: await all(layout.adminDirs),
      retiredPaths: await all(layout.retiredPaths),
    },
    plan: await Promise.all(
      fleetFingerprintPaths(layout).map(async (input) => ({
        ...input,
        path: await canonical(input.path),
      })),
    ),
  };
}

/** Whether `path` is `root` or lies beneath it. */
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** The administration entry, of either scope, that holds `path`. */
function adminEntry(
  path: string,
  layout: FleetFingerprintLayout,
): GitAdminStateKey | undefined {
  return GIT_ADMIN_STATE_KEYS.find((key) => {
    const entry = GIT_ADMIN_STATE[key];
    const owners = entry.scope === "common"
      ? [layout.commonDir]
      : layout.adminDirs;
    return owners.some((owner) => within(path, join(owner, entry.path)));
  });
}

/** Whether Git ignores `path` in `checkout`, where a status read cannot see it. */
async function ignored(checkout: string, path: string): Promise<boolean> {
  const run = await new Deno.Command("git", {
    args: ["check-ignore", "-q", "--", relative(checkout, path)],
    cwd: checkout,
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    stdout: "null",
    stderr: "null",
  }).output();
  return run.code === 0;
}

/**
 * Why the probe sees a change at `path`, or undefined when it does not. The
 * probe watches what its plan names, reads registrations, refs and HEADs
 * through Git, and each checkout's non-ignored files through `git status`.
 */
async function coverage(
  path: string,
  layout: FleetFingerprintLayout,
  plan: readonly FleetFingerprintPath[],
): Promise<string | undefined> {
  const planned = plan.find((input) =>
    input.depth === "self" ? input.path === path : within(path, input.path)
  );
  if (planned !== undefined) return `planned ${planned.depth}`;
  const key = adminEntry(path, layout);
  if (key !== undefined) {
    return GIT_ADMIN_STATE[key].changeProbe === "addressed"
      ? "addressed by a watched record"
      : undefined;
  }
  if (within(path, join(layout.commonDir, "objects"))) return "immutable";
  // Git's own registration records, which `git worktree list` reads.
  const registration = layout.adminDirs.find((admin) =>
    path === admin || dirname(path) === admin
  );
  if (
    path === join(layout.commonDir, "worktrees") ||
    (registration !== undefined &&
      (path === registration ||
        GIT_REGISTRATION_FILES.includes(basename(path))))
  ) {
    return "registration, read through git worktree list";
  }
  // The running engine's own templates and sources do not change under it.
  if (within(path, REPO_ROOT.replace(/\/$/, ""))) return "engine";
  const checkout = layout.checkouts.find((candidate) =>
    within(path, candidate)
  );
  if (checkout === undefined) return undefined;
  if (path === checkout) return "registration, read through git worktree list";
  if (within(path, join(checkout, ".git"))) return undefined;
  return await ignored(checkout, path) ? undefined : "read by git status";
}

/** The fleet's layout, as the probe derives it. */
async function layoutOf(root: string): Promise<FleetFingerprintLayout> {
  const listed = parseWorktreeList(
    await gitOut(root, "worktree", "list", "--porcelain"),
  ).map((record) => record.path);
  const layout = await fleetFingerprintLayout(root, listed);
  assert(layout !== undefined, "the fleet has a common directory");
  return layout;
}

/** A change to one fixture fact, and the fingerprint before and after it. */
async function moved(
  project: DeskTtyProject,
  change: () => Promise<void>,
): Promise<{ before: string; after: string }> {
  const before = await fleetFingerprint(project.root);
  assert(before !== undefined, "the fleet is fingerprinted");
  await change();
  const after = await fleetFingerprint(project.root);
  assert(after !== undefined, "the fleet is fingerprinted after the change");
  return { before, after };
}

/**
 * Write one administration entry the way its writers do: a file in place, an
 * existing record appended to in place, or a new record beside the others.
 */
async function touchAdminEntry(
  path: string,
  kind: "file" | "directory",
): Promise<void> {
  if (kind === "file") {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, "changed\n", { append: true });
    return;
  }
  await Deno.mkdir(path, { recursive: true });
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(path)) entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const file = entries.find((entry) => entry.isFile);
  if (file !== undefined) {
    await Deno.writeTextFile(join(path, file.name), "changed\n", {
      append: true,
    });
    return;
  }
  const store = entries.find((entry) => entry.isDirectory);
  await Deno.writeTextFile(
    join(path, store?.name ?? "", "fingerprint-probe.json"),
    "{}\n",
  );
}

Deno.test("the fleet fingerprint watches every survey input and moves with each change", async (t) => {
  await withTempDir(async (parent) => {
    const project = await createDeskTtyProject(parent, FLEET);
    const layout = await layoutOf(project.root);

    await t.step(
      "a survey reads nothing the probe does not watch",
      async () => {
        const reads = await recordedReads(() =>
          statusResult(project.root, { all: true })
        );
        const watched = await canonicalLayout(layout);
        const unwatched: string[] = [];
        for (const read of reads) {
          const path = await canonical(read);
          if (
            await coverage(path, watched.layout, watched.plan) === undefined
          ) {
            unwatched.push(read);
          }
        }
        assertEquals(
          unwatched,
          [],
          "status read these paths, which the fleet change probe does not " +
            "watch: declare the administration entry's changeProbe in " +
            "GIT_ADMIN_STATE, or add the input to fleetFingerprintPaths",
        );
      },
    );

    await t.step(
      "an unchanged fleet reads the same fingerprint for one Git process per checkout plus two",
      async () => {
        const calls: string[] = [];
        const counted: FleetFingerprintGit = (args, cwd) => {
          calls.push(args[0] ?? "");
          return FLEET_FINGERPRINT_GIT(args, cwd);
        };
        const first = await fleetFingerprint(project.root, counted);
        const perProbe = calls.length;
        const second = await fleetFingerprint(project.root, counted);
        assert(first !== undefined);
        assertEquals(second, first);
        assertEquals(perProbe, layout.checkouts.length + 2);
        assertEquals(
          [...new Set(calls)].sort(),
          ["for-each-ref", "status", "worktree"],
        );
      },
    );

    const linked = layout.adminDirs[1];
    assert(linked !== undefined, "the fleet has a linked worktree");
    for (const key of GIT_ADMIN_STATE_KEYS) {
      const entry = GIT_ADMIN_STATE[key];
      const watched = entry.changeProbe === "contents" ||
        entry.changeProbe === "entries";
      await t.step(
        `${key} (${entry.changeProbe}) ${
          watched ? "moves" : "leaves"
        } the fingerprint`,
        async () => {
          const owner = entry.scope === "common" ? layout.commonDir : linked;
          const { before, after } = await moved(
            project,
            () => touchAdminEntry(join(owner, entry.path), entry.kind),
          );
          if (watched) assertNotEquals(after, before);
          else assertEquals(after, before);
        },
      );
    }

    const [mainCheckout, task] = layout.checkouts;
    assert(mainCheckout !== undefined && task !== undefined);
    const repositoryChanges: readonly [string, () => Promise<void>][] = [
      ["a commit in a task", async () => {
        await Deno.writeTextFile(join(task, "probe-commit.txt"), "commit\n");
        await git(task, "add", "probe-commit.txt");
        await git(task, "commit", "-m", "Add a probe commit");
      }],
      ["a new branch", () => git(mainCheckout, "branch", "probe-branch")],
      [
        "a new untracked file",
        () => Deno.writeTextFile(join(task, "untracked.txt"), "new\n"),
      ],
      [
        "an edit to a file already changed",
        () => Deno.utime(join(task, "untracked.txt"), 1, 1),
      ],
      [
        "an env file appearing",
        () =>
          Deno.writeTextFile(join(task, layout.envFiles[0] ?? ".env"), "A=1\n"),
      ],
    ];
    for (const [change, apply] of repositoryChanges) {
      await t.step(`${change} moves the fingerprint`, async () => {
        const { before, after } = await moved(project, apply);
        assertNotEquals(after, before);
      });
    }
  }, { prefix: "discern-fleet-fingerprint-" });
});
