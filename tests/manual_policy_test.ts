/** Guards for manual purposes, promotion, benefit coverage, and prose policy. */

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  MANUAL_BENEFIT_EXCLUSIONS,
  MANUAL_BENEFIT_OBLIGATIONS,
  manualBenefitCoverageIssues,
} from "../scripts/manual_benefits.ts";
import {
  manualProseSource,
  manualReadingGrade,
  measuredManualProse,
  projectManualProse,
  withStagedManualProse,
} from "../scripts/manual_prose_lib.ts";
import { addsOrReplacesFrontDoor } from "../project/scripts/manual_front_door_checkpoint.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import {
  buildManualProjection,
  type ManualProjection,
} from "../src/lib/manual.ts";
import {
  MANUAL_ALIAS_OWNER_OVERRIDES,
  MANUAL_KIND_REGISTRY,
  MANUAL_KINDS,
} from "../src/shared/manual.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

/** Load the repository manual through its canonical strict policy. */
async function repositoryManual(): Promise<ManualProjection> {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.manual,
  });
  assert(tree !== undefined);
  return await buildManualProjection(tree.entries);
}

Deno.test("manual kind policy is closed and every member owns one checkpoint", async () => {
  assertEquals(
    MANUAL_KIND_REGISTRY.map((entry) => entry.kind),
    [...MANUAL_KINDS],
  );
  assertEquals(
    new Set(MANUAL_KIND_REGISTRY.map((entry) => entry.checkpointId)).size,
    MANUAL_KIND_REGISTRY.length,
  );
  const manual = await repositoryManual();
  assert(
    manual.pages.every((page) =>
      MANUAL_KIND_REGISTRY.some((entry) => entry.kind === page.kind)
    ),
  );
  for (const owner of Object.values(MANUAL_ALIAS_OWNER_OVERRIDES)) {
    assert(manual.byId.has(owner), `alias owner ${owner} must be published`);
  }
});

Deno.test("benefit obligations resolve both directions and reject stale identities", async () => {
  const manual = await repositoryManual();
  assertEquals(manualBenefitCoverageIssues(manual), []);
  assertEquals(Object.keys(MANUAL_BENEFIT_OBLIGATIONS).length, 21);
  assertEquals(Object.keys(MANUAL_BENEFIT_EXCLUSIONS).length, 24);

  const staleBenefit = {
    ...MANUAL_BENEFIT_OBLIGATIONS,
    "benefit-that-does-not-exist": ["explanation-proof"],
  };
  assert(
    manualBenefitCoverageIssues(
      manual,
      undefined,
      staleBenefit,
    ).some((issue) => issue.includes("names no Human Benefit")),
  );

  const stalePage = {
    ...MANUAL_BENEFIT_OBLIGATIONS,
    "shape-substantial-work": ["page-that-does-not-exist"],
  };
  assert(
    manualBenefitCoverageIssues(manual, undefined, stalePage).some((issue) =>
      issue.includes("does not exist or publish")
    ),
  );

  const ineligible = {
    ...MANUAL_BENEFIT_OBLIGATIONS,
    "shape-substantial-work": ["reference-cli"],
  };
  assert(
    manualBenefitCoverageIssues(manual, undefined, ineligible).some((issue) =>
      issue.includes("ineligible kind reference")
    ),
  );
});

Deno.test("the typed exclusion reasons retain the frozen 1A decisions", async () => {
  const inventory = await Deno.readTextFile(
    join(
      REPO_ROOT,
      "project/map/_private/planning/public-manual-workstreams/inventory.md",
    ),
  );
  const section =
    inventory.split("### Explicitly not selected: 24")[1]?.split("\n## ")[0] ??
      "";
  const reasons = Object.fromEntries(
    section.split("\n").flatMap((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      const id = /^`([^`]+)`$/u.exec(cells[2] ?? "")?.[1];
      const reason = cells[3];
      return id === undefined || reason === undefined ? [] : [[id, reason]];
    }),
  );
  assertEquals(reasons, MANUAL_BENEFIT_EXCLUSIONS);
});

Deno.test("promotion checkpoint distinguishes additions and replacements from shrinkage", () => {
  const before = ["start.md", "guide.md", "reference.md"];
  assertFalse(addsOrReplacesFrontDoor(before, [...before]));
  assertFalse(addsOrReplacesFrontDoor(before, ["start.md", "guide.md"]));
  assertFalse(addsOrReplacesFrontDoor(before, [...before].reverse()));
  assert(addsOrReplacesFrontDoor(before, [...before, "new.md"]));
  assert(addsOrReplacesFrontDoor(before, ["start.md", "replacement.md"]));
});

Deno.test("manual prose excludes metadata and code while reference stays out of grade", async () => {
  const sample = `---
title: Metadata must not count
kind: guide
---

Visible prose remains.

\`\`\`sh
code must not count
\`\`\`

<!-- policy marker must not count -->
`;
  const measured = measuredManualProse(sample);
  assertStringIncludes(measured, "Visible prose remains.");
  assertFalse(measured.includes("Metadata must not count"));
  assertFalse(measured.includes("code must not count"));
  assertFalse(measured.includes("policy marker"));

  const pages = await projectManualProse(REPO_ROOT);
  const baseline = manualReadingGrade(pages);
  const changedReference = pages.map((page) =>
    page.page.kind === "reference"
      ? {
        ...page,
        measuredProse: "Polysyllabic institutionalization. ".repeat(500),
      }
      : page
  );
  assertEquals(manualReadingGrade(changedReference), baseline);
  const changedTutorial = pages.map((page) =>
    page.page.kind === "reference"
      ? page
      : { ...page, measuredProse: "Go. Go. Go. Go." }
  );
  assert(manualReadingGrade(changedTutorial) !== baseline);
});

Deno.test("manual product-voice staging maps diagnostics to exact authored sources", async () => {
  await withStagedManualProse(REPO_ROOT, async (stage) => {
    assertEquals(stage.pages.length, 47);
    assertEquals(stage.sources.size, stage.pages.length);
    for (const page of stage.pages) {
      const staged = join(
        stage.dir,
        "_manual-product",
        page.page.entry.relToDocs,
      );
      assertEquals(manualProseSource(staged, stage), page.source);
      const markdown = await Deno.readTextFile(staged);
      assertFalse(markdown.includes(`id: ${page.page.id}`));
    }
  });
});
