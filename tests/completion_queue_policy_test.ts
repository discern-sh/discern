import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { buildStandardPlan } from "../src/engine/gate/standard_plan.ts";
import { buildStandardLimitProposalPlan } from "../src/engine/gate/standard_proposal_plan.ts";
import {
  evaluatePredecessorPolicy,
  predecessorPolicyIdentity,
  renewCandidateProposal,
} from "../src/engine/landing_queue/policy.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  COMPLETION_DIGEST,
  completionFixtures,
} from "./completion_fixtures.ts";

Deno.test("queue A04: each immutable expected predecessor protects its tighter floor or ceiling", async () => {
  for (const direction of ["up", "down"] as const) {
    await withTempDir(async (root) => {
      const config = (limit: number): string =>
        `[project]\nslug = "queue-policy"\n[standards.quality]\nrun = "echo DISCERN_METRIC quality 90"\ndirection = "${direction}"\nlimit = ${limit}\ninputs = ["input"]\n`;
      await Deno.writeTextFile(join(root, "discern.toml"), config(90));
      await Deno.writeTextFile(join(root, "input"), "initial\n");
      await gitInit(root);
      const trunk = await gitOut(root, "rev-parse", "HEAD");
      await git(root, "switch", "-c", "agent/predecessor");
      await Deno.writeTextFile(
        join(root, "discern.toml"),
        config(direction === "up" ? 95 : 85),
      );
      await git(root, "add", "discern.toml");
      await git(root, "commit", "-m", "Tighten quality");
      const predecessor = await gitOut(root, "rev-parse", "HEAD");
      await git(root, "switch", "main");
      const standards = buildStandardPlan(await loadConfig(root)).standards;
      const base = COMPLETION_FAMILIES.candidate.schema.parse(
        completionFixtures().candidate,
      ).data;
      const decisions = { judgments: [], variances: [], proposals: [] };
      const candidate = {
        ...base,
        expected_predecessor: { head: predecessor, candidate_id: null },
        policy: await predecessorPolicyIdentity(root, predecessor),
      };
      assertEquals(
        (await evaluatePredecessorPolicy({
          root,
          candidate,
          standards,
          current: decisions,
          authorized: decisions,
        }))[0]?.kind,
        "validation-failed",
      );
      assertEquals(
        await evaluatePredecessorPolicy({
          root,
          candidate: {
            ...candidate,
            expected_predecessor: { head: trunk, candidate_id: null },
            policy: await predecessorPolicyIdentity(root, trunk),
          },
          standards,
          current: decisions,
          authorized: decisions,
        }),
        [],
      );
      const standard = standards[0];
      assert(standard !== undefined);
      const measurement = direction === "up" ? 80 : 100;
      const planned = buildStandardLimitProposalPlan({
        standard,
        reason: "The source adds required measured input",
        head: trunk,
        definitionFingerprint: COMPLETION_DIGEST,
        trunk: "main",
        trunkCommit: trunk,
        trunkLimit: 90,
        measurement,
        changedPaths: ["input"],
      });
      assert(planned.ok);
      const proposal = {
        ...planned.plan.proposal,
        commit: trunk,
        bound_commit: trunk,
      };
      const context = {
        standard: { ...standard, limit: measurement },
        proposal,
        reason: proposal.reason,
        head: predecessor,
        definitionFingerprint: COMPLETION_DIGEST,
        trunk: "main",
        trunkCommit: predecessor,
        trunkLimit: 90,
        measurement,
        changedPaths: ["input"],
        originIsAncestor: true,
        trunkIsContained: true,
      };
      const renewed = renewCandidateProposal(context);
      assert(!("kind" in renewed), JSON.stringify(renewed));
      assertEquals(renewed.bound_commit, predecessor);
      assertEquals(renewed.commit, proposal.commit);
      for (
        const variation of [
          { measurement: measurement + 1 },
          { trunkLimit: 91 },
          { originIsAncestor: false },
          { reason: "Different owner decision" },
        ]
      ) {
        assertEquals(
          "kind" in renewCandidateProposal({ ...context, ...variation }),
          true,
        );
      }
    });
  }
});
