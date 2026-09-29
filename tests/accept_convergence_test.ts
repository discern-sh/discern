/** Convergence reports unavailable checkout evidence without undoing a landing. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { convergeMainCheckout } from "../src/engine/worktree/accept_convergence.ts";
import { freshAcceptExecutionProgress } from "../src/engine/worktree/accept.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { Logger } from "../src/lib/log.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("landed checkout convergence retains failure evidence when the checkout is unavailable", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "effort");
    const config = parseConfigOrThrow('[project]\nslug = "convergence"\n');
    const progress = freshAcceptExecutionProgress();
    progress.landing.trunk_landed = true;
    await convergeMainCheckout(
      {
        ctx: {
          root: path,
          cwd: path,
          config,
          log: new Logger({ json: true, noColor: true }),
        },
        path,
        branch: "agent/effort",
        id: "effort",
        settings: { slug: "convergence", branchPrefix: "agent/" },
        mainRepo: dir,
        trunk: "main",
        explicit: false,
      },
      {
        worktreeBranch: "agent/effort",
        worktreePath: path,
        mainRepo: dir,
        trunk: "main",
        proofNotes: "local",
        repositoryEnsureSteps: [],
        smokeSteps: [],
        hasResources: false,
        ignoredFileChanges: {
          status: "unchanged",
          changed_roots: [],
          changed_total: 0,
          truncated: false,
        },
      },
      progress,
      undefined,
    );
    assertEquals(progress.landing.trunk_landed, true);
    assertEquals(progress.steps.map((step) => [step.step.kind, step.outcome]), [
      ["refresh", "failed"],
      ["checkout-clean-check", "failed"],
    ]);
    assertEquals(
      progress.steps[1]?.advisory?.kind,
      "checkout-clean-observation-unavailable",
    );
    assert(progress.diagnostics.length > 0);
    assertStringIncludes(
      progress.convergenceHints.join("\n"),
      "discern refresh",
    );
  });
});
