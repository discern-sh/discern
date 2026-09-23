/** Guards for manual purposes, promotion, benefit coverage, and prose policy. */

import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import {
  MANUAL_BENEFIT_EXCLUSIONS,
  MANUAL_BENEFIT_OBLIGATIONS,
  manualBenefitCoverageIssues,
} from "../scripts/manual_benefits.ts";
import {
  checkManualProse,
  manualProseSource,
  manualReadingGrade,
  manualReadingGradesByPage,
  measuredManualProse,
  projectManualProse,
  withStagedManualProse,
} from "../scripts/manual_prose_lib.ts";
import { addsOrReplacesFrontDoor } from "../scripts/manual_front_door_checkpoint.ts";
import { countManualFrontDoors } from "../scripts/manual_front_doors.ts";
import {
  MANUAL_CONCEPT_LINK_TARGETS,
  manualReadingTarget,
} from "../scripts/manual_codegen.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { headingAnchors } from "../src/lib/docs_integrity.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { fencedCommandFindings } from "../src/lib/map_integrity.ts";
import { SEARCH_KIND_WEIGHT } from "../src/lib/docs_search.js";
import {
  buildManualProjection,
  manualFrontDoorDestinations,
  manualFrontDoorEntries,
  type ManualProjection,
  normalizeManualSearchName,
  resolveManualLink,
  staleManualAliasOwnerOverrides,
} from "../src/lib/manual.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  MANUAL_ALIAS_OWNER_OVERRIDES,
  MANUAL_KIND_REGISTRY,
  MANUAL_KINDS,
} from "../src/shared/manual.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { withTempDir } from "./helpers.ts";
import { runVale } from "../scripts/vale_lib.ts";

/** Load the repository manual through its canonical strict policy. */
async function repositoryManual(): Promise<ManualProjection> {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.manual,
  });
  assert(tree !== undefined);
  return await buildManualProjection(tree.entries);
}

Deno.test("every fenced discern command follows the live CLI model", async () => {
  const manual = await repositoryManual();
  const findings = [];
  for (const page of manual.pages) {
    const text = await Deno.readTextFile(page.entry.absPath);
    findings.push(
      ...fencedCommandFindings(
        page.entry.relToDocs,
        text,
        TEST_CLI_MODEL(),
        new Set(),
      ),
    );
  }
  assertEquals(
    findings.map((finding) =>
      `${finding.file}:${finding.line} ${finding.detail}`
    ),
    [],
  );
});

Deno.test("the manual fence guard rejects an unknown live option", () => {
  const findings = fencedCommandFindings(
    "fixture.md",
    "```sh\ndiscern done --no-such-option\n```\n",
    TEST_CLI_MODEL(),
    new Set(),
  );
  assertEquals(findings.length, 1);
  assertStringIncludes(findings[0]?.detail ?? "", "--no-such-option");
});

Deno.test("the manual fence guard tells an author how to quote discern's output", () => {
  // A quoted message that begins with the product name reads as a command
  // whose path won't resolve, so the finding names the fix where it fails. A
  // stale flag belongs to a real command and carries no quoting note.
  const [quoted] = fencedCommandFindings(
    "fixture.md",
    "```text\ndiscern found setup step <id> recorded as running\n```\n",
    TEST_CLI_MODEL(),
    new Set(),
  );
  assertStringIncludes(quoted?.detail ?? "", "move the quote into the prose");
  const [flag] = fencedCommandFindings(
    "fixture.md",
    "```sh\ndiscern done --no-such-option\n```\n",
    TEST_CLI_MODEL(),
    new Set(),
  );
  assertFalse((flag?.detail ?? "").includes("move the quote"), flag?.detail);
});

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
  assertEquals(
    staleManualAliasOwnerOverrides(manual.pages),
    [],
    "every MANUAL_ALIAS_OWNER_OVERRIDES key must still be claimed by a page",
  );
  assertEquals(
    staleManualAliasOwnerOverrides(manual.pages, {
      "name claimed by no page": "reference-cli",
    }),
    ["name claimed by no page"],
  );
});

/**
 * Link-table destinations that disagree with the manual's own search: the
 * destination must be the page the manual's search sends one of the Map
 * page's names to, or at least mention the Map page's title. A named section
 * must be a heading on that page.
 */
