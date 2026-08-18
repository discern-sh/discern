/**
 * Canon Editor's mutation suite must remain hermetic under the repository's
 * parallel test runner. Re-run it with write authority limited to a throwaway
 * directory: any present or future direct write into the checkout becomes a
 * permission failure, regardless of which path or helper introduced it.
 */

import { assert } from "@std/assert";
import { REPO_ROOT } from "../scripts/canon_editor/root.ts";

Deno.test("Canon Editor mutation suite cannot write into the checkout", async () => {
  const sandbox = await Deno.makeTempDir({
    prefix: "discern-canon-editor-isolation-",
  });
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--allow-read",
        `--allow-write=${sandbox}`,
        "--allow-env",
        "--allow-run",
        "--no-check",
        "tests/canon_editor_patch_test.ts",
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
      `the mutation suite escaped its write sandbox or failed:\n${detail}`,
    );
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});
