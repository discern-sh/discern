/**
 * Canon Editor's suites must remain hermetic under the repository's
 * parallel test runner. Re-run them with write authority limited to a throwaway
 * directory: any present or future direct write into the checkout becomes a
 * permission failure, regardless of which path or helper introduced it.
 */

import { assert } from "@std/assert";
import { REPO_ROOT } from "../scripts/canon_editor/root.ts";
import { withTempDir } from "./helpers.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

Deno.test("Canon Editor suites cannot write into the checkout", async () => {
  const suites = await structuralGuardScope({
    guard: "tests/canon_editor_isolation_test.ts#checkout-write-isolation",
    universe: "authored-ts",
    narrow: {
      reason:
        "Every Canon Editor suite runs in the write sandbox; only this recursive driver is excluded.",
      include: (path) =>
        /^tests\/canon_editor_.*_test\.ts$/.test(path) &&
        path !== "tests/canon_editor_isolation_test.ts",
    },
  });
  assert(suites.length > 0);
  await withTempDir(async (sandbox) => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--allow-read",
        `--allow-write=${sandbox}`,
        "--allow-env",
        "--allow-run",
        "--no-check",
        ...suites,
      ],
      cwd: REPO_ROOT,
      env: { TMPDIR: sandbox, NO_COLOR: "1", CI: "1", TERM: "dumb" },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    const detail = new TextDecoder().decode(output.stdout) +
      new TextDecoder().decode(output.stderr);
    assert(
      output.success,
      `an editor suite escaped its write sandbox or failed:\n${detail}`,
    );
  }, { prefix: "discern-canon-editor-isolation-" });
});
