/**
 * The ARCHITECTURAL guard for the plan/apply class (ADR 0027): every command
 * whose canonical operation-effect policy requires a preview, held to the
 * preview contract AS A CLASS.
 *
 * The class is enumerated from `OPERATION_EFFECTS.preview`, never inferred from
 * the flag it must enforce and never copied into this test. The bidirectional
 * operation-effect guard holds that policy equal to the `--dry-run` options in
 * the built Cliffy command tree. A future writer therefore enrols before it
 * has a flag, and the fixture table below fails closed until it has a probe.
 *
 * Two invariants, per member:
 *
 *  1. **A dry run writes nothing.** The fixture tree (main checkout, sibling
 *     worktrees, `.git` included) is snapshotted before and after the dry run
 *     and must be byte-identical. Two principled exceptions, both scoped inside
 *     `.git`: the logbook (which records every verb run, dry or not) may only
 *     APPEND, and git's `index` files (whose stat-cache is legitimately
 *     refreshed by read-only git commands) are not compared. Everything else
 *     under `.git` — refs, HEAD, proofs, standard measurements, resource
 *     state — must not move.
 *
 *  2. **Applied ⊆ planned** (by `kind:label`), the safety direction: apply may
 *     never act outside the preview. This is the invariant whose violation was
 *     the catastrophic bug — `worktree prune --dry-run` reported "nothing to
 *     do" while the real run removed worktrees and branches. It is
 *     disposition-agnostic (a planned step marked `skip` is still in the plan)
 *     and catches the original bug head-on: an under-populated plan with
 *     non-empty applied effects fails the subset. Members whose preview rides
 *     in `data` instead of an engine plan (the installer's fs-plan verbs and
 *     `patterns reset`) are recorded as `envelope: "data-preview"` — an
 *     explicit, self-checking exception: the guard asserts they still carry NO
 *     `plan`, so a member migrated onto the engine envelope must move to the
 *     `engine-plan` side or fail.
 *
 * Every member's dry run must also carry the uniform `dry_run: true` marker —
 * the one "is this a preview?" signal every surface shares (ADR 0028).
 *
 * Member-specific depth (rendering, hints, refusals, exact previewed content)
 * stays in each verb's own suite; this file holds only the class contract.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { Command } from "@cliffy/command";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import {
  type CliResultEnvelope,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import {
  addWorktree,
  git,
  gitInit,
  mapPool,
  proveSetupBranchForAcceptance,
  runAgent,
  scaffoldEngine,
  worktreePath,
  writeConfig,
} from "./engine_helpers.ts";
import { dryRunCapablePaths } from "../src/main.ts";
import { previewRequiredOperationPaths } from "../src/shared/operation_effects.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { resultContractForVerb } from "../src/shared/result_contracts.ts";
import { renderResultMarkdown } from "../src/shared/result_markdown.ts";

const DRY_RUN_LEAD = "**Dry run: nothing changed.**";

/** Decode a lifecycle envelope before reducing its planned or applied steps. */
function parse(stdout: string, command: string): CliResultEnvelope {
  return decodeCliResult(stdout, command);
}

/** Every step listed in a `--dry-run --json` plan, as a `kind:label` set. */
function plannedSet(dryStdout: string, command: string): Set<string> {
  const obj = parse(dryStdout, command);
  const steps = obj.plan?.steps ?? [];
  return new Set(steps.map((s) => `${s.kind}:${s.label}`));
}

/** Every step the apply `--json` actually executed (outcome ≠ skipped), as `kind:label`. */
function appliedSet(applyStdout: string, command: string): Set<string> {
  const obj = parse(applyStdout, command);
  const steps = obj.steps ?? [];
  return new Set(
    steps.filter((s) => s.outcome !== "skipped").map((s) =>
      `${s.kind}:${s.label}`
    ),
  );
}

/** Assert one applied effect set is bounded by its preview. */
function assertAppliedStepSubset(
  planned: ReadonlySet<string>,
  applied: ReadonlySet<string>,
  label: string,
): void {
  const escaped = [...applied].filter((s) => !planned.has(s));
  assertEquals(
    escaped,
    [],
    `${label}: apply executed steps the dry-run plan never listed (preview lied by omission): ` +
      `${JSON.stringify(escaped)}\nplanned=${
        JSON.stringify([...planned])
      }\napplied=${JSON.stringify([...applied])}`,
  );
}

