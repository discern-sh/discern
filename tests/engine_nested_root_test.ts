/**
 * Structural coverage for the NESTED-ROOT repository shape: a project whose
 * `discern.toml` lives in a subdirectory of its git repository (e.g. a discern
 * project folded into a monorepo at `<repo>/app`). `findRoot` happily roots
 * there, so every engine verb can run in this shape — and each one must either
 * work correctly or refuse loudly; silent misbehaviour is the defect class this
 * suite guards.
 *
 * The class predicate: an engine code path that consumes git-emitted paths (or
 * addresses a blob as `rev:path`) while assuming the project root is the git
 * toplevel. Git resolves a bare `rev:path` against the repository TOP LEVEL,
 * and `diff --name-only` / `status --porcelain` / `log --name-only` all emit
 * toplevel-relative paths regardless of cwd — so any consumer comparing them
 * against root-relative config (scope globs, standard baselines, coupling
 * inputs) breaks silently when the root sits below the toplevel.
 *
 * Every test here drives a key engine path against the SAME nested fixture
 * (`scaffoldNested`): standards (both halves), scope classification (the gate's
 * routing signal), coupling, the fix-stage strand snapshot, and the worktree
 * lifecycle's deliberate refusal. Out of scope (deliberate, not silent): the
 * clean-tree guards read `git status` repo-wide (conservative — sibling dirt
 * blocks with a loud message), and receipt renderings show repo-relative paths
 * (cosmetic).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  convergeFixtureGitattributes,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { WORKTREE_LIFECYCLE_REPO_ROOT_VERBS } from "../src/engine/worktree/lifecycle.ts";
import { couplingResult } from "../src/engine/coupling/coupling.ts";
import type { CouplingData } from "../src/shared/result_schemas.ts";
import { worktreeDirtyPaths } from "../src/engine/gate/tree_drift.ts";

/**
 * Scaffold a real discern install at `<repo>/app` and git-init the REPOSITORY
 * one level above it, so the project root is a subdirectory of its git
 * toplevel. Returns the nested project root (`<repo>/app`).
 */
async function scaffoldNested(
  repo: string,
  config: string,
  projectDir = "app",
): Promise<string> {
  const app = join(repo, projectDir);
  await Deno.mkdir(app, { recursive: true });
  await scaffoldEngine(app);
  await writeConfig(app, config);
  await convergeFixtureGitattributes(app);
  await gitInit(repo);
  return app;
}

/** A one-standard config: an `up` floor at `limit`, measuring `measured`. */
function floorConfig(limit: string, measured: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[standards.coverage]",
    'direction = "up"',
    `limit = ${limit}`,
    `run = "echo 'DISCERN_METRIC coverage ${measured}'"`,
    "",
  ].join("\n");
}

// ── standards: the never-loosen half must survive a nested root ─────────────────
// Regression: `git show <main>:discern.toml` resolves the path against the repo
// toplevel, so from a nested root both baseline candidates failed, the baseline
// read undefined, and a loosened limit sailed through as "not loosened" — the
// exact regression a standard exists to catch, disabled silently.

Deno.test("nested root: loosening a standard limit vs main still fails", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, floorConfig("80", "99"));
    await git(repo, "checkout", "-q", "-b", "agent/x");
    await writeConfig(app, floorConfig("70", "99"));
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "loosen the floor", "--no-gpg-sign");

    const r = await runAgent(app, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "floor 80 -> 70");
    assertStringIncludes(r.stderr, "only rises");
  });
});

Deno.test("nested root: a held standard still measures and passes", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, floorConfig("80", "85"));
    const r = await runAgent(app, ["standards"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "meets the floor");
  });
});

// ── scopes: classification must speak root-relative paths ──────────────────────
// The classifier feeds the gate (which scope gates fire) and status. Git emits
// toplevel-relative paths, so without normalization a nested root's changes
// carry the subdir prefix, match no scope glob, and the scope gates silently
// skip — the dangerous direction (fewer gates, not more).

/** A config with one gated scope over `widget/**`. */
function widgetConfig(): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[scopes.widget]",
    'paths = ["widget/**"]',
    'gate = "true"',
    "",
  ].join("\n");
}

