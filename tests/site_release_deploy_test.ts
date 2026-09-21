/** Production publishing stays coupled to the installable release tag. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { PUBLICATION_INPUT } from "../site/releases/catalogue.ts";
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
  const pinned = /deno run -A jsr:@deno\/deploy@(\d+\.\d+\.\d+) --prod/u
    .exec(workflow)?.[1];
  assert(
    pinned !== undefined,
    "the deploy tool runs directly with a pinned version",
  );
  const lock = await Deno.readTextFile(
    new URL("../deno.lock", import.meta.url),
  );
  assertStringIncludes(
    lock,
    `"jsr:@deno/deploy@${pinned}"`,
    "the pinned deploy tool is locked, so the deploy job resolves it without writing the lockfile",
  );
  assertStringIncludes(workflow, "--prod");
  assertStringIncludes(
    workflow,
    "DENO_DEPLOY_TOKEN: ${{ secrets.DENO_DEPLOY_TOKEN }}",
  );
  assert(
    !workflow.includes("vars.DENO_DEPLOY_"),
    "the deploy target lives in deno.json, not in environment variables",
  );
});

const DeployConfigSchema = z.object({
  deploy: z.object({
    org: z.string().min(1),
    app: z.string().min(1),
    build: z.string(),
    runtime: z.object({ type: z.string(), entrypoint: z.string() })
      .passthrough(),
  }).passthrough(),
}).passthrough();

Deno.test("deno.json names the production deploy target the deploy tool reads", async () => {
  const { deploy } = decodeWith(
    DeployConfigSchema,
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );
  assertEquals(deploy.build, "deno task site:build");
  assertEquals(deploy.runtime.type, "dynamic");
  assertEquals(deploy.runtime.entrypoint, "site/main.ts");
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
    if (/\bdeno deploy\b|\bdeployctl\b|jsr:@deno\/deploy/.test(text)) {
      deployers.push(rel.slice(prefix.length));
    }
  }
  assertEquals(deployers, ["release.yml"]);
});

Deno.test("ephemeral publication input stays ignored and untracked", async () => {
  const path = decodeURIComponent(PUBLICATION_INPUT.pathname).slice(
    REPO_ROOT.length + 1,
  );
  const ignored = await new Deno.Command("git", {
    args: ["check-ignore", "--quiet", "--no-index", path],
    cwd: REPO_ROOT,
  }).output();
  assert(ignored.success, `${path} must remain a generated deployment input`);
  const tracked = await new Deno.Command("git", {
    args: ["ls-files", "--error-unmatch", path],
    cwd: REPO_ROOT,
    stdout: "null",
    stderr: "null",
  }).output();
  assert(!tracked.success, `${path} must not enter version control`);
});
