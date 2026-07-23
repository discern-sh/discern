/** Production publishing stays coupled to the installable release tag. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";

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
  for await (
    const entry of walk(WORKFLOWS, {
      exts: [".yml", ".yaml"],
      includeDirs: false,
    })
  ) {
    const text = await Deno.readTextFile(entry.path);
    if (/\bdeno deploy\b|\bdeployctl\b/.test(text)) {
      deployers.push(entry.name);
    }
  }
  assertEquals(deployers, ["release.yml"]);
});
