/**
 * Distribution-vocabulary guards — the net that keeps engine-developer commands
 * out of anything an end user sees.
 *
 * `icculus` is both a product and a self-hosting repo, so two command
 * vocabularies coexist: the user's (`icculus …`) and the kit's own Deno-task
 * aliases (`deno task <task>`). The latter must never reach a user — not in
 * shipped `templates/` (every project receives it verbatim), and not in any
 * user-facing output the binary prints. These tests fail the gate if the
 * vocabulary leaks, so a future command can't quietly reintroduce the regression.
 *
 * Since the managed-file machinery (and its `selfsync`/`selfcheck` aliases) was
 * removed, those alias names should no longer appear anywhere under `src/`.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");

/** The retired Deno-task alias names that should no longer exist anywhere. */
const RETIRED_TOKENS = ["selfsync", "selfcheck"];

/** Every file under `root`, as `[repo-relative path, contents]`. */
async function textFiles(root: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const entry of walk(root, { includeDirs: false })) {
    let text: string;
    try {
      text = await Deno.readTextFile(entry.path);
    } catch {
      continue; // non-text / unreadable → nothing to leak
    }
    out.push([relative(REPO_ROOT, entry.path), text]);
  }
  return out;
}

Deno.test("the retired self-host aliases appear nowhere under src/", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(SRC)) {
    for (const token of RETIRED_TOKENS) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    `retired self-host vocabulary still present under src/:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("shipped templates/ never name engine-developer commands", async () => {
  const banned = ["deno task", ...RETIRED_TOKENS];
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(TEMPLATES)) {
    for (const token of banned) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    `engine-developer vocabulary leaked into the shipped surface:\n  ${
      offenders.join("\n  ")
    }`,
  );
});