/** Assert the apply executed nothing the dry-run plan did not list. */
function assertAppliedSubsetOfPlanned(
  dryStdout: string,
  applyStdout: string,
  command: string,
): void {
  assertAppliedStepSubset(
    plannedSet(dryStdout, command),
    appliedSet(applyStdout, command),
    command,
  );
}

// ── the fixture snapshot ────────────────────────────────────────────────────

/** git index files: `.git/index` and `.git/worktrees/<n>/index` — read-only
 * git commands legitimately rewrite their stat-cache bytes. */
function isGitIndex(rel: string): boolean {
  return /\.git\/(?:worktrees\/[^/]+\/)?index$/.test(rel);
}

/** The logbook subtree under `.git` — records every verb run, dry or not. */
function isLogbookFile(rel: string): boolean {
  return rel.includes(".git/discern/logbook/");
}

/** The logbook's container directories — the run that seeds a fresh logbook
 * creates these; nothing else about them is exempt (their sibling admin state
 * stays strictly compared). */
function isLogbookContainer(rel: string): boolean {
  return rel.endsWith(".git/discern/") || rel.endsWith(".git/discern/logbook/");
}

interface TreeSnapshot {
  /** rel path → content hash / symlink target / "dir" — compared exactly. */
  exact: Map<string, string>;
  /** logbook rel path → full text — compared append-only. */
  logbook: Map<string, string>;
}

type BeforeSnapshotEntryRead = (
  absolutePath: string,
  relativePath: string,
) => Promise<void>;

const SNAPSHOT_ATTEMPTS = 3;

/** Render a file's SHA-256 digest for byte-exact tree snapshots. */
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Snapshot directories, links, ordinary files, and append-only logbook state under distinct rules. */
async function walkInto(
  snapshot: TreeSnapshot,
  absRoot: string,
  relPrefix: string,
  beforeEntryRead?: BeforeSnapshotEntryRead,
): Promise<void> {
  for await (const entry of Deno.readDir(absRoot)) {
    const abs = join(absRoot, entry.name);
    const rel = `${relPrefix}${entry.name}`;
    await beforeEntryRead?.(abs, rel);
    if (entry.isDirectory) {
      if (!isLogbookContainer(`${rel}/`)) {
        snapshot.exact.set(`${rel}/`, "dir");
      }
      await walkInto(snapshot, abs, `${rel}/`, beforeEntryRead);
    } else if (entry.isSymlink) {
      snapshot.exact.set(rel, `link:${await Deno.readLink(abs)}`);
    } else if (isGitIndex(rel)) {
      continue;
    } else if (isLogbookFile(rel)) {
      snapshot.logbook.set(rel, await Deno.readTextFile(abs));
    } else {
      snapshot.exact.set(rel, await hashBytes(await Deno.readFile(abs)));
    }
  }
}

/** Snapshot the whole fixture: the main checkout AND its sibling worktree
 * root (`<dir>.worktrees`), so a dry run that touches a linked worktree — or
 * mints one — cannot escape the comparison. */
async function snapshotTree(
  mainDir: string,
  beforeEntryRead?: BeforeSnapshotEntryRead,
): Promise<TreeSnapshot> {
  const worktreeRoot = dirname(worktreePath(mainDir, "any"));
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt++) {
    const snapshot: TreeSnapshot = { exact: new Map(), logbook: new Map() };
    try {
      await walkInto(snapshot, mainDir, "main/", beforeEntryRead);

      let worktreeRootExists = true;
      try {
        await Deno.lstat(worktreeRoot);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
        worktreeRootExists = false;
      }
      if (worktreeRootExists) {
        await walkInto(
          snapshot,
          worktreeRoot,
          "worktrees/",
          beforeEntryRead,
        );
      }
      return snapshot;
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotFound) ||
        attempt === SNAPSHOT_ATTEMPTS
      ) {
        throw error;
      }
      // A background Git maintenance process can retire an administrative
      // file after readDir yields it. Discard the partial observation: keeping
      // it would turn one filesystem moment into a synthetic tree that never
      // existed, while ignoring the path would hide a stable leftover.
      continue;
    }
  }

  throw new Error("snapshot attempts exhausted without returning or throwing");
}

