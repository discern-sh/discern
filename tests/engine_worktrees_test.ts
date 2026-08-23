/** Behavioral coverage for the interactive `worktrees` shell picker. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join, resolve } from "@std/path";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import type { SelectionRequestOptions } from "../src/lib/terminal_interaction.ts";
import { makeOut, type Out } from "../src/engine/output.ts";
import {
  buildWorktreeShellRows,
  equivalentDirectoryCandidates,
  resolveEquivalentDirectory,
  runWorktrees,
  type WorktreesRuntime,
} from "../src/engine/worktree/shell_picker.ts";
import { userShell } from "../src/engine/user_shell.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgentPty,
  scaffoldEngine,
  writeExecutable,
} from "./engine_helpers.ts";

const NOW = Date.parse("2026-08-23T12:00:00Z");

interface Transcript {
  readonly out: Out;
  readonly stdout: string[];
  readonly stderr: string[];
}

/** Capture terminal narration without manufacturing a TTY. */
function transcript(): Transcript {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const terminal = makeOut(false).terminal;
  return {
    stdout,
    stderr,
    out: {
      color: terminal.color,
      terminal,
      info: (message) => stdout.push(`info:${message}`),
      ok: (message) => stdout.push(`ok:${message}`),
      warn: (message) => stderr.push(`warn:${message}`),
      error: (message) => stderr.push(`error:${message}`),
      errorBlock: (message) => stderr.push(`error:${message}`),
      heading: (message) => stdout.push(`heading:${message}`),
      group: () => stdout.push(""),
      raw: (message) => stdout.push(message),
    },
  };
}

/** Build one ordinary fleet row. */
function fleetEntry(
  path: string,
  branch: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return {
    path,
    branch,
    is_main: false,
    is_current: false,
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_activity: "2026-08-23T11:00:00Z",
    ...patch,
  };
}

/** Build the fleet-led status payload the picker consumes. */
function statusData(fleet: StatusFleetEntry[]): StatusData {
  return {
    location: "main",
    root: "/main",
    worktree: null,
    git: null,
    standards: [],
    fleet,
    unlanded_branches: ["agent/orphaned"],
    contained_refs: [{
      branch: "agent/stage-a",
      contained_in: "agent/stage-b",
    }],
  };
}

/** Deterministic runtime with overrideable seams. */
function scriptedRuntime(
  output: Transcript,
  patch: Partial<WorktreesRuntime> = {},
): WorktreesRuntime {
  const root = resolve("/project");
  const main = resolve("/main");
  const target = resolve("/worktrees/other");
  const data = statusData([
    fleetEntry(main, "main", { is_main: true }),
    fleetEntry(root, "agent/current"),
    fleetEntry(target, "agent/other", {
      id: "other-a1b2c3",
      clean: false,
      changed_files: 2,
      ahead: 3,
    }),
  ]);
  return {
    canInteract: () => true,
    findRoot: () => root,
    mainRepoPath: () => main,
    status: () => ({ ok: true, data }),
    canonicalPath: (path) => resolve(path),
    cwd: () => join(root, "src", "engine"),
    isDirectory: () => true,
    makeOut: () => output.out,
    error: (message) => output.stderr.push(`console:${message}`),
    select: () => target,
    shell: () => "/bin/zsh",
    launchShell: () => 0,
    now: () => NOW,
    ...patch,
  };
}

Deno.test("user shell resolution is shared, trimmed, and has one fallback", () => {
  assertEquals(userShell({ get: () => " /bin/zsh " }), "/bin/zsh");
  assertEquals(userShell({ get: () => "" }), "/bin/sh");
  assertEquals(userShell({ get: () => undefined }), "/bin/sh");
});

Deno.test("cwd-equivalent candidates stay inside the selected worktree", () => {
  const base = resolve("picker-fixture");
  const source = join(base, "source");
  const target = join(base, "target");
  assertEquals(
    equivalentDirectoryCandidates(
      source,
      join(source, "src", "engine"),
      target,
    ),
    {
      relativeDirectory: join("src", "engine"),
      candidates: [
        join(target, "src", "engine"),
        join(target, "src"),
        target,
      ],
    },
  );
  assertThrows(
    () => equivalentDirectoryCandidates(source, base, target),
    TypeError,
    "outside project root",
  );
});

Deno.test("cwd-equivalent resolution chooses the nearest existing ancestor", async () => {
  const base = resolve("picker-fixture");
  const source = join(base, "source");
  const target = join(base, "target");
  const existing = new Set([join(target, "src"), target]);
  assertEquals(
    await resolveEquivalentDirectory(
      source,
      join(source, "src", "engine"),
      target,
      (path) => existing.has(path),
    ),
    {
      path: join(target, "src"),
      relativeDirectory: join("src", "engine"),
      exact: false,
    },
  );
});

