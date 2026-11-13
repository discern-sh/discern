/** Every transition joins the shared lifecycle so later input can proceed. */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** The module that begins every view transition, and marks each as over. */
const TRANSITIONS_HOME = "site/wall/use_open_card.ts";

Deno.test("one function begins every view transition on the site, and whoever begins one waits for it to end", async () => {
  const sources = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_transition_test.ts#view-transitions",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only the site's own modules run in a visitor's browser, where a view transition can begin.",
        include: (path) => path.startsWith("site/"),
      },
    }),
  );
  assert(sources.length > 0);
  // The pointer light holds still while a transition runs, and it knows one
  // is running only through the function that begins them all. A transition
  // begun anywhere else would run with the light still writing under it.
  assertEquals(
    sources.flatMap(({ path, source }) =>
      [...source.matchAll(/\.startViewTransition\(/g)].map(() => path)
    ),
    [TRANSITIONS_HOME],
    "one line of the site begins a view transition",
  );
  // A transition is over once `transitionEnded` has seen it end. One that
  // was begun and never waited for there would be running for good, and the
  // light would never move again.
  const begun = sources.flatMap(({ path, source }) =>
    [...source.matchAll(/(?<!function )\bbeginTransition\(/g)].map(() => path)
  );
  assert(begun.length >= 2, "the sheet and the lens each begin a transition");
  assertEquals(
    sources.flatMap(({ path, source }) =>
      [...source.matchAll(/\bawait transitionEnded\(/g)].map(() => path)
    ),
    begun,
    "each module waits through `transitionEnded` for every transition it begins",
  );
});