Deno.test("fixture snapshots survive a fresh-named entry vanishing after enumeration", async () => {
  await withTempDir(async (dir) => {
    const transientDir = join(dir, "unrelated-state");
    const transientPath = join(transientDir, "future-sibling.pending");
    await Deno.mkdir(transientDir);
    await Deno.writeTextFile(transientPath, "transient\n");
    let removed = false;

    const snapshot = await snapshotTree(
      dir,
      async (absolutePath, relativePath) => {
        if (
          !removed &&
          relativePath === "main/unrelated-state/future-sibling.pending"
        ) {
          removed = true;
          await Deno.remove(absolutePath);
        }
      },
    );

    assert(removed, "the adversarial entry was never observed");
    assertEquals(
      snapshot.exact.has("main/unrelated-state/future-sibling.pending"),
      false,
    );
  });
});

/** Assert `after` equals `before` up to the two principled exceptions. */
function assertTreeUnchanged(
  before: TreeSnapshot,
  after: TreeSnapshot,
  verb: string,
): void {
  const drift: string[] = [];
  for (const [rel, value] of before.exact) {
    const now = after.exact.get(rel);
    if (now === undefined) {
      drift.push(`removed: ${rel}`);
    } else if (now !== value) {
      drift.push(`changed: ${rel}`);
    }
  }
  for (const rel of after.exact.keys()) {
    if (!before.exact.has(rel)) {
      drift.push(`created: ${rel}`);
    }
  }
  for (const [rel, text] of before.logbook) {
    const now = after.logbook.get(rel);
    if (now === undefined) {
      drift.push(`removed: ${rel} (the logbook is append-only)`);
    } else if (!now.startsWith(text)) {
      drift.push(`rewritten: ${rel} (the logbook is append-only)`);
    }
  }
  assertEquals(
    drift,
    [],
    `${verb}: a dry run must write nothing, but the tree moved:\n  ${
      drift.join("\n  ")
    }`,
  );
}

// ── the member fixture table ────────────────────────────────────────────────

/** One arranged fixture: where to run, and the exact argv for each phase. */
interface Arranged {
  cwd: string;
  /** The dry-run invocation — must include `--dry-run --json`. */
  dry: string[];
  /** The apply invocation on the SAME fixture (engine-plan members only). */
  apply?: string[];
  env?: Record<string, string>;
}

interface DryRunProbe {
  /**
   * "engine-plan": the dry run emits `plan.steps` and the apply emits `steps`
   * — subset-checked. "data-preview": the preview rides in the verb-specific
   * `data` payload; the guard asserts the envelope stays plan-less, so this
   * exception cannot silently absorb a member that grows an engine plan.
   */
  envelope: "engine-plan" | "data-preview";
  arrange: (dir: string) => Promise<Arranged>;
  /** Member-specific proof that the fixture exercises its promised effect set. */
  assertPreview?: (envelope: CliResultEnvelope) => void;
}

const FIXTURE_PRESETS = fromFileUrl(
  new URL("./fixtures/presets", import.meta.url),
);

/** Scaffold a main repository and return one newly linked fixture checkout. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** A fresh, discern-less repo — the state the setup family starts from. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
  await gitInit(dir);
}

/** A scaffolded install with one on-demand standard carrying pinnable slack. */
const CONFIG_WITH_STANDARD = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[standards.filecount]",
  "run = \"sh -c 'echo DISCERN_METRIC filecount 5'\"",
  "limit = 10",
  'direction = "down"',
  'measure = "on-demand"',
  "",
].join("\n");

/** One falling ceiling whose worktree adds a responsible breached input. */
const CONFIG_WITH_BREACHED_STANDARD = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[standards.filecount]",
  `run = "count=$(git ls-files 'src/**' | wc -l); echo DISCERN_METRIC filecount $count"`,
  "limit = 1",
  'direction = "down"',
  'inputs = ["src/**"]',
  "",
].join("\n");

/**
 * One probe per preview-required operation policy, keyed by command path. The
 * class test fails closed: an enumerated member with no probe, or a probe whose
 * member vanished, is a gate failure — never a silent skip.
 */
