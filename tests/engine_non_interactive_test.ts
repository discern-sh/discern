/**
 * Class guard for every CLI surface that can request input. The matrix drives the real
 * artifact with stdin closed, so a new accidental read fails by name. One
 * representative pseudo-terminal retains the operating-system wiring. The
 * human-output structural guard separately makes `src/lib/terminal_interaction.ts` the only
 * legal package interaction choke point.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  addWorktree,
  defaultMapPath,
  engineEnv,
  git,
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { realPtyTest } from "./real_pty.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const PRESETS = join(REPO_ROOT, "tests", "fixtures", "presets");

Deno.test("engine fixtures declare CI state instead of inheriting the test host", async () => {
  assertEquals((await engineEnv()).CI, "false");
  assertEquals((await engineEnv({ CI: "1" })).CI, "1");
});

/** Every currently interactive-capable CLI form and its non-interactive fallback. */
const INTERACTIVE_CASES: readonly {
  name: string;
  args: readonly string[];
  code: number;
  output: string;
  env?: Record<string, string>;
}[] = [
  { name: "bare desk", args: [], code: 0, output: "Your desk" },
  { name: "map browser", args: ["map"], code: 0, output: "discern map" },
  { name: "docs browser", args: ["docs"], code: 0, output: "discern docs" },
  {
    name: "map selective export",
    args: ["map", "--export", "select", "--output", "selected.md"],
    code: 1,
    output: "requires an interactive terminal",
  },
  {
    name: "improvement drill-down",
    args: ["improvement"],
    code: 0,
    output: "Automated practice health",
  },
  { name: "named desk", args: ["desk"], code: 1, output: "status" },
  {
    name: "worktree shell picker",
    args: ["worktrees"],
    code: 1,
    output: "status --all",
  },
  {
    name: "preset confirmation",
    args: ["preset", "example"],
    code: 1,
    output: "needs confirmation",
    env: { DISCERN_PRESETS_DIR: PRESETS },
  },
  {
    name: "uninstall confirmation",
    args: ["uninstall"],
    code: 1,
    output: "needs confirmation",
  },
  {
    name: "worktree prune confirmation",
    args: ["worktree", "prune"],
    code: 1,
    output: "Confirmation required",
  },
  {
    name: "Logbook reset confirmation",
    args: ["patterns", "reset"],
    code: 1,
    output: "requires terminal stdin and stdout",
  },
  {
    name: "Logbook archive confirmation",
    args: ["patterns", "archive"],
    code: 1,
    output: "requires terminal stdin and stdout",
  },
];

realPtyTest({
  name: "CI policy vetoes interaction through one real pseudo-terminal",
  contracts: ["platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const result = await runAgentPty(dir, [], { env: { CI: "1" } });
      assertEquals(result.code, 0, result.output);
      assertTerminalTextIncludes(
        result.output.toLocaleLowerCase(),
        "your desk",
      );
    });
  },
});

Deno.test({
  name: "every interactive-capable verb terminates with closed standard input",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await Deno.mkdir(defaultMapPath(dir, "00-guide"), { recursive: true });
      await Deno.writeTextFile(
        defaultMapPath(dir, "00-guide", "README.md"),
        "# Guide\n\nThe project guide.\n",
      );
      await gitInit(dir);
      await withTempDir(async (pruneDir) => {
        await scaffoldEngine(pruneDir);
        await gitInit(pruneDir);
        // Keep prune's ownership fixture in a separate repository so its live
        // linked checkout cannot alter another verb's refusal preconditions.
        const pruneWorktree = await addWorktree(
          pruneDir,
          "merged-candidate",
        );
        const setup = await runAgent(pruneWorktree, [
          "worktree",
          "setup",
          "--json",
        ]);
        assertEquals(setup.code, 0, setup.output);
        await git(pruneWorktree, "add", "-A");
        await git(
          pruneWorktree,
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "ready fixture",
          "--no-gpg-sign",
        );
        await git(
          pruneDir,
          "merge",
          "--no-ff",
          "-m",
          "merge ready fixture",
          "agent/merged-candidate",
        );

        const cwdFor = (testCase: typeof INTERACTIVE_CASES[number]): string =>
          testCase.name === "worktree prune confirmation" ? pruneDir : dir;
        try {
          for (const testCase of INTERACTIVE_CASES) {
            const result = await runAgent(
              cwdFor(testCase),
              [...testCase.args],
              testCase.env === undefined ? {} : { env: testCase.env },
            );
            assertEquals(
              result.code,
              testCase.code,
              `${testCase.name}\n${result.output}`,
            );
            assertStringIncludes(
              result.output.toLocaleLowerCase(),
              testCase.output.toLocaleLowerCase(),
              testCase.name,
            );
          }
        } finally {
          await git(
            pruneDir,
            "worktree",
            "remove",
            "--force",
            pruneWorktree,
          ).catch(() => undefined);
          await Deno.remove(dirname(pruneWorktree), { recursive: true }).catch(
            () => undefined,
          );
        }
      });
    });
  },
});