Deno.test("nested root: committed and pending changes classify into their scope", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, widgetConfig());
    await Deno.mkdir(join(app, "widget"));

    // One committed change on a branch (read via `git diff main...HEAD`)…
    await git(repo, "checkout", "-q", "-b", "agent/x");
    await Deno.writeTextFile(join(app, "widget", "a.txt"), "a");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "widget work", "--no-gpg-sign");
    // …and one pending change (read via `git status --porcelain`).
    await Deno.writeTextFile(join(app, "widget", "b.txt"), "b");

    const r = await runAgent(app, ["impact", "--json"]);
    assertEquals(r.code, 0, r.output);
    const scopes = JSON.parse(r.stdout.trim()).data.scopes as string[];
    assert(scopes.includes("widget"), `widget must classify: ${r.stdout}`);
    assert(scopes.includes("code"), `code marker must fire: ${r.stdout}`);
  });
});

Deno.test("nested root: a sibling project's changes are not this project's code", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, widgetConfig());
    // Dirt elsewhere in the monorepo — outside the project subtree entirely.
    await Deno.mkdir(join(repo, "other"));
    await Deno.writeTextFile(join(repo, "other", "x.txt"), "x");

    const r = await runAgent(app, ["impact", "--json"]);
    assertEquals(r.code, 0, r.output);
    const scopes = JSON.parse(r.stdout.trim()).data.scopes as string[];
    assertEquals(scopes, [], `sibling dirt must not classify: ${r.stdout}`);
  });
});

Deno.test("nested root: whitespace in the project prefix remains Git path data", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, widgetConfig(), " app");
    await git(repo, "checkout", "-q", "-b", "agent/x");

    // This is a sibling named `app`, not the discern project named ` app`.
    // Trimming `git rev-parse --show-prefix` aliases the two and grants the
    // sibling's `widget/**` path this project's scope.
    await Deno.mkdir(join(repo, "app", "widget"), { recursive: true });
    await Deno.writeTextFile(join(repo, "app", "widget", "x.txt"), "sibling");

    const r = await runAgent(app, ["impact", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      JSON.parse(r.stdout.trim()).data.scopes,
      [],
      `a whitespace-distinct sibling must not classify: ${r.stdout}`,
    );
  });
});

// ── coupling: the miner must speak root-relative paths too ─────────────────────
// `git log --name-only` emits toplevel-relative paths, so without normalization
// a nested root's history baskets carry the subdir prefix, the (root-relative)
// input file matches none of them, and the advisory reports no partners — a
// silent no-op rather than a wrong answer, but the same class of defect.

/** Commit a set of {repo-relative path: contents} files in one commit. */
async function commitFiles(
  repo: string,
  files: Record<string, string>,
  msg: string,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(repo, rel);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, content);
  }
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", msg, "--no-gpg-sign");
}

Deno.test("nested root: the coupling mines root-relative partners", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join(
        "\n",
      ),
    );
    // a.ts ↔ b.ts couple in 4 commits inside the project; noise commits keep
    // the co-occurrence significant; sibling-project commits outside the
    // subtree must neither surface nor collide (other/a.ts is NOT a.ts).
    for (let i = 0; i < 4; i++) {
      await commitFiles(
        repo,
        { "app/a.ts": `${i}`, "app/b.ts": `${i}` },
        `ab${i}`,
      );
    }
    for (let i = 0; i < 6; i++) {
      await commitFiles(
        repo,
        { [`app/n${i}a.ts`]: "1", [`app/n${i}b.ts`]: "1" },
        `n${i}`,
      );
    }
    await commitFiles(repo, { "other/a.ts": "1", "other/c.ts": "1" }, "sib");

    const data = (await couplingResult(app, { paths: ["a.ts"] }))
      .data as CouplingData;
    const paths = data.partners.map((p) => p.path);
    assert(
      paths.includes("b.ts"),
      `the project's own coupling must surface root-relative: ${
        JSON.stringify(data)
      }`,
    );
    assert(
      !paths.includes("c.ts") && !paths.includes("other/c.ts"),
      `a sibling project's history must not leak in: ${paths}`,
    );
  });
});