const PROBES: Record<string, DryRunProbe> = {
  // ── engine-plan members: dry `plan.steps` ↔ apply `steps` ──
  "refresh": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
      const initial = await runAgent(dir, ["refresh", "--json"]);
      assertEquals(initial.code, 0, initial.output);
      await gitInit(dir);

      const configPath = join(dir, "discern.toml");
      const config = await Deno.readTextFile(configPath);
      await Deno.writeTextFile(
        configPath,
        config.replace('proof_notes = "local"', 'proof_notes = "fetch"'),
      );
      await git(
        dir,
        "remote",
        "add",
        "origin",
        "https://example.invalid/discern-preview.git",
      );

      await Deno.writeTextFile(
        join(dir, "AGENTS.md"),
        `${await Deno.readTextFile(join(dir, "AGENTS.md"))}\ntracked drift\n`,
      );
      const mcpPath = join(dir, ".mcp.json");
      await Deno.writeTextFile(
        mcpPath,
        (await Deno.readTextFile(mcpPath)).replace(
          '"command": "discern"',
          '"command": "wrong-discern"',
        ),
      );

      const skillsDir = join(dir, ".claude/skills");
      const skillPath = join(skillsDir, "discern-write-adr/SKILL.md");
      await Deno.writeTextFile(
        skillPath,
        `${await Deno.readTextFile(skillPath)}\nmaterialized drift\n`,
      );
      const staleName = "retired-preview-skill";
      await Deno.mkdir(join(skillsDir, staleName), { recursive: true });
      await Deno.writeTextFile(
        join(skillsDir, staleName, "SKILL.md"),
        "stale\n",
      );
      const manifestPath = join(skillsDir, ".discern-materialized.json");
      const manifest = decodeWith(
        z.array(z.string()),
        await Deno.readTextFile(manifestPath),
      );
      manifest.push(staleName);
      await Deno.writeTextFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      return {
        cwd: dir,
        dry: ["refresh", "--dry-run", "--json"],
        apply: ["refresh", "--json"],
      };
    },
    assertPreview: (envelope) => {
      const steps = envelope.plan?.steps ?? [];
      const byLabel = new Map(steps.map((step) => [step.label, step]));
      for (
        const label of [
          "AGENTS.md",
          ".mcp.json",
          ".claude/skills/discern-write-adr",
          ".claude/skills/retired-preview-skill",
          "git config remote.origin.fetch",
        ]
      ) {
        assert(byLabel.has(label), `refresh fixture did not plan ${label}`);
      }
      assertStringIncludes(
        byLabel.get(".claude/skills/discern-write-adr")?.note ?? "",
        "update skill tree",
      );
      assertStringIncludes(
        byLabel.get(".claude/skills/retired-preview-skill")?.note ?? "",
        "remove skill",
      );
    },
  },
  "skills eject": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      return {
        cwd: dir,
        dry: [
          "skills",
          "eject",
          "discern-write-adr",
          "--dry-run",
          "--json",
        ],
        apply: [
          "skills",
          "eject",
          "discern-write-adr",
          "--json",
        ],
      };
    },
  },
  "done": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      // The untouched scaffold: its agent files were compiled from this exact
      // config, so the gate's instructions/skills checks hold and the apply is a
      // full green run.
      await scaffoldEngine(dir);
      await gitInit(dir);
      return {
        cwd: dir,
        dry: ["done", "--dry-run", "--json"],
        apply: ["done", "--json"],
      };
    },
  },
  "standards": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, CONFIG_WITH_STANDARD);
      await gitInit(dir); // --pin requires a clean tree
      return {
        cwd: dir,
        dry: ["standards", "--pin", "--dry-run", "--json"],
        apply: ["standards", "--pin", "--json"],
      };
    },
  },
  "standards propose": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, CONFIG_WITH_BREACHED_STANDARD);
      await Deno.mkdir(join(dir, "src"), { recursive: true });
      await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
      await gitInit(dir);
      const worktree = await addWorktree(dir, "proposal-preview");
      await Deno.writeTextFile(
        join(worktree, "src", "feature.ts"),
        "feature\n",
      );
      await git(worktree, "add", "src/feature.ts");
      await git(worktree, "commit", "-m", "Add feature source");
      const reason = "The feature requires one additional source file.";
      return {
        cwd: worktree,
        dry: [
          "standards",
          "propose",
          "filecount",
          "--reason",
          reason,
          "--dry-run",
          "--json",
        ],
        apply: [
          "standards",
          "propose",
          "filecount",
          "--reason",
          reason,
          "--json",
        ],
      };
    },
  },
  "tidy": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      const mapDir = join(dir, SOURCE_PATHS.map.defaultPath);
      await Deno.mkdir(mapDir, { recursive: true });
      await Deno.writeTextFile(
        join(mapDir, "README.md"),
        "# Map\n\n-   item\n",
      );
      return {
        cwd: dir,
        dry: ["tidy", "md", "--dry-run", "--json"],
        apply: ["tidy", "md", "--json"],
      };
    },
  },
  "start": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      // start runs from the MAIN checkout and mints a fresh worktree.
      await scaffoldEngine(dir);
      await gitInit(dir);
      return {
        cwd: dir,
        dry: ["start", "--dry-run", "--json"],
        apply: ["start", "--json"],
      };
    },
  },
  "accept": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      const wt = await mainWithWorktree(dir, "paritygrad");
      await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
      await git(wt, "add", "-A");
      await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
      return {
        cwd: wt,
        dry: ["accept", "--dry-run", "--json"],
        apply: ["accept", "--confirmed", "--json"],
      };
    },
  },
  "update": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      const wt = await mainWithWorktree(dir, "parityupdate");
      // Advance main after the branch forked → the worktree is behind, so
      // update has real work (a fast-forward/merge) and a non-empty applied set.
      await Deno.writeTextFile(join(dir, "up.txt"), "up\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");
      return {
        cwd: wt,
        dry: ["update", "--dry-run", "--json"],
        apply: ["update", "--json"],
      };
    },
  },
  "worktree setup": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      const wt = await mainWithWorktree(dir, "paritysetup");
      return {
        cwd: wt,
        dry: ["worktree", "setup", "--dry-run", "--json"],
        apply: ["worktree", "setup", "--json"],
      };
    },
  },
  "worktree rename": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      const wt = await mainWithWorktree(dir, "parityrename");
      return {
        cwd: wt,
        dry: [
          "worktree",
          "rename",
          "Renamed task",
          "--dry-run",
          "--json",
        ],
        apply: ["worktree", "rename", "Renamed task", "--json"],
      };
    },
  },
  "worktree teardown": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      const wt = await mainWithWorktree(dir, "parityteardown");
      const markers = join(dir, "markers");
      const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
      await Deno.writeTextFile(
        join(wt, "discern.toml"),
        `${cfg}\n[worktree.resources.thing]\n` +
          `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
          `destroy = "rm -f ${markers}/@resource@.live"\n`,
      );
      assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);
      return {
        cwd: wt,
        dry: ["worktree", "teardown", "--dry-run", "--json"],
        apply: ["worktree", "teardown", "--json"],
      };
    },
  },
  "worktree drop": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      await mainWithWorktree(dir, "paritydrop");
      return {
        cwd: dir,
        dry: ["worktree", "drop", "paritydrop", "--dry-run", "--json"],
        apply: ["worktree", "drop", "paritydrop", "--json"],
      };
    },
  },
  "worktree prune": {
    envelope: "engine-plan",
    arrange: async (dir) => {
      // A live, clean, fully-merged worktree → a real removal candidate.
      const wt = await mainWithWorktree(dir, "parityvictim");
      const setup = await runAgent(wt, ["worktree", "setup", "--json"]);
      assertEquals(setup.code, 0, setup.output);
      await Deno.writeTextFile(join(wt, "m.txt"), "m\n");
      await git(wt, "add", "-A");
      await git(wt, "commit", "-q", "-m", "m", "--no-gpg-sign");
      await git(dir, "merge", "--no-ff", "-m", "merge", "agent/parityvictim");
      // Settle the branch-scoped logbook epoch on the main checkout before the
      // dry-run snapshot; the ownership setup above runs from the linked branch.
      const status = await runAgent(dir, ["status", "--json"]);
      assertEquals(status.code, 0, status.output);
      return {
        cwd: dir,
        dry: ["worktree", "prune", "--dry-run", "--json"],
        apply: ["worktree", "prune", "--yes", "--json"],
      };
    },
  },

  // ── data-preview members: the fs-plan / payload previews ──
  "patterns reset": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      // Seed the logbook so the reset preview has real files to enumerate.
      assertEquals((await runAgent(dir, ["status", "--json"])).code, 0);
      return { cwd: dir, dry: ["patterns", "reset", "--dry-run", "--json"] };
    },
  },
  "patterns archive": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      // Seed active history so the archive preview carries a real source plan.
      assertEquals((await runAgent(dir, ["status", "--json"])).code, 0);
      return {
        cwd: dir,
        dry: ["patterns", "archive", "--dry-run", "--json"],
      };
    },
  },
  "setup": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await freshRepo(dir);
      return { cwd: dir, dry: ["setup", "--dry-run", "--json"] };
    },
  },
  "setup begin": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await freshRepo(dir);
      return { cwd: dir, dry: ["setup", "begin", "--dry-run", "--json"] };
    },
  },
  "setup accept": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await freshRepo(dir);
      const begin = await runAgent(dir, ["setup", "begin", "--confirmed"]);
      assertEquals(begin.code, 0, begin.output);
      await proveSetupBranchForAcceptance(dir);
      return { cwd: dir, dry: ["setup", "accept", "--dry-run", "--json"] };
    },
  },
  "upgrade": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir); // upgrade requires a clean tree
      return { cwd: dir, dry: ["upgrade", "--dry-run", "--json"] };
    },
  },
  "uninstall": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      return { cwd: dir, dry: ["uninstall", "--dry-run", "--json"] };
    },
  },
  "preset": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      return {
        cwd: dir,
        dry: ["preset", "example", "--yes", "--dry-run", "--json"],
        env: { DISCERN_PRESETS_DIR: FIXTURE_PRESETS },
      };
    },
  },
  "config set-job": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      return {
        cwd: dir,
        dry: ["config", "set-job", "lint", "deno lint", "--dry-run", "--json"],
      };
    },
  },
  "config set-scope": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      return {
        cwd: dir,
        dry: [
          "config",
          "set-scope",
          "docs",
          "docs/**",
          "--dry-run",
          "--json",
        ],
      };
    },
  },
  "config set-standard": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      return {
        cwd: dir,
        dry: [
          "config",
          "set-standard",
          "cov",
          "--limit",
          "1",
          "--direction",
          "up",
          "--run",
          "echo DISCERN_METRIC cov 1",
          "--dry-run",
          "--json",
        ],
      };
    },
  },
  "config set": {
    envelope: "data-preview",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      return {
        cwd: dir,
        dry: [
          "config",
          "set",
          "project.name",
          "Renamed",
          "--dry-run",
          "--json",
        ],
      };
    },
  },
};

// ── the class contract ──────────────────────────────────────────────────────

Deno.test("preview-required class: every member previews faithfully (writes nothing; apply ⊆ plan)", async (t) => {
  const verbs = previewRequiredOperationPaths();
  // Fail closed, both directions: a new preview-required policy must wire a
  // probe here before it can ship, and a probe whose member vanished must go.
  assertEquals(
    Object.keys(PROBES).sort(),
    [...verbs],
    "the dry-run fixture table has drifted from preview-required operation " +
      "policy — add a probe for the new member (or delete the stale one)",
  );

  // Every probe drives its own scaffold, so the members fan out as
  // concurrent steps. Concurrent sibling steps need their per-step sanitizers
  // off (Deno refuses to start a step while a sanitized sibling runs); the
  // parent test's sanitizers still hold the whole sweep.
  await mapPool(verbs, 8, async (verb) => {
    const probe = PROBES[verb];
    if (probe === undefined) {
      return; // unreachable: the assertEquals above already failed
    }
    await t.step({
      name: verb,
      sanitizeOps: false,
      sanitizeResources: false,
      sanitizeExit: false,
      fn: async () => {
        await withTempDir(async (dir) => {
          const run = await probe.arrange(dir);

          // 1. A dry run writes nothing (logbook appends aside).
          const before = await snapshotTree(dir);
          const dry = await runAgent(run.cwd, run.dry, { env: run.env ?? {} });
          assertEquals(dry.code, 0, `${verb}: dry-run failed\n${dry.output}`);
          const after = await snapshotTree(dir);
          assertTreeUnchanged(before, after, verb);

          // 2. The envelope carries the uniform preview marker.
          const envelope = parse(dry.stdout, verb);
          probe.assertPreview?.(envelope);
          assertEquals(
            envelope.dry_run,
            true,
            `${verb}: a dry-run envelope must carry dry_run: true`,
          );
          assertEquals(
            envelope.steps ?? [],
            [],
            `${verb}: a serialized dry run must carry no applied effects`,
          );
          const contract = resultContractForVerb(envelope.verb);
          assert(contract !== undefined, `${verb}: no public result contract`);
          const dryMarkdown = renderResultMarkdown(
            envelope,
            contract.presenter,
          );
          assertStringIncludes(
            dryMarkdown,
            `## Current state\n\n${DRY_RUN_LEAD}\n\n`,
            `${verb}: Markdown lacks the canonical dry-run lead`,
          );

          if (probe.envelope === "engine-plan") {
            // 3. Applied ⊆ planned on the SAME fixture, and the fixture is real
            // work (an empty applied set would make the subset vacuous).
            assert(
              envelope.plan !== undefined,
              `${verb}: an engine-plan member must emit plan.steps on --dry-run`,
            );
            assert(
              run.apply !== undefined,
              `${verb}: probe lists no apply argv`,
            );
            const apply = await runAgent(run.cwd, run.apply, {
              env: run.env ?? {},
            });
            assertEquals(
              apply.code,
              0,
              `${verb}: apply failed\n${apply.output}`,
            );
            assert(
              appliedSet(apply.stdout, verb).size > 0,
              `${verb}: fixture applied nothing\n${apply.output}`,
            );
            assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, verb);
            if ((envelope.plan?.steps ?? []).length > 0) {
              assert(
                /Would (?:run|skip|check) `/.test(dryMarkdown),
                `${verb}: Markdown plan uses applied grammar\n${dryMarkdown}`,
              );
            }
            const appliedEnvelope = parse(apply.stdout, verb);
            const appliedContract = resultContractForVerb(
              appliedEnvelope.verb,
            );
            assert(
              appliedContract !== undefined,
              `${verb}: applied result has no public contract`,
            );
            const appliedMarkdown = renderResultMarkdown(
              appliedEnvelope,
              appliedContract.presenter,
            );
            assert(
              !appliedMarkdown.includes(DRY_RUN_LEAD),
              `${verb}: applied Markdown inherited the dry-run lead`,
            );
            assert(
              !/Would (?:run|skip|check) `/.test(appliedMarkdown),
              `${verb}: applied Markdown inherited dry-run plan copy`,
            );
          } else {
            // 3'. The recorded exception stays honest: the preview rides in
            // `data`, and the envelope carries no engine plan. A member that
            // grows one must move to the engine-plan side of the table.
            assertEquals(
              envelope.plan,
              undefined,
              `${verb}: emits an engine plan — move its probe to ` +
                `envelope: "engine-plan" so applied ⊆ planned is enforced`,
            );
            assert(
              envelope.data !== undefined,
              `${verb}: a data-preview member must carry its preview in data`,
            );
            const currentState = dryMarkdown.slice(
              dryMarkdown.indexOf(DRY_RUN_LEAD) + DRY_RUN_LEAD.length,
              dryMarkdown.indexOf("## Evidence") < 0
                ? undefined
                : dryMarkdown.indexOf("## Evidence"),
            );
            assert(
              /\bwould\b/i.test(currentState),
              `${verb}: data preview state is not conditional\n${dryMarkdown}`,
            );
            const appliedTwin = { ...envelope };
            delete appliedTwin.dry_run;
            const appliedMarkdown = renderResultMarkdown(
              appliedTwin,
              contract.presenter,
            );
            assert(
              !appliedMarkdown.includes(DRY_RUN_LEAD),
              `${verb}: non-dry Markdown inherited the dry-run lead`,
            );
          }
        });
      },
    });
  });
});

