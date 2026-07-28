/**
 * Class guard for every CLI surface that can prompt. The matrix drives the real
 * artifact under pseudo-TTYs with CI / --plain, and with stdin closed, so a new
 * accidental read blocks for five seconds at most and fails by name. A source
 * scan separately makes `src/lib/prompts.ts` the only legal Cliffy prompt choke.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";
import {
  defaultMapPath,
  git,
  gitInit,
  runAgent,
  runAgentPty,
  type RunResult,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const PRESETS = join(REPO_ROOT, "tests", "fixtures", "presets");

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
  { name: "help browser", args: ["help"], code: 0, output: "discern help" },
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
];

/** Add the global flag without inventing a verb for the bare invocation. */
function plainArgs(args: readonly string[]): string[] {
  return args.length === 0 ? ["--plain"] : [...args, "--plain"];
}

Deno.test({
  name:
    "every interactive-capable verb terminates under CI, --plain, and closed stdin",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await Deno.mkdir(defaultMapPath(dir, "00-guide"), { recursive: true });
      await Deno.writeTextFile(
        defaultMapPath(dir, "00-guide", "README.md"),
        "# Guide\n\nThe project guide.\n",
      );
      await gitInit(dir);
      // A fully merged branch gives prune a real confirmation-bearing plan.
      await git(dir, "branch", "agent/merged-candidate");

      const signals: readonly {
        name: string;
        run(testCase: typeof INTERACTIVE_CASES[number]): Promise<RunResult>;
      }[] = [
        {
          name: "CI pseudo-TTY",
          run: (testCase) =>
            runAgentPty(dir, [...testCase.args], {
              env: { ...testCase.env, CI: "1" },
            }),
        },
        {
          name: "--plain pseudo-TTY",
          run: (testCase) =>
            runAgentPty(dir, plainArgs(testCase.args), {
              ...(testCase.env !== undefined ? { env: testCase.env } : {}),
            }),
        },
        {
          name: "closed stdin",
          run: (testCase) =>
            runAgent(dir, [...testCase.args], {
              ...(testCase.env !== undefined ? { env: testCase.env } : {}),
            }),
        },
      ];

      for (const signal of signals) {
        for (const testCase of INTERACTIVE_CASES) {
          const result = await signal.run(testCase);
          const label = `${signal.name}: ${testCase.name}`;
          assertEquals(
            result.code,
            testCase.code,
            `${label}\n${result.output}`,
          );
          assertStringIncludes(result.output, testCase.output, label);
        }
      }
    });
  },
});

Deno.test("all Cliffy prompt calls live behind the central interaction policy", async () => {
  const owners = new Set<string>();
  let calls = 0;
  const pattern =
    /\b(?:Select|Checkbox|Input|Confirm)\.prompt(?:<[^>]+>)?\s*\(/g;
  for await (
    const entry of walk(join(REPO_ROOT, "src"), {
      exts: [".ts"],
      includeDirs: false,
    })
  ) {
    const source = await Deno.readTextFile(entry.path);
    const found = [...source.matchAll(pattern)].length;
    if (found > 0) {
      calls += found;
      owners.add(relative(REPO_ROOT, entry.path));
    }
  }
  assert(calls >= 4, "the guard must see the four Cliffy prompt kinds");
  assertEquals(owners, new Set(["src/lib/prompts.ts"]));
});