// ── tree-drift: the strand snapshot must speak root-relative paths ─────────────
// The stranded-file diagnostic names the paths and shows `git diff -- <paths>`
// run at the root; toplevel-relative paths would misname the files and resolve
// to nothing as cwd-relative pathspecs, leaving the evidence diff empty.

Deno.test("nested root: the strand dirty snapshot is root-relative", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join(
        "\n",
      ),
    );
    await commitFiles(repo, { "app/tracked.txt": "one\n" }, "add tracked");
    await Deno.writeTextFile(join(app, "tracked.txt"), "two\n");

    const dirty = await worktreeDirtyPaths(app);
    assert(dirty !== null, "git must answer in a healthy repo");
    assert(
      dirty.has("tracked.txt"),
      `the dirty path must be root-relative: ${[...dirty]}`,
    );
  });
});

// ── the gate end-to-end: scope routing must not silently skip ──────────────────

Deno.test("nested root: finish fires the changed scope's gate", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "echo WIDGET-GATE-RAN"',
        "",
      ].join("\n"),
    );
    await Deno.mkdir(join(app, "widget"));
    await Deno.writeTextFile(join(app, "widget", "x.txt"), "x");

    const r = await runAgent(app, ["done"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "scope:widget");
    assertStringIncludes(r.stdout, "WIDGET-GATE-RAN");
  });
});

// ── the deliberate refusals: loud, actionable, never a half-working state ──────
// A worktree is a whole-repository checkout, so the lifecycle cannot serve a
// nested root — `start` refuses with the move-it message, and doctor's
// "repository shape" check reports the same fact at health-check time. These
// lock the refusal in as the shape's contract: if a future change makes `start`
// half-work here instead, this is the test that catches it.

Deno.test("nested root: start refuses with the actionable repository-shape message", async () => {
  assertEquals(WORKTREE_LIFECYCLE_REPO_ROOT_VERBS, ["start", "accept"]);
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join(
        "\n",
      ),
    );
    const r = await runAgent(app, ["start", "--json"]);
    assert(r.code !== 0, `start must refuse under a nested root: ${r.output}`);
    assertStringIncludes(r.output, "repository");
    assertStringIncludes(r.output, "move discern.toml");
  });
});

Deno.test("nested root: accept refuses before a standing grant can hide sibling changes", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.map]",
        'paths = ["docs/**"]',
        "neutral = true",
        "",
        "[acceptance]",
        'pre_authorized = ["map"]',
        "",
      ].join("\n"),
    );
    const mainBefore = await gitOut(repo, "rev-parse", "main");
    const worktree = await addWorktree(repo, "nested-accept");
    const worktreeApp = join(worktree, "app");
    await Deno.mkdir(join(worktreeApp, "docs"), { recursive: true });
    await Deno.mkdir(join(worktree, "infra"), { recursive: true });
    await Deno.writeTextFile(
      join(worktreeApp, "docs", "guide.md"),
      "covered\n",
    );
    await Deno.writeTextFile(
      join(worktree, "infra", "production.yml"),
      "unclassified sibling\n",
    );
    await git(worktree, "add", "-A");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "mix nested and sibling changes",
      "--no-gpg-sign",
    );

    const refused = await runAgent(worktreeApp, ["accept", "--json"]);
    assert(
      refused.code !== 0,
      `accept must refuse the unsupported repository shape: ${refused.output}`,
    );
    assertStringIncludes(refused.output, "git repository's root");
    assertStringIncludes(refused.output, "move discern.toml");
    assertEquals(await gitOut(repo, "rev-parse", "main"), mainBefore);
    assertEquals(app, join(repo, "app"));
  });
});

Deno.test("nested root: doctor's repository-shape check names the layout and the fix", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join(
        "\n",
      ),
    );
    const r = await runAgent(app, ["doctor", "--json"]);
    assertEquals(r.code, 1, r.output);
    const payload = JSON.parse(r.stdout.trim()) as {
      data: {
        checks: Array<{ name: string; ok: boolean; detail: string }>;
      };
    };
    const shape = payload.data.checks.find((c) =>
      c.name === "repository shape"
    );
    assert(shape !== undefined, "doctor must carry a repository-shape check");
    assertEquals(shape.ok, false);
    assertStringIncludes(shape.detail, "git repository's root");
  });
});