Deno.test("control: the enumeration catches a fresh-named verb in a fresh group", () => {
  // The adversarial future sibling: the same mechanism (an effectful verb
  // registering --dry-run) rebuilt under unrelated names, in a container that
  // does not exist today. The walker must find both without a case-table edit;
  // the fail-closed assertEquals above then refuses them until they carry a
  // probe. A command without the flag must NOT enrol. Subcommands attach via
  // the two-arg instance form: chained `.command(name)` moves Cliffy's cursor,
  // it does not return the child.
  const widgets = new Command().description("A fresh group.");
  widgets.command(
    "zap",
    new Command().description("A fresh member.").option("--dry-run", "P."),
  );
  const fake = new Command().name("fake");
  fake.command(
    "frobnicate",
    new Command().description("A fresh verb.").option("--dry-run", "P."),
  );
  fake.command("widgets", widgets);
  fake.command("inert", new Command().description("No preview flag."));
  assertEquals(
    dryRunCapablePaths(fake as unknown as Command),
    ["frobnicate", "widgets zap"],
  );
});

Deno.test("control: an applied effect absent from the plan fails the subset guard", () => {
  assertThrows(
    () =>
      assertAppliedStepSubset(
        new Set(["refresh:known-target"]),
        new Set(["refresh:known-target", "refresh:future-unlisted-target"]),
        "future writer",
      ),
    Error,
    "apply executed steps the dry-run plan never listed",
  );
});

