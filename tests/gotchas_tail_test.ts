/**
 * The gotchas failure-tail matrix at its production seam. These cases exercise
 * the real configured-file resolution, parser, matcher, and fired hints without
 * starting the CLI or running a gate for every document variant.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { gateFailureGotchasTail } from "../src/engine/gate/gotchas.ts";
import type { GateFailureEvidence } from "../src/engine/gate/gotcha_match.ts";
import { jobFailureMessage } from "../src/engine/gate/plan.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import { withTempDir } from "./helpers.ts";
import { PROJECT_GOTCHAS } from "./fixtures/project_gotchas.ts";

/** Build a failed lint result whose exit code selects a gotcha-tail scenario. */
function failedJob(code: number): JobResult {
  return {
    label: "lint",
    status: "failed",
    code,
    durationS: 1,
    outputLines: 0,
    errorLikeLines: 0,
  };
}

interface TailScenario {
  name: string;
  doc: string | undefined;
  failure: GateFailureEvidence;
  hintId: string;
  hintIncludes: string[];
  warningIds: string[];
  warningIncludes: string[];
}

Deno.test("gotchas tail resolves every document variant in process", async (t) => {
  const malformedThenValid = [
    "# Gate gotchas",
    "",
    "### Broken matcher",
    "",
    "Prose.",
    "",
    "```gotcha-match",
    'stage = "timeout"',
    "```",
    "",
    "### Matching trap",
    "",
    "**Fix.** Do the recorded fix.",
    "",
    "```gotcha-match",
    "evidence = 'LINT-BROKE'",
    "```",
    "",
  ].join("\n");
  const exit127 = jobFailureMessage("lint", failedJob(127));
  const scenarios: TailScenario[] = [
    {
      name: "an authored exit-127 trap matches real engine evidence",
      doc: PROJECT_GOTCHAS,
      failure: {
        failedStage: "check/test",
        diagnostics: [{ message: exit127 }],
      },
      hintId: "gate-failure-gotcha-matched",
      hintIncludes: [
        "A gate command fails with exit 127",
        "[repository].ensure",
        "Read the full page with `discern map",
      ],
      warningIds: [],
      warningIncludes: [],
    },
    {
      name: "an unmatched failure keeps the generic pointer",
      doc: PROJECT_GOTCHAS,
      failure: {
        failedStage: "check/test",
        diagnostics: [{ message: "lint failed (exit 7)" }],
      },
      hintId: "gate-failure-gotchas",
      hintIncludes: ["known gate failures and their fixes"],
      warningIds: [],
      warningIncludes: [],
    },
    {
      name: "a malformed matcher warns while a later valid matcher fires",
      doc: malformedThenValid,
      failure: {
        failedStage: "check/test",
        diagnostics: [{ message: "LINT-BROKE" }],
      },
      hintId: "gate-failure-gotcha-matched",
      hintIncludes: ["Matching trap", "Do the recorded fix."],
      warningIds: ["gotchas-matcher-invalid"],
      warningIncludes: ["Broken matcher", '"timeout"'],
    },
    {
      name: "a missing document keeps the pointer without matcher warnings",
      doc: undefined,
      failure: {
        failedStage: "check/test",
        diagnostics: [{ message: "lint failed (exit 7)" }],
      },
      hintId: "gate-failure-gotchas",
      hintIncludes: ["known gate failures and their fixes"],
      warningIds: [],
      warningIncludes: [],
    },
  ];

  await withTempDir(async (dir) => {
    const docsDir = join(dir, "docs");
    await Deno.mkdir(docsDir);
    for (const [index, scenario] of scenarios.entries()) {
      await t.step(scenario.name, async () => {
        const docRel = `docs/gotchas-${index}.md`;
        if (scenario.doc !== undefined) {
          await Deno.writeTextFile(join(dir, docRel), scenario.doc);
        }
        const config = parseConfigOrThrow(
          [
            "[project]",
            `gotchas_doc = "${docRel}"`,
            "",
            "[map]",
            'dir = "docs/"',
            "",
          ].join("\n"),
        );
        const tail = await gateFailureGotchasTail(
          config,
          dir,
          scenario.failure,
        );
        assert(tail !== undefined);
        assertEquals(tail.hint.id, scenario.hintId);
        for (const text of scenario.hintIncludes) {
          assertStringIncludes(tail.hint.text, text);
        }
        assertEquals(
          tail.warnings.map((warning) => warning.id),
          scenario.warningIds,
        );
        for (const text of scenario.warningIncludes) {
          assert(
            tail.warnings.some((warning) => warning.text.includes(text)),
            `expected a matcher warning containing ${JSON.stringify(text)}`,
          );
        }
      });
    }
  });
});