async function conceptLinkIssues(
  targets: Readonly<Record<string, string>>,
  manual: ManualProjection,
): Promise<string[]> {
  const map = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.map,
    includeInternal: true,
  });
  assert(map !== undefined);
  const mapPages = new Map(
    map.entries.map((entry) => [entry.relToDocs, entry]),
  );
  const homes = new Map<string, string>();
  for (const page of manual.pages) {
    for (const name of [page.entry.title, ...page.entry.aliases]) {
      homes.set(normalizeManualSearchName(name), page.id);
    }
  }
  const issues: string[] = [];
  for (const [mapRel, value] of Object.entries(targets)) {
    const { pageId: targetId, section } = manualReadingTarget(value);
    const source = mapPages.get(mapRel);
    const target = manual.byId.get(targetId);
    if (source === undefined || target === undefined) {
      issues.push(
        `${mapRel} → ${targetId}: no such ${
          source === undefined ? "Map" : "manual"
        } page`,
      );
      continue;
    }
    const { body } = parseFrontmatter(
      await Deno.readTextFile(target.entry.absPath),
    );
    if (section !== undefined && !headingAnchors(body).has(section)) {
      issues.push(`${mapRel} → ${value}: ${targetId} has no such heading`);
    }
    const names = [source.title, ...source.aliases].map(
      normalizeManualSearchName,
    );
    if (names.some((name) => homes.get(name) === targetId)) continue;
    const concept = normalizeManualSearchName(source.title).replace(
      /^the /u,
      "",
    ).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (
      new RegExp(`(?<![\\p{L}\\p{N}])${concept}(?![\\p{L}\\p{N}])`, "iu")
        .test(body)
    ) {
      continue;
    }
    const owners = [...new Set(names.flatMap((name) => homes.get(name) ?? []))];
    issues.push(
      `${mapRel} → ${targetId}: the manual's search sends "${source.title}" ` +
        `to ${owners.join(", ") || "no page"}, and ${targetId} never ` +
        "mentions it; point the link at the concept's manual home",
    );
  }
  return issues;
}

Deno.test("generated Map links land on the manual's home for their concept", async () => {
  const manual = await repositoryManual();
  assertEquals(
    await conceptLinkIssues(MANUAL_CONCEPT_LINK_TARGETS, manual),
    [],
  );
  // The guard bites: a destination that neither owns nor mentions the
  // concept, and a section the destination doesn't have.
  assertEquals(
    (await conceptLinkIssues({
      "20-quality-gate/coupling.md": "explanation-evidence-and-improvement",
      "20-quality-gate/patterns.md":
        "explanation-evidence-and-improvement#no-such-section",
    }, manual)).length,
    2,
  );
});

Deno.test("search kind weighting enrolls every registered manual kind", () => {
  assertEquals(
    Object.keys(SEARCH_KIND_WEIGHT).sort(),
    [...MANUAL_KINDS, "other"].sort(),
  );
});

Deno.test("every front-door surface projects the one authored README authority", async () => {
  const manual = await repositoryManual();
  const promoted = manual.frontDoors.map((page) => page.entry.relToDocs);
  assert(promoted.length > 0);

  const terminal = await manualFrontDoorEntries(
    manual.pages.map((page) => page.entry),
  );
  assertEquals(terminal.map((entry) => entry.relToDocs), promoted);

  const readme = await Deno.readTextFile(
    join(REPO_AUTHORED_PATHS.manual, "README.md"),
  );
  const destinations = manualFrontDoorDestinations(readme);
  assertEquals(
    destinations.map((destination) =>
      resolveManualLink("README.md", destination)
    ),
    promoted,
  );

  const measured = await countManualFrontDoors(REPO_ROOT);
  assertEquals(measured, destinations.length);
  assertEquals(measured, promoted.length);

  const standard =
    (await loadConfig(REPO_ROOT)).standards["manual_front_doors"];
  assert(standard !== undefined, "the manual_front_doors standard is declared");
  assertEquals(standard.direction, "down");
  assert(
    measured <= standard.limit,
    `manual_front_doors measured ${measured}, above the ${standard.limit} ceiling`,
  );
});