// ── member-specific structural depth (kept from the original prune cure) ────

Deno.test("parity: worktree prune apply consumes the built scan instead of re-scanning", async () => {
  const lifecycle = await Deno.readTextFile("src/engine/worktree/lifecycle.ts");
  assertStringIncludes(
    lifecycle,
    "pruneGitWorktrees(plan.gitScan",
    "prune apply must consume the git scan stored in its plan",
  );
  assertStringIncludes(
    lifecycle,
    "sweepOrphanWorktrees(plan.orphanScan",
    "prune apply must consume the orphan scan stored in its plan",
  );
  assertStringIncludes(
    lifecycle,
    "plan.resourceReclaims",
    "prune apply must consume the resource reclaim entries stored in its plan",
  );
  assert(
    !lifecycle.includes("pruneGitWorktrees({"),
    "prune apply must not rebuild git prune options and re-scan",
  );
  assert(
    !lifecycle.includes("sweepOrphanWorktrees({"),
    "prune apply must not rebuild orphan sweep options and re-scan",
  );

  const gitLayer = await Deno.readTextFile("src/engine/worktree/git.ts");
  assertStringIncludes(gitLayer, "scanGitWorktreesForPrune");
  assertStringIncludes(gitLayer, "scanOrphanWorktreesForSweep");
  assert(
    !gitLayer.includes("dryRun?: boolean"),
    "git prune/sweep helpers should not have dry/wet branches to keep in sync",
  );
});

