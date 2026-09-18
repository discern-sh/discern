/**
 * Unit tests for the shared subprocess helpers (`src/shared/subprocess.ts`) —
 * chiefly {@link leadingCommandWord}, the extractor behind doctor's
 * "does this command resolve?" probes.
 *
 * The table is the detector for one defect class: deriving a probe word from an
 * operator command string by naive whitespace-splitting, which turns
 * `CI=1 npm test` into a probe for `CI=1` and `"./my tool" run` into a probe
 * for `"./my` — false "command not found" verdicts for commands the gate runs
 * fine through `sh -c`. The contract under test: the extractor returns the
 * word the shell would actually execute, or `undefined` when that word is not
 * statically knowable — NEVER a word `sh` would not have run.
 */

import { waitForPendingCondition } from "./waiting.ts";
import { ManualScheduler } from "./manual_scheduler.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  commandExists,
  describeSpawnError,
  DISCERN_FORBIDDEN_GIT_TRANSPORT_SUBCOMMANDS,
  GIT_ISOLATED_READ_BOUNDARY_ERROR,
  GIT_REPOSITORY_LOCATION_ENVIRONMENT,
  GIT_TRANSPORT_BOUNDARY_ERROR,
  gitChildEnvironment,
  gitChildEnvironmentPlan,
  ISOLATED_GIT_READ_SUBCOMMANDS,
  leadingCommandWord,
  runGit,
  runShell,
  SPAWN_FAILED,
} from "../src/shared/subprocess.ts";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

/** command → the probeable leading word, or undefined to skip the probe. */
const CASES: [string, string | undefined][] = [
  // Plain leading words.
  ["deno test -A", "deno"],
  ["cargo test --workspace --all-features", "cargo"],
  ["./tool run", "./tool"],
  // Only the leading command is probed; later words are out of scope.
  ["echo hi && definitely-missing", "echo"],
  ["echo hi | cat", "echo"],
  // POSIX env-assignment prefixes belong to the shell, not the command word.
  ["CI=1 deno test -A", "deno"],
  ["CI=1 RUST_BACKTRACE=1 cargo test", "cargo"],
  ['NODE_ENV="a b" npm test', "npm"],
  ["FOO='x y' ./tool", "./tool"],
  // An assignment-only command is valid shell with nothing to probe.
  ["FOO=bar", undefined],
  // Quotes resolve to one word (a path with spaces probes as one argument).
  ['"./my tool" run', "./my tool"],
  ["'./my tool' run", "./my tool"],
  ['"quoted"unquoted arg', "quotedunquoted"],
  // A quoted name is NOT an assignment — the shell would exec `FOO=bar`.
  ['"FOO"=bar cmd', "FOO=bar"],
  // Dynamic or compound syntax: the word is unknowable without executing the
  // shell, so the probe is skipped — never failed.
  ["$TOOL run", undefined],
  ["${TOOL} run", undefined],
  ['"$TOOL" run', undefined],
  ["FOO=$(date) cmd", undefined],
  ["`which x` run", undefined],
  ["(true)", undefined],
  ["{ true; }", undefined],
  ["! grep -q x src", undefined],
  ["~/bin/tool run", undefined],
  ["foo|bar", undefined],
  ["foo;bar", undefined],
  [">out cmd", undefined],
  ["\\escaped cmd", undefined],
  ["# just a comment", undefined],
  ['"unterminated', undefined],
  ["'unterminated", undefined],
  // The empty / no-op conventions.
  ["", undefined],
  ["   ", undefined],
  [":", undefined],
  [": && true", undefined],
];

Deno.test("leadingCommandWord: the probe word is the one sh would execute, or undefined", () => {
  for (const [command, expected] of CASES) {
    assertEquals(
      leadingCommandWord(command),
      expected,
      `leadingCommandWord(${JSON.stringify(command)})`,
    );
  }
});

Deno.test("leadingCommandWord feeds commandExists: an env-prefixed command probes its real binary", async () => {
  // End-to-end over the real probe: the extracted word for an env-prefixed
  // command resolves (it is a real shell builtin/binary), while the naive
  // first word would not.
  const word = leadingCommandWord("CI=1 true --flag");
  assertEquals(word, "true");
  assertEquals(await commandExists(word ?? ""), true);
  assertEquals(await commandExists("CI=1"), false);
});

