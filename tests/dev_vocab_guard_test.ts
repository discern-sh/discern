/**
 * Distribution-vocabulary guards — the net that keeps engine-developer commands
 * out of anything an end user sees.
 *
 * `icculus` is both a product and a self-hosting repo, so two command
 * vocabularies coexist: the user's (`icculus …`) and the kit's own Deno-task
 * aliases (`deno task selfsync` / `selfcheck`). The latter must never reach a
 * user — not in shipped `templates/`, and not in `src/` user-facing output.
 *
 * `src/lib/invocation.ts` is the single sanctioned home for those alias strings
 * (`selfCmd` renders them only where they apply). These tests fail the gate if
 * the vocabulary leaks anywhere else, so a future command can't quietly
 * reintroduce the regression — the gate teaches the convention on violation.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");

/** The Deno-task alias names that are meaningful only inside this repo. */
const SELF_HOST_TOKENS = ["selfsync", "selfcheck"];
/** The only `src/` module allowed to name the aliases — it is what renders them. */
const SANCTIONED = join("src", "lib", "invocation.ts");

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

Deno.test("self-host command vocabulary stays out of src/ (except the renderer)", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(SRC)) {
    if (rel === SANCTIONED) continue;
    for (const token of SELF_HOST_TOKENS) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    "self-host vocabulary leaked into user-facing code — render commands " +
      `through selfCmd() in ${SANCTIONED}:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("shipped templates/ never name engine-developer commands", async () => {
  const banned = ["deno task", ...SELF_HOST_TOKENS];
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
