/** Both publication paths preserve one verified production publisher. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { parse as parseYaml } from "@std/yaml";
import { decodeWith } from "./decode_cli_result.ts";
import { PUBLICATION_INPUT } from "../site/releases/catalogue.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);
const RELEASE = new URL("release.yml", WORKFLOWS);

Deno.test("release and manual site publication share the verified publisher", async () => {
  const release = await Deno.readTextFile(RELEASE);
  const manual = await Deno.readTextFile(new URL("site.yml", WORKFLOWS));
  const workflow = await Deno.readTextFile(
    new URL("site-publish.yml", WORKFLOWS),
  );
  assertStringIncludes(release, 'tags:\n      - "v*"');
  assert(!release.includes("branches:"));
  assertStringIncludes(release, "needs: [plan, release]");
  for (const caller of [release, manual]) {
    assertStringIncludes(caller, "uses: ./.github/workflows/site-publish.yml");
    assertStringIncludes(caller, "deployments: read");
  }
  assertStringIncludes(manual, "workflow_dispatch:");
  assertStringIncludes(manual, "if: github.ref == 'refs/heads/main'");
  assert(!manual.includes("push:"));
  assertStringIncludes(workflow, "workflow_call:");
  assertStringIncludes(workflow, "environment: production");
  assertStringIncludes(workflow, "group: site-production");
  assertStringIncludes(workflow, "ref: ${{ github.sha }}");
  const steps = [
    'scripts/site_deployment_order.ts "$SOURCE_SHA"',
    'scripts/site_deployment.ts "$SOURCE_SHA"',
    "run: deno task site:smoke",
    "Deploy the verified snapshot",
  ];
  let position = -1;
  for (const step of steps) {
    const next = workflow.indexOf(step);
    assert(next > position, `${step} must follow its preconditions`);
    position = next;
  }
  const pinned = /deno run -A jsr:@deno\/deploy@(\d+\.\d+\.\d+) --prod/u.exec(
    workflow,
  )?.[1];
  assert(pinned !== undefined);
  const lock = await Deno.readTextFile(
    new URL("../deno.lock", import.meta.url),
  );
  assertStringIncludes(lock, `"jsr:@deno/deploy@${pinned}"`);
  assertStringIncludes(
    workflow,
    "DENO_DEPLOY_TOKEN: ${{ secrets.DENO_DEPLOY_TOKEN }}",
  );
  assert(!workflow.includes("vars.DENO_DEPLOY_"));
  assertStringIncludes(
    workflow,
    "${{ runner.temp }}/site-deployment/site-deployment.json",
  );
  assertStringIncludes(workflow, "${{ runner.temp }}/releases.json");
});

/** These workflows own the manual deployment path; release gating belongs upstream. */
function assertIndependentSitePath(source: string): void {
  const workflow = z.object({
    permissions: z.object({ actions: z.never().optional() }).passthrough(),
    jobs: z.record(
      z.string(),
      z.object({
        needs: z.never().optional(),
      }).passthrough(),
    ),
  }).parse(parseYaml(source));
  assertEquals(Object.keys(workflow.jobs).length, 1);
  assert(!source.includes("release_gate.ts"));
  assert(!source.includes("gate-evidence-"));
}

Deno.test("manual website publication has no hosted gate prerequisite", async () => {
  for (const name of ["site.yml", "site-publish.yml"]) {
    const source = await Deno.readTextFile(new URL(name, WORKFLOWS));
    assertIndependentSitePath(source);
    // A new prerequisite job must not turn the manual button into a gate queue.
    assertThrows(() =>
      assertIndependentSitePath(
        source +
          "\n  readiness:\n    uses: ./.github/workflows/validation.yml\n",
      )
    );
    assertThrows(() =>
      assertIndependentSitePath(
        source.replace(
          /( {2}(?:publish|deploy):\n)/u,
          "$1    needs: readiness\n",
        ),
      )
    );
  }
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

Deno.test("no second workflow can bypass the shared production publisher", async () => {
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
  assertEquals(deployers, ["site-publish.yml"]);
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
