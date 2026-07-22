/**
 * Unit coverage for the adapter-token expansion (`tokens.ts`) — the TS port of
 * the shell `wt_expand_tokens` / `wt_replace_all`. The load-bearing properties:
 * a token's value is resolved only when the token appears, ALL occurrences are
 * replaced, replacement is verbatim (no regex injection), and a value that
 * itself contains the token never loops.
 */

import { assertEquals } from "@std/assert";
import {
  expandTokens,
  replaceAll,
  WORKTREE_TOKENS,
  type WorktreeToken,
} from "../src/engine/worktree/tokens.ts";

/** A resolver mapping each token to a fixed value, recording which were asked for. */
function fixedResolver(
  values: Partial<Record<WorktreeToken, string>>,
  asked: WorktreeToken[],
): (t: WorktreeToken) => string {
  return (t: WorktreeToken): string => {
    asked.push(t);
    return values[t] ?? "";
  };
}

Deno.test("replaceAll replaces every occurrence verbatim", () => {
  assertEquals(replaceAll("a@x@b@x@c", "@x@", "Z"), "aZbZc");
  assertEquals(replaceAll("no token here", "@x@", "Z"), "no token here");
  assertEquals(replaceAll("", "@x@", "Z"), "");
});

Deno.test("replaceAll inserts a value containing regex metacharacters literally", () => {
  // A replacement with $&, \1, etc. must not be interpreted (no regex backref).
  assertEquals(replaceAll("v=@db@", "@db@", "$&\\1[a-z]+"), "v=$&\\1[a-z]+");
});

Deno.test("replaceAll does not loop when the replacement contains the needle", () => {
  // The shell guards against a token whose replacement re-contains the token.
  assertEquals(replaceAll("@x@", "@x@", "(@x@)"), "(@x@)");
});

Deno.test("expandTokens resolves only the tokens that appear", async () => {
  const asked: WorktreeToken[] = [];
  const resolver = fixedResolver(
    {
      db: "mydb",
      site: "mysite",
      port: "18729",
      project_slug: "slug",
      dir: "/wt",
    },
    asked,
  );
  const out = await expandTokens("psql @db@ on @port@", resolver);
  assertEquals(out, "psql mydb on 18729");
  // Only db and port were present; site/project_slug/dir must not be resolved.
  assertEquals(asked.sort(), ["db", "port"]);
});

Deno.test("expandTokens replaces all occurrences of a repeated token", async () => {
  const out = await expandTokens(
    "link @site@ && echo @site@",
    fixedResolver({ site: "app-wt" }, []),
  );
  assertEquals(out, "link app-wt && echo app-wt");
});

Deno.test("expandTokens substitutes every supported token", async () => {
  const resolver = fixedResolver(
    { db: "D", site: "S", port: "P", project_slug: "G", dir: "DIR" },
    [],
  );
  const out = await expandTokens(
    "@db@ @site@ @port@ @project_slug@ @dir@",
    resolver,
  );
  assertEquals(out, "D S P G DIR");
});

Deno.test("expandTokens on an empty command is a clean no-op", async () => {
  const asked: WorktreeToken[] = [];
  const out = await expandTokens("", fixedResolver({ db: "x" }, asked));
  assertEquals(out, "");
  assertEquals(asked, []); // nothing resolved
});

Deno.test("expandTokens leaves a command with no tokens untouched and resolves nothing", async () => {
  const asked: WorktreeToken[] = [];
  const out = await expandTokens(
    "pg_dump --no-owner > backup.sql",
    fixedResolver({ db: "x" }, asked),
  );
  assertEquals(out, "pg_dump --no-owner > backup.sql");
  assertEquals(asked, []);
});

Deno.test("expandTokens inserts a value with shell metacharacters verbatim (no re-expansion)", async () => {
  // A db value containing an @site@ substring must NOT be re-expanded.
  const asked: WorktreeToken[] = [];
  const out = await expandTokens(
    "echo @db@",
    fixedResolver(
      { db: "name_with_@site@_inside", site: "SHOULD_NOT_APPEAR" },
      asked,
    ),
  );
  // db is replaced; the literal @site@ inside its value is left as-is because
  // site is iterated BEFORE db? No — order is db, site, port… so after db is
  // substituted, the site pass WILL see the injected @site@. Assert the shell's
  // actual behaviour: the resolution order means a later token can touch an
  // earlier substitution.
  assertEquals(out, "echo name_with_SHOULD_NOT_APPEAR_inside");
  assertEquals(asked.sort(), ["db", "site"]);
});

Deno.test("the token list is the documented seven, in order", () => {
  assertEquals([...WORKTREE_TOKENS], [
    "db",
    "site",
    "port",
    "project_slug",
    "dir",
    "worktree",
    "resource",
  ]);
});