// ── spawn-failure reporting: the REAL cause, never a fabricated one (B45) ──────
//
// The class: a catch that maps EVERY spawn failure to one assumed story (the old
// `runGit` returned stderr "git is not on PATH" for any throw; `runShell` swallowed
// the error to nothing). Deno's spawn errors are distinct and informative — a
// missing cwd, a permissions error, and an absent executable each carry their own
// message — so a spawn helper must surface the true cause, only framing it as a
// PATH/install problem when the executable is GENUINELY missing.

/** describeSpawnError: the framing/hint decision, table-driven over error shapes. */
Deno.test("describeSpawnError names the real cause and only hints PATH for a missing executable", () => {
  const notFoundBinary = new Deno.errors.NotFound(
    "Failed to spawn 'git': entity not found",
  );
  const missingCwd = new Deno.errors.NotFound(
    "Failed to spawn '/usr/bin/git': No such cwd '/no/such/dir'",
  );
  const permission = new Deno.errors.PermissionDenied(
    "Failed to spawn 'git': permission denied",
  );

  // An absent executable — and ONLY this — gets the actionable install/PATH hint.
  const missing = describeSpawnError(notFoundBinary, "git");
  assertStringIncludes(missing, "entity not found");
  assertStringIncludes(missing, "is git installed and on your PATH?");

  // A missing cwd keeps its true message and is NOT reframed as a PATH problem
  // (the regression B45 fixed: a deleted-worktree failure sent hunting PATH).
  const cwd = describeSpawnError(missingCwd, "git");
  assertStringIncludes(cwd, "No such cwd");
  assert(
    !cwd.includes("on your PATH"),
    "a missing cwd must not be reframed as a PATH problem",
  );

  // A permissions failure surfaces verbatim too — no assumed story.
  const perm = describeSpawnError(permission, "git");
  assertStringIncludes(perm, "permission denied");
  assert(!perm.includes("on your PATH"));

  // A throw with no usable message still yields a labelled fallback, never "".
  assertEquals(describeSpawnError(new Error(""), "sh"), "could not spawn sh");
  assertEquals(describeSpawnError("weird", "sh"), "could not spawn sh");

  // The old hard-coded fabrication is gone for a genuine failure.
  assert(!cwd.includes("git is not on PATH"));
});

Deno.test("runGit: a spawn failure reports the real cause, not a fabricated PATH story", async () => {
  // A cwd that does not exist makes Deno.Command throw NotFound at spawn time.
  // The old catch returned stderr "git is not on PATH" here — a lie. The fix
  // surfaces Deno's real "No such cwd" message so the user debugs the true fault.
  const result = await runGit(["status"], { cwd: "/no/such/dir/at/all/xyz" });
  assertEquals(result.success, false);
  assertEquals(result.code, SPAWN_FAILED);
  assertTerminalTextIncludes(result.stderr, "No such cwd");
  assert(
    !result.stderr.includes("git is not on PATH"),
    "runGit must not fabricate a PATH cause for a missing cwd",
  );
});

Deno.test("runGit supplies protocol input on stdin", async () => {
  const first = await runGit(["hash-object", "--stdin"], {
    cwd: Deno.cwd(),
    stdin: "acceptance transaction A\n",
  });
  const second = await runGit(["hash-object", "--stdin"], {
    cwd: Deno.cwd(),
    stdin: "acceptance transaction B\n",
  });
  assertEquals(first.success, true, first.stderr);
  assertEquals(second.success, true, second.stderr);
  assert(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(first.stdout.trim()),
    first.stdout,
  );
  assert(first.stdout !== second.stdout, "runGit dropped or reused stdin");
});

Deno.test("runGit hands stdout to a sink without retaining it or charging the ceiling", async () => {
  await withTempDir(async (root) => {
    const received: number[] = [];
    const result = await runGit(["--version"], {
      cwd: root,
      maxOutputBytes: 4,
      stdoutSink: (chunk) => received.push(...chunk),
    });
    assertEquals(result.success, true, result.stderr);
    assertEquals(result.stdout, "");
    assertEquals(result.stdoutBytes?.length, 0);
    assert(
      new TextDecoder().decode(Uint8Array.from(received)).includes(
        "git version",
      ),
      "the sink received the child's stdout",
    );
    const abort = new AbortController();
    let settled: "resolved" | "rejected" | undefined;
    try {
      await runGit(["--version"], {
        cwd: root,
        signal: abort.signal,
        stdoutSink: () => abort.abort(),
      });
      settled = "resolved";
    } catch {
      settled = "rejected";
    }
    assertEquals(settled, "rejected", "an aborting consumer ends the call");
  });
});

