/** Holds every Wave 1 homepage brief to the shared context boundary. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const CANDIDATE_DIR = join(
  ROOT,
  "project/map/_private/planning/homepage-candidates",
);
const BOUNDARY_LABEL = "Keep the candidate context independent";
const CURRENT_HOMEPAGE_CRITIQUE = /\b(?:current|existing) homepage\b/i;

/** Derive the Wave 1 brief population from the programme table. */
function waveOneBriefPaths(programme: string): string[] {
  return [...programme.matchAll(
    /^\|\s*1[A-Z]\s*\|[^|\n]*\|\s*`([^`]+\.md)`\s*\|/gm,
  )].map((match) => match[1] ?? "");
}

interface CandidateBrief {
  readonly path: string;
  readonly source: string;
}

/** Report every brief that invites comparison with the selected composition. */
function contextBoundaryFailures(briefs: readonly CandidateBrief[]): string[] {
  const failures: string[] = [];
  for (const brief of briefs) {
    if (!brief.source.includes(BOUNDARY_LABEL)) {
      failures.push(
        `${brief.path} must apply the shared ${BOUNDARY_LABEL} stop condition`,
      );
    }
    if (CURRENT_HOMEPAGE_CRITIQUE.test(brief.source)) {
      failures.push(
        `${brief.path} critiques the selected homepage instead of starting independently`,
      );
    }
  }
  return failures;
}

Deno.test("every Wave 1 homepage candidate starts from independent context", async () => {
  const programme = await Deno.readTextFile(join(CANDIDATE_DIR, "README.md"));
  assertStringIncludes(programme, `### ${BOUNDARY_LABEL}`);

  const briefPaths = waveOneBriefPaths(programme);
  assert(briefPaths.length > 0, "the programme must list Wave 1 candidates");
  assertEquals(new Set(briefPaths).size, briefPaths.length);

  const briefs = await Promise.all(briefPaths.map(async (path) => ({
    path,
    source: await Deno.readTextFile(join(CANDIDATE_DIR, path)),
  })));
  assertEquals(contextBoundaryFailures(briefs), []);
});

Deno.test("control: a future Wave 1 programme member enrolls in the context guard", () => {
  const programme =
    "| 1F | Future candidate | `1f-the-future.md` | `homepage-1f` | Thesis |";
  const paths = waveOneBriefPaths(programme);
  assertEquals(paths, ["1f-the-future.md"]);
  assertEquals(
    contextBoundaryFailures([{ path: paths[0] ?? "", source: "" }]),
    [
      `1f-the-future.md must apply the shared ${BOUNDARY_LABEL} stop condition`,
    ],
  );
});