Deno.test("parity: every destructive scan-consuming apply re-validates candidates at apply time", async () => {
  // The prune plan can sit at a confirmation interaction for minutes while agents
  // keep working in the candidate worktrees, so a scan-consuming apply that
  // trusts its scan's eligibility verdict destroys work created in the window
  // (the original bug: pruneGitWorktrees force-removed a worktree that gained
  // uncommitted edits after the scan). The discipline: every destructive
  // primitive in a scan-consuming apply pairs with an apply-time re-check of
  // the condition the scan judged. This guard enumerates the scan-consuming
  // functions from the source itself — a NEW apply auto-enrols — and requires
  // the pairing per destructive primitive. It proves presence of the re-check,
  // not its placement; the behavioral race tests in
  // engine_worktree_prune_test.ts pin what the re-check must actually do.
  const source = await Deno.readTextFile("src/engine/worktree/git.ts");

  // Every top-level function whose first parameter is one of the scan shapes.
  const declRe =
    /(?:export )?(?:async )?function (\w+)\(\s*scan: (?:GitWorktreePruneScan|OrphanWorktreeSweepScan)\b/g;
  const nextDeclRe = /\n(?:export )?(?:async )?function |\n\/\*\*/g;
  const bodies = new Map<string, string>();
  for (const m of source.matchAll(declRe)) {
    const start = (m.index ?? 0) + m[0].length;
    nextDeclRe.lastIndex = start;
    const next = nextDeclRe.exec(source);
    bodies.set(m[1] ?? "", source.slice(start, next?.index ?? source.length));
  }
  for (
    const expected of [
      "pruneGitWorktrees",
      "sweepOrphanWorktrees",
      "pruneStaleWorktreeMetadata",
    ]
  ) {
    assert(
      bodies.has(expected),
      `scan-consuming apply enumeration lost ${expected} — fix the guard's regex`,
    );
  }

  // destructive primitive → the apply-time re-check that must accompany it.
  const pairings: [needle: string, recheck: RegExp, rule: string][] = [
    [
      "removeWorktreeSafely(",
      /CandidateChanged\(/,
      "a worktree/orphan removal must re-check the candidate against live state",
    ],
    [
      '"-D"',
      /branchIsMerged\(/,
      "a branch deletion must re-check merged-ness at apply time",
    ],
    [
      "Deno.remove(",
      /StillMatches\(/,
      "a metadata prune must re-read the admin entry at apply time",
    ],
  ];
  for (const [name, body] of bodies) {
    for (const [needle, recheck, rule] of pairings) {
      if (!body.includes(needle)) {
        continue;
      }
      assert(
        recheck.test(body),
        `${name} uses ${needle} without an apply-time re-check: ${rule}`,
      );
    }
  }
});
