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

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  commandExists,
  describeSpawnError,
  leadingCommandWord,
  runGit,
  runShell,
  SPAWN_FAILED,
} from "../src/shared/subprocess.ts";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";

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
  assertStringIncludes(result.stderr, "No such cwd");
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

Deno.test("runGit enforces an explicit caller-owned timeout", async () => {
  await withTempDir(async (dir) => {
    const fakeGit = join(dir, "slow-git");
    await Deno.writeTextFile(fakeGit, "#!/bin/sh\nexec sleep 5\n");
    await Deno.chmod(fakeGit, 0o755);
    const previous = Deno.env.get("GIT_BIN");
    Deno.env.set("GIT_BIN", fakeGit);
    try {
      const started = performance.now();
      const result = await runGit(["status"], { cwd: dir, timeoutMs: 50 });
      assertEquals(result.success, false);
      assertEquals(result.code, 124);
      assertEquals(result.timedOut, true);
      assert(
        performance.now() - started < 2_000,
        "runGit waited for the child after its explicit deadline",
      );
    } finally {
      if (previous === undefined) {
        Deno.env.delete("GIT_BIN");
      } else {
        Deno.env.set("GIT_BIN", previous);
      }
    }
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