Deno.test("runGit refuses every discern-chosen Git transport spelling", async () => {
  const cases = [
    ...DISCERN_FORBIDDEN_GIT_TRANSPORT_SUBCOMMANDS.map((verb) => [verb]),
    ["remote", "update"],
    ["archive", "--remote=origin", "HEAD"],
  ];
  for (const args of cases) {
    const result = await runGit(args, { cwd: Deno.cwd() });
    assertEquals(result.success, false, args.join(" "));
    assertEquals(result.code, 2, args.join(" "));
    assertEquals(result.stderr, GIT_TRANSPORT_BOUNDARY_ERROR, args.join(" "));
  }
});

Deno.test("runGit cannot be redirected away from cwd by repository-location environment", async () => {
  await withTempDir(async (root) => {
    const requested = join(root, "requested");
    const ambient = join(root, "ambient");
    await Deno.mkdir(requested);
    await Deno.mkdir(ambient);
    const requestedInit = await runGit(["init", "-q"], { cwd: requested });
    const ambientInit = await runGit(["init", "-q"], { cwd: ambient });
    assertEquals(requestedInit.success, true, requestedInit.stderr);
    assertEquals(ambientInit.success, true, ambientInit.stderr);

    const result = await runGit(["rev-parse", "--show-toplevel"], {
      cwd: requested,
      env: {
        GIT_DIR: join(ambient, ".git"),
        GIT_WORK_TREE: ambient,
      },
    });

    assertEquals(result.success, true, result.stderr);
    assertEquals(result.stdout.trim(), await Deno.realPath(requested));
  });
});

Deno.test("the Git child environment removes every repository-location variable and retains other state", () => {
  for (const variable of GIT_REPOSITORY_LOCATION_ENVIRONMENT) {
    const environment = gitChildEnvironment(
      { [variable]: "caller-value", CALLER_CONFIG: "kept" },
      {
        toObject: () => ({
          [variable]: "ambient-value",
          GIT_AUTHOR_NAME: "kept identity",
        }),
      },
    );
    assertEquals(environment[variable], undefined, variable);
    assertEquals(environment.GIT_AUTHOR_NAME, "kept identity", variable);
    assertEquals(environment.CALLER_CONFIG, "kept", variable);
  }
});

Deno.test("only an explicit read-only narrow Git host may clear inherited state", () => {
  const deniedEnumeration = (): Record<string, string> => {
    throw new Deno.errors.NotCapable("full environment denied");
  };
  const narrowHost = {
    toObject: deniedEnumeration,
    get: () => "unreadable ambient state",
  };
  assertThrows(
    () => gitChildEnvironmentPlan({}, "refuse", narrowHost),
    Deno.errors.NotCapable,
    "full environment denied",
  );
  const safe = gitChildEnvironmentPlan(
    { CALLER_CONFIG: "kept", GIT_DIR: "override-blocked" },
    "isolated-read-only",
    narrowHost,
  );
  assertEquals(safe, {
    clearEnv: true,
    env: { CALLER_CONFIG: "kept" },
  });

  for (const variable of GIT_REPOSITORY_LOCATION_ENVIRONMENT) {
    assertEquals(
      gitChildEnvironmentPlan(
        { [variable]: "caller-route" },
        "isolated-read-only",
        narrowHost,
      ).env[variable],
      undefined,
      variable,
    );
  }
});

// A named env grant leaves full enumeration ungranted, as in preview tasks.
// The fake host makes an attempted permission-prompting read fail deterministically.
Deno.test({
  name: "isolated Git fallback never tries ungranted environment enumeration",
  permissions: { env: ["GIT_BIN"] },
  fn(): void {
    let enumerations = 0;
    const host = {
      get: () => undefined,
      toObject: () => {
        enumerations++;
        return { FUTURE_CALLER_IDENTITY: "must remain unread" };
      },
    };
    for (const variable of GIT_REPOSITORY_LOCATION_ENVIRONMENT) {
      const plan = gitChildEnvironmentPlan(
        { [variable]: "must not redirect", CALLER_SETTING: "kept" },
        "isolated-read-only",
        host,
      );
      assertEquals(enumerations, 0, "fallback must precede any full env read");
      assertEquals(plan, { clearEnv: true, env: { CALLER_SETTING: "kept" } });
    }
  },
});

