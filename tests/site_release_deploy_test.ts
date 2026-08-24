/** Production publishing stays coupled to the installable release tag. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);
const RELEASE = new URL("release.yml", WORKFLOWS);

Deno.test("the production site deploy is a release-tag-only path", async () => {
  const workflow = await Deno.readTextFile(RELEASE);
  assertStringIncludes(workflow, 'tags:\n      - "v*"');
  assert(!workflow.includes("branches:"), "release.yml has no branch trigger");
  assertStringIncludes(workflow, "deploy-site:");
  assertStringIncludes(workflow, "needs: [plan, release]");
  assertStringIncludes(workflow, "ref: ${{ github.ref }}");
  assertStringIncludes(workflow, "deno task site:build");
  assertStringIncludes(workflow, "deno deploy --org");
  assertStringIncludes(workflow, "--prod");
  assertStringIncludes(
    workflow,
    "DENO_DEPLOY_TOKEN: ${{ secrets.DENO_DEPLOY_TOKEN }}",
  );
  assertStringIncludes(workflow, "${{ vars.DENO_DEPLOY_ORG }}");
  assertStringIncludes(workflow, "${{ vars.DENO_DEPLOY_APP }}");
});

Deno.test("no second workflow can deploy main or bypass the tag release", async () => {
  const deployers: string[] = [];
  const prefix = ".github/workflows/";
  for (
    const rel of await structuralGuardScope({
      guard: "tests/site_release_deploy_test.ts#site-deploy-workflows",
      universe: "authored-text",
      narrow: {
        reason:
          "The production deployment singleton is enforced across tracked YAML workflows beneath .github/workflows.",
        include: (path) => path.startsWith(prefix) && /\.ya?ml$/.test(path),
      },
    })
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/\bdeno deploy\b|\bdeployctl\b/.test(text)) {
      deployers.push(rel.slice(prefix.length));
    }
  }
  assertEquals(deployers, ["release.yml"]);
});
