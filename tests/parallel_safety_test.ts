/**
 * Architectural guard: no test file may mutate process-global state.
 *
 * `deno test --parallel` runs test files as worker threads that share ONE OS
 * process (proven: an env var set in one file is observed by another running
 * concurrently, and is inherited by every subprocess runAgent/runCli spawns). So
 * a single Deno chdir or env set/delete anywhere in the suite is a cross-file
 * race that passes serially but fails intermittently under parallel — the exact
 * class of bug the suite was converted away from. A function under test that
 * consults the ambient cwd or env must instead take an injected seam: an explicit
 * `cwd`, or an `env`/`fakeEnv` argument (see tests/helpers.ts `fakeEnv`), so the
 * test supplies the value without touching the process.
 *
 * This test enumerates every tests/*.ts file (so a NEW file auto-enrols, with no
 * hand-maintained list to drift) and fails if one reintroduces such a mutation.
 * Reads (Deno.env.get) are deliberately NOT flagged — they cannot race. If a test
 * genuinely must mutate the process and is parallel-safe regardless, add its
 * basename to ALLOWLIST with a comment justifying why.
 */

import { assert } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";

/** Test files exempt from the rule — each needs a justification. Empty today. */
const ALLOWLIST: ReadonlySet<string> = new Set<string>();

/**
 * The process-global mutations a parallel-safe test must never make. The needle
 * is assembled at runtime so this guard's own source never contains the literal
 * call form it searches for.
 */
const FORBIDDEN = [
  { api: "chdir", state: "working directory" },
  { api: "env.set", state: "environment" },
  { api: "env.delete", state: "environment" },
].map((f) => ({ ...f, needle: `Deno.${f.api}(` }));

Deno.test("no test file mutates process-global cwd or env (parallel-safety guard)", async () => {
  const testsDir = fromFileUrl(new URL(".", import.meta.url));
  const self = fromFileUrl(import.meta.url);
  const offenders: string[] = [];

  // maxDepth 1 keeps this to the test files themselves, never the fixtures tree.
  for await (
    const entry of walk(testsDir, {
      maxDepth: 1,
      includeDirs: false,
      exts: [".ts"],
    })
  ) {
    if (entry.path === self) continue; // the guard names the needles; don't scan it
    if (ALLOWLIST.has(entry.name)) continue;
    const source = await Deno.readTextFile(entry.path);
    for (const { needle, state } of FORBIDDEN) {
      if (source.includes(needle)) {
        offenders.push(`${entry.name}: ${needle} mutates the process ${state}`);
      }
    }
  }

  assert(
    offenders.length === 0,
    "a test mutates process-global state, which races across files under " +
      "`deno test --parallel`. Inject the value instead — an explicit cwd, or an " +
      "env/fakeEnv argument (see tests/helpers.ts):\n  " +
      offenders.join("\n  "),
  );
});
