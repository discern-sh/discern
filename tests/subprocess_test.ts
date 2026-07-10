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

import { assertEquals } from "@std/assert";
import { commandExists, leadingCommandWord } from "../src/shared/subprocess.ts";

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
