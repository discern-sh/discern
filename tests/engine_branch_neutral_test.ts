/**
 * Branch-neutrality guard — the integration branch is named by the resolved CONFIG
 * value, never the literal "main".
 *
 * `[repository].trunk` may be `main`, `master`, or anything else (ADR 0048
 * makes "trunk" a ROLE that resolves to it — "not a literal branch named main").
 * So a user-facing string that hard-codes "main" to mean the integration branch
 * reads WRONG in a `master` project. The runtime fix is to interpolate the
 * resolved name (`integrationBranch(...)` / `${mainBranch}`); static help text uses
 * the role term "trunk".
 *
 * Why the existing guards didn't catch this: the parity/forcing-function tests pin
 * closed SETS (verbs, MCP tools, features), and `agent_agnostic_test.ts` scans for
 * a hard-coded agent PATH (`.claude`). None looks at how the integration BRANCH is
 * named in prose — so the hard-coded "main" in `update`'s description and the
 * accept/merge messages sailed through. This is that missing guard, modelled on
 * `agent_agnostic_test.ts`: a comment-stripped scan of the integration-branch
 * MESSAGE surfaces.
 *
 * It is deliberately NOT a blanket "no 'main' anywhere" scan — that would false-flag
 * the legitimate, branch-agnostic LOCATION term "the main checkout/repo/worktree"
 * (the primary checkout, a different concept) and explanatory mentions like
 * "(`main`, `master`, …)". So it allows the location compounds and identifier forms
 * (`mainBranch`, `main_branch`, `inherit-main-env-vars`) and interpolations, and
 * flags only a BARE branch "main". `git.ts` is out of scope: its "main" denotes the
 * main CHECKOUT for env-inheritance, and it carries back-compat header literals.
 */

import { assert } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/**
 * Collect every string-literal body in `src`, skipping comments. A small char
 * scanner rather than a regex because comments can hold quotes and strings can
 * hold `//`, which a regex split cannot separate cleanly (and a comment using
 * "main" as a contextual example is fine — only emitted strings are the concern).
 * Template literals are returned whole; their `${…}` parts are dropped later,
 * since that is how the resolved branch name reaches the string.
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      let body = "";
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          body += (src[i] ?? "") + (src[i + 1] ?? "");
          i += 2;
        } else {
          body += src[i] ?? "";
          i++;
        }
      }
      i++;
      out.push(body);
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Whether `literal` names the integration branch with the bare word "main".
 * Interpolated expressions (`${…}`) are code, not literal text, so they are dropped
 * first (this is how the resolved name reaches the string — `${mainBranch}`); the
 * primary-checkout LOCATION term ("main checkout/repo/repository/worktree") is a
 * different, branch-agnostic concept and is allowed; and an identifier-embedded
 * "main" (preceded/followed by a word or hyphen char — `mainBranch`,
 * `inherit-main-env-vars`) is not the branch literal either.
 */
function namesBranchAsMain(literal: string): boolean {
  const text = literal
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\bmain[ -](checkout|repo|repository|worktree)\b/g, "");
  return /(?<![\w-])main(?![\w-])/.test(text);
}

/** The integration-branch MESSAGE surfaces: the worktree lifecycle + gate engine,
 * plus the CLI command descriptions. `git.ts` is excluded (see the file header). */
async function scopedFiles(): Promise<string[]> {
  const files = [
    join(REPO, "src/main.ts"),
    join(REPO, "src/engine/dispatch.ts"),
  ];
  for (const dir of ["src/engine/worktree", "src/engine/gate"]) {
    for await (const entry of walk(join(REPO, dir), { exts: [".ts"] })) {
      if (entry.name !== "git.ts") {
        files.push(entry.path);
      }
    }
  }
  return files;
}

Deno.test("no user-facing string names the integration branch the literal 'main'", async () => {
  const offenders: string[] = [];
  for (const file of await scopedFiles()) {
    for (const literal of stringLiterals(await Deno.readTextFile(file))) {
      if (namesBranchAsMain(literal)) {
        offenders.push(`${relative(REPO, file)}  ${literal}`);
      }
    }
  }
  assert(
    offenders.length === 0,
    `a user-facing string hard-codes the integration branch as "main" — a project ` +
      `with repository.trunk="master" would read wrong. Interpolate the resolved branch ` +
      `at runtime (integrationBranch(...) / \${mainBranch}), or use the role term ` +
      `"trunk" in static text (ADR 0048). Offenders:\n  ${
        offenders.join("\n  ")
      }`,
  );
});
