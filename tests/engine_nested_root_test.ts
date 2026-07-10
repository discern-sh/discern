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
 * against root-relative config (scope globs, ratchet baselines, coupling
 * inputs) breaks silently when the root sits below the toplevel.
 *
 * Every test here drives a key engine path against the SAME nested fixture
 * (`scaffoldNested`): ratchets (both halves), scope classification (the gate's
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
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { couplingResult } from "../src/engine/coupling/coupling.ts";
import type { CouplingData } from "../src/shared/result_schemas.ts";
import { worktreeDirtyPaths } from "../src/engine/gate/fix_drift.ts";

/**
 * Scaffold a real discern install at `<repo>/app` and git-init the REPOSITORY
 * one level above it, so the project root is a subdirectory of its git
 * toplevel. Returns the nested project root (`<repo>/app`).
 */
async function scaffoldNested(repo: string, config: string): Promise<string> {
  const app = join(repo, "app");
  await Deno.mkdir(app, { recursive: true });
  await scaffoldEngine(app);
  await writeConfig(app, config);
  await gitInit(repo);
  return app;
}

/** A one-ratchet config: an `up` floor at `limit`, measuring `measured`. */
function floorConfig(limit: string, measured: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[ratchets.coverage]",
    'direction = "up"',
    `limit = ${limit}`,
    `run = "echo 'DISCERN_METRIC coverage ${measured}'"`,
    "",
  ].join("\n");
}

// ── ratchets: the never-loosen half must survive a nested root ─────────────────
// Regression: `git show <main>:discern.toml` resolves the path against the repo
// toplevel, so from a nested root both baseline candidates failed, the baseline
// read undefined, and a loosened limit sailed through as "not loosened" — the
// exact regression a ratchet exists to catch, disabled silently.

Deno.test("nested root: loosening a ratchet limit vs main still fails", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, floorConfig("80", "99"));
    await git(repo, "checkout", "-q", "-b", "agent/x");
    await writeConfig(app, floorConfig("70", "99"));
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "loosen the floor", "--no-gpg-sign");

    const r = await runAgent(app, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "floor 80 -> 70");
    assertStringIncludes(r.stderr, "only rises");
  });
});

Deno.test("nested root: a held ratchet still measures and passes", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(repo, floorConfig("80", "85"));
    const r = await runAgent(app, ["ratchets"]);
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
    'main_branch = "main"',
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

    const r = await runAgent(app, ["scopes", "--json"]);
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

    const r = await runAgent(app, ["scopes", "--json"]);
    assertEquals(r.code, 0, r.output);
    const scopes = JSON.parse(r.stdout.trim()).data.scopes as string[];
    assertEquals(scopes, [], `sibling dirt must not classify: ${r.stdout}`);
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

Deno.test("nested root: the co-change advisory mines root-relative partners", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      ["[project]", 'slug = "engine-test"', 'main_branch = "main"', ""].join(
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

// ── fix-drift: the strand snapshot must speak root-relative paths ──────────────
// The stranded-file diagnostic names the paths and shows `git diff -- <paths>`
// run at the root; toplevel-relative paths would misname the files and resolve
// to nothing as cwd-relative pathspecs, leaving the evidence diff empty.

Deno.test("nested root: the fix-stage dirty snapshot is root-relative", async () => {
  await withTempDir(async (repo) => {
    const app = await scaffoldNested(
      repo,
      ["[project]", 'slug = "engine-test"', 'main_branch = "main"', ""].join(
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
