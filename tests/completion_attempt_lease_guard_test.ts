import { assert } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Find every direct production reservation outside its lifecycle authority. */
async function reservationCallSites(): Promise<
  readonly { path: string; source: string; offset: number }[]
> {
  const files = await structuralGuardScope({
    guard:
      "tests/completion_attempt_lease_guard_test.ts#reserved-claim-lifecycle",
    universe: "authored-ts",
    narrow: {
      reason:
        "Completion-attempt reservations are a production engine invariant; tests and unrelated authored modules do not own claims.",
      include: (path) =>
        path.startsWith("src/engine/") &&
        path !== "src/engine/completion/attempt_lifecycle.ts",
    },
  });
  const sites: { path: string; source: string; offset: number }[] = [];
  for (const path of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    for (const match of source.matchAll(/\breserveAttempt\s*\(/gu)) {
      if (match.index !== undefined) {
        sites.push({ path, source, offset: match.index });
      }
    }
  }
  return sites;
}

Deno.test("every completion-attempt reservation enters renewable ownership", async () => {
  const sites = await reservationCallSites();
  assert(sites.length > 0, "the guard must observe the production lifecycle");
  for (const site of sites) {
    assert(
      site.source.slice(site.offset, site.offset + 1_600).includes(
        "withAttemptClaim(",
      ),
      `${site.path}: reserveAttempt must immediately enter withAttemptClaim`,
    );
  }
});