Deno.test("worktree picker rows derive branch, Git, Proof, and activity facts from status", () => {
  const current = resolve("/project");
  const rows = buildWorktreeShellRows(
    [
      fleetEntry(resolve("/main"), "main", { is_main: true }),
      fleetEntry(current, "agent/current"),
      fleetEntry(resolve("/worktrees/review"), "agent/review", {
        clean: false,
        changed_files: 2,
        ahead: 3,
        proof_honored: true,
      }),
    ],
    current,
    NOW,
  );
  assertEquals(rows[0]?.current, true);
  assertEquals(rows[1]?.name, "Main checkout");
  assertStringIncludes(rows[2]?.description ?? "", "agent/review");
  assertStringIncludes(rows[2]?.description ?? "", "2 files changed");
  assertStringIncludes(rows[2]?.description ?? "", "3 ahead");
});

Deno.test("worktrees surveys from main, shows every state, and launches at the equivalent cwd", async () => {
  const output = transcript();
  let surveyed = "";
  let selection: SelectionRequestOptions<string> | undefined;
  let launched: { shell: string; cwd: string } | undefined;
  const target = resolve("/worktrees/other");
  const code = await runWorktrees(
    {},
    scriptedRuntime(output, {
      status: (path) => {
        surveyed = path;
        return scriptedRuntime(output).status(path);
      },
      select: (options) => {
        selection = options;
        return target;
      },
      launchShell: (shell, cwd) => {
        launched = { shell, cwd };
        return 0;
      },
    }),
  );

  assertEquals(code, 0);
  assertEquals(surveyed, resolve("/main"));
  assertEquals(launched, {
    shell: "/bin/zsh",
    cwd: join(target, "src", "engine"),
  });
  const options = JSON.stringify(selection?.options);
  for (
    const expected of [
      "Current checkout",
      "Worktrees",
      "Branches without worktrees",
      "Reclaimed stage branches",
      "agent/orphaned",
      "agent/stage-a",
      "2 files changed",
    ]
  ) {
    assertStringIncludes(options, expected);
  }
  const currentOption = selection?.options.find((entry) =>
    entry.id === `worktree:${resolve("/project")}`
  );
  assert(currentOption !== undefined && currentOption.kind !== "group-heading");
  assertEquals(currentOption.disabled, true);
  const targetOption = selection?.options.find((entry) =>
    entry.id === `worktree:${target}`
  );
  assert(targetOption !== undefined && targetOption.kind !== "group-heading");
  assertEquals(targetOption.disabled, false);
  assertTerminalTextIncludes(
    output.stdout.join("\n"),
    "Exit the shell to return",
  );
  assert(!output.stderr.join("\n").includes("warn:"));
});

Deno.test("worktrees reports a missing equivalent directory before opening its nearest ancestor", async () => {
  const output = transcript();
  const target = resolve("/worktrees/other");
  let launchedCwd = "";
  const existing = new Set([target, join(target, "src")]);
  const code = await runWorktrees(
    {},
    scriptedRuntime(output, {
      isDirectory: (path) => existing.has(path),
      select: () => target,
      launchShell: (_shell, cwd) => {
        launchedCwd = cwd;
        return 0;
      },
    }),
  );

  assertEquals(code, 0);
  assertEquals(launchedCwd, join(target, "src"));
  assertTerminalTextIncludes(
    output.stderr.join("\n"),
    "src/engine is unavailable on agent/other. Opening src.",
  );
});

Deno.test({
  name:
    "discern worktrees opens a real child shell at the cwd-equivalent directory",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      const nested = join(dir, "src", "engine");
      await Deno.mkdir(nested, { recursive: true });
      await Deno.writeTextFile(join(nested, "marker.ts"), "export {};\n");
      await gitInit(dir);

      const worktreeParent = await Deno.makeTempDir({
        prefix: "discern-worktrees-picker-",
      });
      const target = join(worktreeParent, "other");
      const observed = join(worktreeParent, "observed-cwd.txt");
      const shell = join(dir, "record-worktree-cwd");
      await writeExecutable(
        shell,
        [
          "#!/bin/sh",
          'pwd > "$WORKTREE_PICKER_TEST_CWD"',
          "exit 0",
          "",
        ].join("\n"),
      );
      try {
        await git(dir, "worktree", "add", "-q", "-b", "agent/other", target);
        const result = await runAgentPty(nested, ["worktrees"], {
          env: {
            SHELL: shell,
            WORKTREE_PICKER_TEST_CWD: observed,
          },
          input: "\r",
          timeoutMs: 10_000,
        });
        assertEquals(result.code, 0, result.output);
        assertTerminalTextIncludes(
          result.output,
          "Choose a worktree to open at src/engine",
        );
        assertTerminalTextIncludes(result.output, "agent/other");
        assertEquals(
          (await Deno.readTextFile(observed)).trim(),
          join(await Deno.realPath(target), "src", "engine"),
        );
      } finally {
        await git(dir, "worktree", "remove", "--force", target).catch(() => {});
        await Deno.remove(worktreeParent, { recursive: true }).catch(() => {});
      }
    });
  },
});