Deno.test("benefit obligations resolve both directions and reject stale identities", async () => {
  const manual = await repositoryManual();
  assertEquals(manualBenefitCoverageIssues(manual), []);

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

  // A page withheld with publish:false never reaches the projection's byId
  // map (tests/manual_projection_guard_test.ts proves that collapse), so an
  // unpublished-but-present home is rejected exactly like a missing one.
  const primaryHome = MANUAL_BENEFIT_OBLIGATIONS["shape-substantial-work"]?.[0];
  assert(primaryHome !== undefined);
  const withheldById = new Map(manual.byId);
  withheldById.delete(primaryHome);
  const withheld: ManualProjection = { ...manual, byId: withheldById };
  assert(
    manualBenefitCoverageIssues(withheld).some((issue) =>
      issue.includes(`${primaryHome} does not exist or publish`)
    ),
  );

  const mapOnly = {
    ...MANUAL_BENEFIT_OBLIGATIONS,
    "shape-substantial-work": ["00-orientation/system-map"],
  };
  assert(
    manualBenefitCoverageIssues(manual, undefined, mapOnly).some((issue) =>
      issue.includes("00-orientation/system-map does not exist or publish")
    ),
  );

  const troubleshootingPage = manual.pages.find((page) =>
    page.kind === "troubleshooting"
  );
  assert(troubleshootingPage !== undefined);
  const troubleshooting = {
    ...MANUAL_BENEFIT_OBLIGATIONS,
    "shape-substantial-work": [troubleshootingPage.id],
  };
  assert(
    manualBenefitCoverageIssues(manual, undefined, troubleshooting).some((
      issue,
    ) => issue.includes("ineligible kind troubleshooting")),
  );

  const doubled = {
    ...MANUAL_BENEFIT_EXCLUSIONS,
    "shape-substantial-work":
      "A retained reason that cannot coexist with an obligation.",
  };
  assert(
    manualBenefitCoverageIssues(manual, undefined, undefined, doubled).some((
      issue,
    ) => issue.includes("cannot be both obligated and excluded")),
  );

  const emptyHomes = {
    ...MANUAL_BENEFIT_OBLIGATIONS,
    "shape-substantial-work": [],
  };
  assert(
    manualBenefitCoverageIssues(manual, undefined, emptyHomes).some((issue) =>
      issue.includes("must name at least one page")
    ),
  );
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

Deno.test("per-page reading grades apply the corpus measure to each measured page", async () => {
  const measured = new Set(
    MANUAL_KIND_REGISTRY.filter((entry) => entry.measuresReadingComplexity)
      .map((entry) => entry.kind),
  );
  const pages = await projectManualProse(REPO_ROOT);
  const graded = manualReadingGradesByPage(pages);
  const byPath = new Map(graded.map((row) => [row.path, row]));
  for (const page of pages) {
    const row = byPath.get(page.page.entry.relToDocs);
    if (measured.has(page.page.kind)) {
      assertEquals(row?.grade, manualReadingGrade([page]));
    } else {
      assertEquals(
        row,
        undefined,
        `${page.page.entry.relToDocs} is unmeasured`,
      );
    }
  }
  assert(
    graded.every((row, index) =>
      index === 0 || (graded[index - 1]?.grade ?? Infinity) >= row.grade
    ),
    "the hardest page comes first",
  );
});

Deno.test("manual product-voice staging maps diagnostics to exact authored sources", async () => {
  await withStagedManualProse(REPO_ROOT, async (stage) => {
    assertEquals(
      stage.pages.length,
      (await projectManualProse(REPO_ROOT)).length,
    );
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

Deno.test("the Manual prose policy can target one published page without weakening its projection", async () => {
  const glossary = join(
    REPO_ROOT,
    "project",
    "manual",
    "30-reference",
    "glossary.md",
  );
  await withStagedManualProse(REPO_ROOT, (stage) => {
    assertEquals(stage.pages.map((page) => page.source), [glossary]);
    assertEquals(stage.sources.size, 1);
  }, [glossary]);
  await assertRejects(
    () => projectManualProse(REPO_ROOT, [join(REPO_ROOT, "not-manual.md")]),
    Error,
    "not a published Manual page",
  );
});

Deno.test("the shared Manual verdict retains editorial review and blocks product and spelling errors", async () => {
  await withTempDir(async (dir) => {
    const manualDir = join(dir, "project", "manual");
    await copy(REPO_AUTHORED_PATHS.manual, manualDir);
    const source = join(manualDir, "10-guides", "delegate-work.md");
    const original = await Deno.readTextFile(source);
    const frontmatter = original.match(
      /^(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n|$)/u,
    )?.[1];
    assert(frontmatter !== undefined);
    // Preserve the page and its inbound heading targets while adding policy cases.
    const writeBody = async (body: string): Promise<void> => {
      await Deno.writeTextFile(
        source,
        `${original.trimEnd()}\n\n${body}\n`,
      );
    };
    // Keep the strict manual projection in the isolated fixture while running
    // the actual pinned Vale and authored rules from the repository.
    const check = (): ReturnType<typeof checkManualProse> =>
      checkManualProse(
        dir,
        [source],
        (_root, args) => runVale(REPO_ROOT, args),
      );

    await writeBody(
      "Record an honest unmet conclusion.\n" +
        "Make the book easy to find.",
    );
    const editorial = await check();
    assertEquals(editorial.code, 0, editorial.stderr);
    assertEquals(editorial.alerts, {});
    const review = editorial.reviewAlerts[source] ?? [];
    for (
      const rule of [
        "Discern.ContextualQualifiers",
        "Discern.Padding",
      ]
    ) {
      assert(
        review.some((alert) => alert.Check === rule),
        `${rule} stays visible`,
      );
    }
    assert(
      review.every((alert) =>
        alert.Line !== undefined &&
        alert.Line > frontmatter.split("\n").length
      ),
      "review findings keep their original source line numbers",
    );
    assertEquals(Object.keys(editorial.reviewAlerts), [source]);

    await writeBody(
      "Discern has a mispellling.\n\nThe whole effort matters.\n\nTwo files remain.",
    );
    const defective = await check();
    assertEquals(defective.code, 1);
    for (
      const rule of [
        "DiscernProduct.ProductName",
        "Vale.Spelling",
        "Discern.Numeration",
        "Discern.Seasoning",
      ]
    ) {
      assert(
        defective.alerts[source]?.some((alert) => alert.Check === rule),
        `${rule} remains blocking in the shared gate and Canon Editor verdict`,
      );
      assert(
        defective.reviewAlerts[source]?.some((alert) => alert.Check === rule),
        `${rule} remains visible in full review`,
      );
    }
  });
});
