/**
 * Architectural guard for the workspace contract (ADR 0389): every authored
 * argument list that hands Git a command able to install a revision or replace
 * a checkout's index or working tree is one registered row under one of the
 * contract's three allowances. Unknown invocations, stale rows, malformed
 * allowances, and evasions through aliases or leading global options all fail
 * independently.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  checkoutMutationFiles,
  checkoutMutationLaunderingInFiles,
  checkoutMutationLaunderingInSource,
  checkoutMutationParityFindings,
  checkoutMutationSitesInFiles,
  checkoutMutationSitesInSource,
  guardedCommandOf,
} from "../scripts/checkout_mutation_boundaries.ts";
import {
  CHECKOUT_MUTATION_ALLOWANCES,
  CHECKOUT_MUTATION_BOUNDARIES,
  CHECKOUT_MUTATION_COMMANDS,
} from "./checkout_mutation_surfaces.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("every checkout-changing git invocation is one registered allowance", async () => {
  const actual = await checkoutMutationSitesInFiles(
    REPO_ROOT,
    await checkoutMutationFiles(),
  );
  assertEquals(
    checkoutMutationParityFindings(actual, CHECKOUT_MUTATION_BOUNDARIES),
    [],
  );
});

Deno.test("every registered row names a contract allowance with a one-line reason", () => {
  for (const row of CHECKOUT_MUTATION_BOUNDARIES) {
    assert(
      row.allowance in CHECKOUT_MUTATION_ALLOWANCES,
      `${row.path}#${row.enclosingFunction} names an unknown allowance`,
    );
    assert(
      CHECKOUT_MUTATION_COMMANDS.includes(row.command),
      `${row.path}#${row.enclosingFunction} names an unguarded command`,
    );
    assert(
      row.reason.trim().length >= 24 && !/[\r\n]/.test(row.reason),
      `${row.path}#${row.enclosingFunction} needs a specific one-line reason`,
    );
  }
});

Deno.test("the scanner follows aliases and leading global options", () => {
  const sites = checkoutMutationSitesInSource(
    [
      "declare function git(args: string[], cwd: string): Promise<unknown>;",
      "declare function enumOf(values: string[]): unknown;",
      "export async function install(dir: string, head: string) {",
      '  await git(["-C", dir, "switch", "--detach", head], dir);',
      '  const args = ["worktree", "add", "--detach", dir];',
      "  args.push(head);",
      "  await git(args, dir);",
      '  await git(["worktree", "list", "--porcelain"], dir);',
      '  new Deno.Command("git", { args: ["reset", "--hard", head] }).spawn();',
      "}",
      'const keywords = new Set(["switch", "checkout"]);',
      'const kinds = enumOf(["checkout", "common"]);',
      "export function lifecycle(name: string) {",
      '  return present("reset", name);',
      "}",
    ].join("\n"),
    "planted.ts",
  );
  assertEquals(
    sites.map((site) => `${site.enclosingFunction}:${site.command}`),
    ["install:switch", "install:worktree add", "install:reset"],
  );
});

Deno.test("the scanner resolves runner identity through import aliases and local re-bindings", () => {
  // The callee spelling carries no runner shape in either fixture: the runner
  // arrives as an import alias, then travels through a local re-binding. Both
  // argument lists must still enter the census.
  const sites = checkoutMutationSitesInSource(
    [
      'import { runGit as dispatch } from "../shared/subprocess.ts";',
      "const send = dispatch;",
      "export async function relocate(dir: string, head: string) {",
      '  await dispatch(["checkout", "--detach", head], { cwd: dir });',
      '  await send(["reset", "--hard", head], { cwd: dir });',
      "}",
    ].join("\n"),
    "aliased-runner.ts",
  );
  assertEquals(
    sites.map((site) => `${site.enclosingFunction}:${site.command}`),
    ["relocate:checkout", "relocate:reset"],
  );
});

Deno.test("exports cannot launder a runner identity under an unrecognizable name", () => {
  const laundering = [
    'export { runGit as dispatch } from "../shared/subprocess.ts";',
    [
      'import { runGit } from "../shared/subprocess.ts";',
      "const quiet = runGit;",
      "export { quiet };",
    ].join("\n"),
    [
      'import { runGit } from "../shared/subprocess.ts";',
      "export const quiet = runGit;",
    ].join("\n"),
    [
      'import { runGit } from "../shared/subprocess.ts";',
      "export default runGit;",
    ].join("\n"),
  ];
  for (const source of laundering) {
    const findings = checkoutMutationLaunderingInSource(source, "laundered.ts");
    assertEquals(findings.length, 1, source);
    const found = findings[0];
    assert(found !== undefined);
    assertStringIncludes(found, "runner identity 'runGit'");
    assertStringIncludes(found, "laundered.ts");
  }
  const benign = [
    "declare function isObject(value: unknown): boolean;\n" +
    "export { isObject as isJsonObject };",
    "declare function buildPlugin(): unknown;\n" +
    "export const plugin = buildPlugin();",
    'export type { RunGitOptions as Options } from "../shared/subprocess.ts";',
    'export { runGit } from "../shared/subprocess.ts";',
  ];
  for (const source of benign) {
    assertEquals(
      checkoutMutationLaunderingInSource(source, "benign.ts"),
      [],
      source,
    );
  }
});

Deno.test("no authored export launders a runner identity today", async () => {
  assertEquals(
    await checkoutMutationLaunderingInFiles(
      REPO_ROOT,
      await checkoutMutationFiles(),
    ),
    [],
  );
});

Deno.test("subcommand resolution skips valued and bare global options", () => {
  assertEquals(guardedCommandOf(["checkout", "main"]), "checkout");
  assertEquals(guardedCommandOf(["-C", "dir", "restore", "."]), "restore");
  assertEquals(
    guardedCommandOf(["--no-pager", "-c", "x=y", "read-tree", "-u"]),
    "read-tree",
  );
  assertEquals(
    guardedCommandOf(["worktree", "remove", "dir"]),
    "worktree remove",
  );
  assertEquals(guardedCommandOf(["worktree", "prune"]), undefined);
  assertEquals(guardedCommandOf([undefined, "checkout"]), undefined);
  assertEquals(guardedCommandOf(["status", "--porcelain"]), undefined);
});

Deno.test("the guard enrolls an unrelated future source root", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(`${root}/another/container`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/another/container/relay.ts`,
      [
        "declare function run(args: string[]): void;",
        "export function relay(): void {",
        '  run(["checkout", "main"]);',
        "}",
      ].join("\n"),
    );
    await gitInit(root);
    const actual = await checkoutMutationSitesInFiles(
      root,
      await checkoutMutationFiles(root),
    );
    assertEquals(checkoutMutationParityFindings(actual, []), [
      "unregistered checkout-changing git checkout at another/container/relay.ts:3:7 inside relay",
    ]);
  });
});

Deno.test("a stale registry row fails with its command", () => {
  assertEquals(
    checkoutMutationParityFindings([], [{
      path: "future/tool.ts",
      enclosingFunction: "install",
      command: "worktree add",
      allowance: "owned-worktree",
      reason: "a retired helper once created its own scratch worktree",
    }]),
    ["stale checkout-mutation boundary future/tool.ts#install (git worktree add)"],
  );
});