Deno.test("isolated Git hosts admit only the no-hook read registry", async () => {
  await withTempDir(async (dir) => {
    const fakeGit = join(dir, "git");
    await Deno.writeTextFile(fakeGit, "#!/bin/sh\nexit 0\n");
    await Deno.chmod(fakeGit, 0o755);
    for (const subcommand of ISOLATED_GIT_READ_SUBCOMMANDS) {
      const result = await runGit([subcommand], {
        cwd: dir,
        bin: fakeGit,
        environmentPermissionFallback: "isolated-read-only",
      });
      assert(result.success, subcommand);
    }

    const refused = await runGit(["status"], {
      cwd: dir,
      bin: fakeGit,
      environmentPermissionFallback: "isolated-read-only",
    });
    assertEquals(refused.code, 2);
    assertEquals(refused.stderr, GIT_ISOLATED_READ_BOUNDARY_ERROR);
  });
});

Deno.test("both production Git spawners consume the one repository-location sanitizer", async () => {
  const consumers = [
    {
      path: new URL("../src/shared/subprocess.ts", import.meta.url),
      calls: [
        "const environment = gitChildEnvironmentPlan(",
        "clearEnv: environment.clearEnv",
        "...environment.env",
      ],
    },
    {
      path: new URL("../src/shared/discern_commit.ts", import.meta.url),
      calls: [
        "clearEnv: true",
        "...gitChildEnvironment({ GIT_REFLOG_ACTION: reflogAction })",
      ],
    },
  ] as const;
  for (const consumer of consumers) {
    const source = await Deno.readTextFile(consumer.path);
    for (const call of consumer.calls) assertStringIncludes(source, call);
  }
});

Deno.test("runGit enforces an explicit caller-owned timeout", async () => {
  await withTempDir(async (dir) => {
    const fakeGit = join(dir, "slow-git");
    await Deno.writeTextFile(fakeGit, "#!/bin/sh\nexec tail -f /dev/null\n");
    await Deno.chmod(fakeGit, 0o755);
    const scheduler = new ManualScheduler();
    const pending = runGit(["status"], {
      cwd: dir,
      bin: fakeGit,
      timeoutMs: 50,
      scheduler,
    });
    try {
      await waitForPendingCondition(
        pending,
        () => scheduler.pending.size > 0,
        "Git watchdog scheduling",
      );
      assertEquals(
        [...scheduler.pending.values()].map((timer) => timer.delayMs),
        [50],
      );
      scheduler.fire(50);
      const result = await pending;
      assertEquals(scheduler.pending.size, 0);
      assertEquals(result.success, false);
      assertEquals(result.code, 124);
      assertEquals(result.timedOut, true);
    } finally {
      // Assertion failure still dispatches the owned timeout and reaps its child.
      for (const timer of [...scheduler.pending.values()]) timer.callback();
      await pending;
    }
  });
});

Deno.test("runGit terminates a real producer at its combined output ceiling", async () => {
  await withTempDir(async (dir) => {
    const fakeGit = join(dir, "loud-git");
    await Deno.writeTextFile(
      fakeGit,
      "#!/bin/sh\ni=0\nwhile [ $i -lt 10000 ]; do printf 0123456789abcdef; i=$((i+1)); done\n",
    );
    await Deno.chmod(fakeGit, 0o755);
    const result = await runGit(["status"], {
      cwd: dir,
      bin: fakeGit,
      maxOutputBytes: 257,
      timeoutMs: 2_000,
    });
    assertEquals(result.success, false);
    assertEquals(result.outputLimitExceeded, true);
    assertEquals(result.timedOut, undefined);
    assertEquals(
      (result.stdoutBytes?.length ?? 0) + (result.stderrBytes?.length ?? 0),
      257,
    );
  });
});

Deno.test("runShell: a spawn failure carries the real cause instead of being swallowed", async () => {
  // The old catch discarded the error, returning an EMPTY stderr — a shell spawn
  // failure told the user nothing. A missing cwd throws NotFound; the fix decodes
  // the real message into stderr.
  const result = await runShell("echo hi", { cwd: "/no/such/dir/at/all/xyz" });
  assertEquals(result.success, false);
  assertEquals(result.code, SPAWN_FAILED);
  const stderr = new TextDecoder().decode(result.stderr);
  assert(
    stderr.length > 0,
    "runShell swallowed the spawn error to an empty stderr",
  );
  assertStringIncludes(stderr, "No such cwd");
});
