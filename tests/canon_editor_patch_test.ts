/**
 * The write-back boundary. The patcher refuses everything but a plain
 * string-literal prose field and edits nothing but that literal; the
 * save-and-prove pipeline leaves a proven save coherent on disk and rolls an
 * unprovable one back to the exact prior state. Every mutation runs against a
 * throwaway registry fixture so the repository's parallel test workers can
 * never observe an in-flight save or inherit one after an interrupted test.
 */

import { dirname, join } from "@std/path";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Node, Project } from "ts-morph";
import {
  listOrderIssue,
  type ListPatchRequest,
  listValueIssue,
  patchRegistrySource,
  type ProsePatchRequest,
  proseValueIssue,
} from "../scripts/canon_editor/patch.ts";
import { saveField } from "../scripts/canon_editor/pipeline.ts";
import { PROSE_REGISTRIES } from "../scripts/canon_editor/registry_ast.ts";
import type {
  Snapshot,
  SnapshotPage,
} from "../scripts/canon_editor/snapshot.ts";
import { MARK_OPEN } from "../scripts/canon_editor/annotation.ts";
import {
  markerAnnotator,
  setProseAnnotator,
  stripAnnotationMarkers,
} from "../scripts/canon_editor/annotation.ts";
import { REPO_ROOT } from "../scripts/canon_editor/root.ts";
import { allFeatureNodes } from "../scripts/feature_registry.ts";
import { PRACTICE_CANON } from "../scripts/practice_registry.ts";
import { buildPickerCatalog } from "../scripts/canon_editor/pickers.ts";
import { allDemandEntries } from "../scripts/brand/demand.ts";
import { withTempDir } from "./helpers.ts";
import { GLOSSARY, renderGlossaryDoc } from "../scripts/glossary_registry.ts";
import {
  MANUAL_GLOSSARY_REL,
  renderManualGlossaryArtifact,
} from "../scripts/glossary_codegen.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";

const FEATURE_FILE = join(REPO_ROOT, "scripts", "feature_registry.ts");
const GLOSSARY_MAP_REL = join(
  "project",
  "map",
  "00-orientation",
  "glossary.md",
);
const GLOSSARY_MANUAL_REL = join("project", "manual", MANUAL_GLOSSARY_REL);
const manualTree = await discoverDocs({
  cwd: REPO_ROOT,
  dir: resolveRepositoryManualDir(REPO_ROOT).abs,
});
assert(manualTree !== undefined, "the Manual fixture must be discoverable");
const manualProjection = await buildManualProjection(manualTree.entries);

/** One compare-and-swap request, explicit even before the type requires it. */
function editRequest(
  registry: ProsePatchRequest["registry"],
  slug: string,
  field: string,
  expected: string,
  value: string,
): ProsePatchRequest {
  return { mode: "prose", registry, slug, field, expected, value };
}

/** One ordered typed-list compare-and-swap request. */
function listRequest(
  registry: ListPatchRequest["registry"],
  slug: string,
  field: string,
  expected: readonly string[],
  value: readonly string[],
): ListPatchRequest {
  return { mode: "list", registry, slug, field, expected, value };
}

/** A minimal evaluated snapshot for one pipeline fixture. */
function fixtureSnapshot(pages: readonly SnapshotPage[] = []): Snapshot {
  return {
    pages,
    entries: [],
    pickers: [],
    lint: { retired: [], plainPoliced: [] },
    guards: [],
    standards: [],
  };
}

/** One annotated page the fake renderer says should exist. */
function fixturePage(
  rel: string,
  full: string,
  corpus: SnapshotPage["corpus"] = "map",
  id = "fixture-page",
): SnapshotPage {
  return {
    id,
    rel,
    title: "Fixture page",
    corpus,
    prosePolicy: corpus,
    body: full,
    full,
    annotated: true,
  };
}

/** Render the two glossary artifacts through their real annotated producers. */
async function glossaryProjectionPages(
  definition: string,
): Promise<readonly SnapshotPage[]> {
  const glossary = GLOSSARY.map((entry) =>
    entry.term === "File ownership" ? { ...entry, definition } : entry
  );
  setProseAnnotator(markerAnnotator);
  let map: string;
  let manual: string;
  try {
    map = renderGlossaryDoc(glossary);
    manual = renderManualGlossaryArtifact(manualProjection, glossary);
  } finally {
    setProseAnnotator(undefined);
  }
  return [
    fixturePage(
      GLOSSARY_MAP_REL,
      await formatMarkdownText(GLOSSARY_MAP_REL, map),
      "map",
      "glossary",
    ),
    fixturePage(
      GLOSSARY_MANUAL_REL,
      await formatMarkdownText(GLOSSARY_MANUAL_REL, manual),
      "manual",
      "manual-glossary",
    ),
  ];
}

/** Copy both committed glossary projections into one isolated save fixture. */
async function installGlossaryProjections(root: string): Promise<void> {
  for (const rel of [GLOSSARY_MAP_REL, GLOSSARY_MANUAL_REL]) {
    const target = join(root, rel);
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.copyFile(join(REPO_ROOT, rel), target);
  }
}

/** The live fixture entry and a harmless replacement definition. */
function glossaryDefinitionFixture(): {
  readonly before: string;
  readonly after: string;
} {
  const entry = GLOSSARY.find((candidate) =>
    candidate.term === "File ownership"
  );
  assert(entry !== undefined);
  return {
    before: entry.definition,
    after: `${entry.definition} The registry remains the sole source.`,
  };
}

/** Install one tiny guard file inside a fixture root. */
async function writeGuard(
  root: string,
  name: string,
  ok: boolean,
): Promise<string> {
  const rel = join("tests", `${name}_test.ts`);
  const path = join(root, rel);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(
    path,
    `Deno.test("${name}", () => {${
      ok ? "" : ' throw new Error("fixture guard red");'
    }});\n`,
  );
  return rel;
}

/** Run a mutation assertion against copied registry sources under /tmp. */
async function withPipelineFixture(
  body: (root: string) => Promise<void>,
): Promise<void> {
  await withTempDir(async (root) => {
    for (const rel of new Set(PROSE_REGISTRIES.map((entry) => entry.file))) {
      const target = join(root, rel);
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.copyFile(join(REPO_ROOT, rel), target);
    }
    await Deno.writeTextFile(
      join(root, "scripts", "prose_check.ts"),
      "Deno.exit(0);\n",
    );
    await body(root);
  }, { prefix: "discern-canon-editor-" });
}

/** The live prose of one feature node's field, from the evaluated registry. */
function liveFieldValue(id: string, field: "what" | "why"): string {
  const found = allFeatureNodes().find(({ node }) => node.id === id);
  const value = found?.node[field];
  assert(value !== undefined, `${id}.${field} should exist for this test`);
  return value;
}

Deno.test("prose values are policed before any syntax work", () => {
  assert(proseValueIssue("") !== undefined, "empty prose refused");
  assert(proseValueIssue("two\nlines.") !== undefined, "line breaks refused");
  assert(
    proseValueIssue(`sneaky ${MARK_OPEN} marker.`) !== undefined,
    "annotation markers refused",
  );
  assertEquals(proseValueIssue("An honest sentence."), undefined);
});

Deno.test("typed list values admit each live option once", async () => {
  const catalog = await buildPickerCatalog();
  const hint = catalog.find((entry) => entry.source === "hint");
  assert(hint !== undefined, "the hint picker is supported");
  assertEquals(
    listValueIssue(["gate-prove-it-works", "gate-relay-proof"], hint),
    undefined,
  );
  assert(
    listValueIssue(["gate-relay-proof", "gate-relay-proof"], hint)?.includes(
      "repeats",
    ),
  );
  assert(
    listValueIssue(["not-a-registered-hint"], hint)?.includes("not a live"),
  );
  const forces = catalog.find((entry) => entry.source === "demand-force");
  assert(forces !== undefined);
  assert(
    listValueIssue([], forces, 1)?.includes("requires at least 1"),
    "tuple-shaped fields cannot be saved empty",
  );
  const enforcement = catalog.find((entry) =>
    entry.source === "enforcement-carrier"
  );
  const teaching = catalog.find((entry) => entry.source === "teaching-carrier");
  assert(enforcement !== undefined && teaching !== undefined);
  const skill = teaching.options[0]?.value;
  const verb = enforcement.options.find((option) =>
    option.value.startsWith("verb:")
  )?.value;
  assert(skill !== undefined && verb !== undefined);
  assert(
    listValueIssue([skill], enforcement)?.includes("not a live"),
    "a taught skill is tier-invalid for enforcement",
  );
  assert(
    listValueIssue([verb], teaching)?.includes("not a live"),
    "a verb is tier-invalid for teaching",
  );
});

Deno.test("typed lists preserve survivors and append additions", () => {
  assertEquals(
    listOrderIssue(["one", "two", "three"], ["one", "three", "new"]),
    undefined,
  );
  assert(
    listOrderIssue(["one", "two"], ["two", "one"])?.includes("order"),
  );
  assert(
    listOrderIssue(["one", "two"], ["one", "new", "two"])?.includes(
      "append",
    ),
  );
});

Deno.test("the patcher refuses everything but editable prose literals", () => {
  const cases: readonly {
    registry: "feature" | "agent-benefit" | "glossary";
    slug: string;
    field: string;
    expect: RegExp;
  }[] = [
    { registry: "feature", slug: "proof", field: "id", expect: /locked/ },
    {
      registry: "agent-benefit",
      slug: "own-one-isolated-effort",
      field: "hints",
      expect: /list, not in-place prose/,
    },
    {
      registry: "feature",
      slug: "jobs-table",
      field: "what",
      expect: /template.*IDE jumps/,
    },
    {
      registry: "feature",
      slug: "proof",
      field: "nonsense",
      expect: /no editor semantics/,
    },
    {
      registry: "feature",
      slug: "no-such-node",
      field: "what",
      expect: /no feature entry/,
    },
    {
      registry: "glossary",
      slug: "file-ownership",
      field: "retired.0.pattern",
      expect: /locked/,
    },
    {
      registry: "glossary",
      slug: "engine",
      field: "plain.match",
      expect: /locked/,
    },
    {
      registry: "glossary",
      slug: "file-ownership",
      field: "plain.phrase",
      expect: /adding a field is structural work/,
    },
  ];
  for (const row of cases) {
    const outcome = patchRegistrySource(
      REPO_ROOT,
      editRequest(
        row.registry,
        row.slug,
        row.field,
        "",
        "A replacement sentence.",
      ),
    );
    assert(!outcome.ok, `${row.slug}.${row.field} must be refused`);
    assert(
      row.expect.test(outcome.issue),
      `${row.slug}.${row.field}: unexpected refusal "${outcome.issue}"`,
    );
  }
});

Deno.test("a patch replaces exactly one literal and nothing else", async () => {
  const original = await Deno.readTextFile(FEATURE_FILE);
  const oldValue = liveFieldValue("proof", "why");
  const value =
    "The owner reviews a verified claim — with a `code span` and an em—dash.";
  const outcome = patchRegistrySource(
    REPO_ROOT,
    editRequest("feature", "proof", "why", oldValue, value),
  );
  assert(outcome.ok, "the patch should land");
  assertEquals(outcome.file, "scripts/feature_registry.ts");
  assert(outcome.text.includes(value), "the new prose is in the source");
  assert(!outcome.text.includes(oldValue), "the old prose is gone");
  assertEquals(
    outcome.text.length - original.length,
    JSON.stringify(value).length - JSON.stringify(oldValue).length,
    "the byte delta is exactly the literal's own delta",
  );
  const reparsed = new Project({ useInMemoryFileSystem: true })
    .createSourceFile("probe.ts", outcome.text);
  const literal = reparsed
    .getDescendants()
    .find((node) =>
      Node.isStringLiteral(node) && node.getLiteralValue() === value
    );
  assert(literal !== undefined, "the patched source re-parses with the value");
  assertEquals(
    await Deno.readTextFile(FEATURE_FILE),
    original,
    "the real file was never touched",
  );
});

Deno.test("a typed list patch replaces one ordered string array", async () => {
  const original = await Deno.readTextFile(FEATURE_FILE);
  const pickers = await buildPickerCatalog();
  const expected = ["silent-worktree-divergence", "start-mcp-re-root"];
  const value = ["start-mcp-re-root"];
  const outcome = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "agent-benefit",
      "own-one-isolated-effort",
      "hints",
      expected,
      value,
    ),
    { pickers },
  );
  assert(outcome.ok, "the list patch should land in memory");
  assert(
    outcome.text.includes('hints: ["start-mcp-re-root"]'),
    "the requested ordered list is in the source",
  );
  assertEquals(
    await Deno.readTextFile(FEATURE_FILE),
    original,
    "the pure patch never touches the real file",
  );
});

Deno.test("Demand Canon prose and benefit answers patch through the shared boundary", async () => {
  const row = allDemandEntries().find(({ entry }) =>
    entry.id === "checkout-collisions"
  );
  assert(row !== undefined, "the demand fixture exists");
  const prose = patchRegistrySource(
    REPO_ROOT,
    editRequest(
      "demand",
      row.entry.id,
      "situation",
      row.entry.situation,
      row.entry.situation + " The collision is visible immediately.",
    ),
  );
  assert(prose.ok, "demand prose patches in memory");
  assertEquals(prose.file, "scripts/brand/demand.ts");

  const expected = row.entry.answer.benefits;
  assert(expected !== undefined, "the demand fixture has a benefit answer");
  const answer = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "demand",
      row.entry.id,
      "answer.benefits",
      expected,
      ["resume-later"],
    ),
    { pickers: await buildPickerCatalog() },
  );
  assert(answer.ok, "demand benefit answers use the live picker authority");
  assert(
    answer.text.includes('answer: { benefits: ["resume-later"] }'),
    "the requested benefit answer is in the patched source",
  );
});

Deno.test("a patch refuses to overwrite a field that changed since opening", () => {
  const current = liveFieldValue("proof", "why");
  const outcome = patchRegistrySource(
    REPO_ROOT,
    editRequest(
      "feature",
      "proof",
      "why",
      `${current} Stale browser value.`,
      `${current} Browser replacement.`,
    ),
  );
  assert(!outcome.ok, "a stale compare-and-swap must be refused");
  assert(
    outcome.issue.includes("changed on disk"),
    `the refusal should explain the conflict; got ${outcome.issue}`,
  );
});

Deno.test("a typed list patch refuses stale and unknown values", async () => {
  const pickers = await buildPickerCatalog();
  const stale = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "agent-benefit",
      "own-one-isolated-effort",
      "hints",
      ["silent-worktree-divergence"],
      ["start-mcp-re-root"],
    ),
    { pickers },
  );
  assert(!stale.ok && stale.conflict === true);

  const unknown = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "agent-benefit",
      "own-one-isolated-effort",
      "hints",
      ["silent-worktree-divergence", "start-mcp-re-root"],
      ["not-a-registered-hint"],
    ),
    { pickers },
  );
  assert(!unknown.ok && unknown.issue.includes("not a live hint value"));

  const hintPicker = pickers.find((picker) => picker.source === "hint");
  assert(hintPicker !== undefined);
  const stalePickers = pickers.map((picker) =>
    picker.source === "hint"
      ? {
        ...picker,
        options: picker.options.filter((option) =>
          option.value !== "silent-worktree-divergence"
        ),
      }
      : picker
  );
  const retainedStale = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "agent-benefit",
      "own-one-isolated-effort",
      "hints",
      ["silent-worktree-divergence", "start-mcp-re-root"],
      ["silent-worktree-divergence", "start-mcp-re-root"],
    ),
    { pickers: stalePickers },
  );
  assert(
    !retainedStale.ok && retainedStale.issue.includes("not a live hint value"),
    "a no-longer-live value must be removed before the list can save",
  );

  const demand = allDemandEntries().find(({ entry }) =>
    entry.id === "checkout-collisions"
  );
  assert(demand !== undefined);
  const emptyTuple = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "demand",
      demand.entry.id,
      "forces",
      demand.entry.forces,
      [],
    ),
    { pickers },
  );
  assert(
    !emptyTuple.ok && emptyTuple.issue.includes("requires at least 1"),
    "non-empty source tuples cannot be emptied through the picker",
  );

  const teaching = pickers.find((picker) =>
    picker.source === "teaching-carrier"
  );
  const skill = teaching?.options[0]?.value;
  const tenet = PRACTICE_CANON[0];
  assert(skill !== undefined && tenet !== undefined);
  const tierInvalid = patchRegistrySource(
    REPO_ROOT,
    listRequest(
      "practice",
      tenet.id,
      "upheld.automated",
      tenet.upheld.automated ?? [],
      [skill],
    ),
    { pickers },
  );
  assert(
    !tierInvalid.ok &&
      tierInvalid.issue.includes("not a live enforcement-carrier value"),
    "a skill cannot cross into an enforcement tier",
  );
});

Deno.test("preview mode proves the patch without touching the tree", async () => {
  const before = await Deno.readTextFile(FEATURE_FILE);
  const current = liveFieldValue("proof", "why");
  const report = await saveField(
    editRequest(
      "feature",
      "proof",
      "why",
      current,
      current + " Previewed.",
    ),
    {
      root: REPO_ROOT,
      guardsFor: () => [],
      buildSnapshot: () => Promise.resolve(fixtureSnapshot()),
      apply: false,
    },
  );
  assert(report.ok);
  assertEquals(report.applied, false);
  assertEquals(report.registryChanged, true);
  assertEquals(await Deno.readTextFile(FEATURE_FILE), before);
});

Deno.test("a no-op save proves itself and leaves identical bytes", async () => {
  await withPipelineFixture(async (root) => {
    const featureFile = join(root, "scripts", "feature_registry.ts");
    const before = await Deno.readTextFile(featureFile);
    const current = liveFieldValue("proof", "why");
    const guard = await writeGuard(root, "fixture_green", true);
    const report = await saveField(
      editRequest("feature", "proof", "why", current, current),
      {
        root,
        guardsFor: () => [guard],
        buildSnapshot: () => Promise.resolve(fixtureSnapshot()),
      },
    );
    assert(
      report.ok,
      `an identical value must prove green: ${JSON.stringify(report)}`,
    );
    assert(report.applied);
    assertEquals(report.pages.length, 0, "no page moved for a no-op");
    assertEquals(report.guards?.ok, true);
    assertEquals(report.twin, "plain.why");
    assertEquals(await Deno.readTextFile(featureFile), before);
  });
});

Deno.test("a typed list save runs the same format and guard boundary", async () => {
  await withPipelineFixture(async (root) => {
    const featureFile = join(root, "scripts", "feature_registry.ts");
    const guard = await writeGuard(root, "fixture_list_green", true);
    const pickers = await buildPickerCatalog();
    const report = await saveField(
      listRequest(
        "agent-benefit",
        "own-one-isolated-effort",
        "hints",
        ["silent-worktree-divergence", "start-mcp-re-root"],
        ["start-mcp-re-root"],
      ),
      {
        root,
        pickers,
        guardsFor: () => [guard],
        buildSnapshot: () => Promise.resolve(fixtureSnapshot()),
      },
    );
    assert(report.ok && report.applied);
    assertEquals(report.guards?.ok, true);
    assertEquals(report.twin, undefined, "list edits queue no prose twin");
    assert(
      (await Deno.readTextFile(featureFile)).includes(
        'hints: ["start-mcp-re-root"]',
      ),
      "the formatted typed list survives the proven save",
    );
  });
});

Deno.test("a red guard rolls the whole save back", async () => {
  await withPipelineFixture(async (root) => {
    const featureFile = join(root, "scripts", "feature_registry.ts");
    const before = await Deno.readTextFile(featureFile);
    const pageRel = join("project", "map", "fixture.md");
    const pagePath = join(root, pageRel);
    const pageBefore = "before the save\n";
    await Deno.mkdir(dirname(pagePath), { recursive: true });
    await Deno.writeTextFile(pagePath, pageBefore);
    const guard = await writeGuard(root, "fixture_red", false);
    const current = liveFieldValue("proof", "why");
    const report = await saveField(
      editRequest(
        "feature",
        "proof",
        "why",
        current,
        current + " This must not survive.",
      ),
      {
        root,
        guardsFor: () => [guard],
        buildSnapshot: () =>
          Promise.resolve(
            fixtureSnapshot([fixturePage(pageRel, "after the save\n")]),
          ),
      },
    );
    assert(!report.ok, "a red guard must refuse the save");
    assertEquals(report.ok === false && report.stage, "guards");
    assert(
      report.ok === false && report.restored === true,
      "the report says the held bytes were restored",
    );
    assertEquals(
      await Deno.readTextFile(featureFile),
      before,
      "the registry rolled back to its exact prior bytes",
    );
    assertEquals(await Deno.readTextFile(pagePath), pageBefore);
  });
});

Deno.test("a save the gate's prose voice refuses rolls back", async () => {
  await withPipelineFixture(async (root) => {
    const registryPath = join(root, "scripts", "practice_registry.ts");
    const before = await Deno.readTextFile(registryPath);
    const pageRel = join("project", "map", "practice-fixture.md");
    const pagePath = join(root, pageRel);
    const pageBefore = "before the prose check\n";
    await Deno.mkdir(dirname(pagePath), { recursive: true });
    await Deno.writeTextFile(pagePath, pageBefore);
    const findings = JSON.stringify({
      [pageRel]: [{
        Severity: "error",
        Line: 1,
        Check: "Discern.Exclamation",
        Message: "Exclamation marks are refused.",
      }],
    });
    await Deno.writeTextFile(
      join(root, "scripts", "prose_check.ts"),
      `console.log(${JSON.stringify(findings)});\nDeno.exit(1);\n`,
    );
    const tenet = PRACTICE_CANON.find((item) => item.id === "arrive-knowing");
    assert(tenet !== undefined, "the probed tenet should exist");
    const report = await saveField(
      editRequest(
        "practice",
        "arrive-knowing",
        "obligation",
        tenet.obligation,
        tenet.obligation + " Surprise, it works!",
      ),
      {
        root,
        guardsFor: () => [],
        buildSnapshot: () =>
          Promise.resolve(
            fixtureSnapshot([
              fixturePage(pageRel, "after the prose check\n"),
            ]),
          ),
      },
    );
    assert(!report.ok, "an exclamation must refuse the save before guards");
    assertEquals(report.ok === false && report.stage, "prose");
    assert(
      report.ok === false && report.issue.includes("Discern.Exclamation"),
      "the verdict names the refusing prose rule",
    );
    assert(
      report.ok === false && report.restored === true,
      "the report says the held bytes were restored",
    );
    assertEquals(await Deno.readTextFile(registryPath), before);
    assertEquals(await Deno.readTextFile(pagePath), pageBefore);
  });
});

Deno.test("rollback removes a generated page that was absent before save", async () => {
  await withPipelineFixture(async (root) => {
    const pageRel = join("project", "map", "new-fixture.md");
    const pagePath = join(root, pageRel);
    await Deno.mkdir(dirname(pagePath), { recursive: true });
    const guard = await writeGuard(root, "fixture_missing_page_red", false);
    const current = liveFieldValue("proof", "why");
    const report = await saveField(
      editRequest(
        "feature",
        "proof",
        "why",
        current,
        current + " This must roll back.",
      ),
      {
        root,
        guardsFor: () => [guard],
        buildSnapshot: () =>
          Promise.resolve(
            fixtureSnapshot([fixturePage(pageRel, "new page\n")]),
          ),
      },
    );
    assert(!report.ok, "the red guard must refuse the save");
    assertEquals(report.ok === false && report.stage, "guards");
    await assertRejects(
      () => Deno.stat(pagePath),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("a glossary definition save regenerates its Map and Manual projections in one transaction", async () => {
  await withPipelineFixture(async (root) => {
    await installGlossaryProjections(root);
    const { before, after } = glossaryDefinitionFixture();
    const pages = await glossaryProjectionPages(after);
    const checked: Array<{
      policy: "map" | "manual";
      pages: readonly string[];
    }> = [];
    const report = await saveField(
      editRequest("glossary", "file-ownership", "definition", before, after),
      {
        root,
        guardsFor: () => [],
        buildSnapshot: () => Promise.resolve(fixtureSnapshot(pages)),
        checkProse: (policy, changed) => {
          checked.push({ policy, pages: changed });
          return Promise.resolve({ ok: true });
        },
      },
    );
    assert(report.ok && report.applied);
    assertEquals(
      report.pages,
      [
        { id: "glossary", rel: GLOSSARY_MAP_REL },
        { id: "manual-glossary", rel: GLOSSARY_MANUAL_REL },
      ],
    );
    assertEquals(checked, [
      { policy: "map", pages: [GLOSSARY_MAP_REL] },
      { policy: "manual", pages: [GLOSSARY_MANUAL_REL] },
    ]);
    assert(
      (await Deno.readTextFile(
        join(root, "scripts", "glossary_registry.ts"),
      )).includes(after),
      "the registry literal changes once",
    );
    for (const page of pages) {
      assertEquals(
        await Deno.readTextFile(join(root, page.rel)),
        stripAnnotationMarkers(page.full),
        `${page.id}: the saved bytes are the real producer's bytes`,
      );
    }
  });
});

for (
  const fixture of [
    { term: "Accept", slug: "accept", field: "plain.phrase" },
    {
      term: "File ownership",
      slug: "file-ownership",
      field: "plain.keep",
    },
  ] as const
) {
  Deno.test(`a literal glossary ${fixture.field} saves through the shared pipeline`, async () => {
    await withPipelineFixture(async (root) => {
      await installGlossaryProjections(root);
      const entry = GLOSSARY.find((candidate) =>
        candidate.term === fixture.term
      );
      assert(entry !== undefined);
      const before = fixture.field === "plain.phrase"
        ? "phrase" in entry.plain ? entry.plain.phrase : undefined
        : "keep" in entry.plain
        ? entry.plain.keep
        : undefined;
      assert(
        before !== undefined,
        `${fixture.term} carries the expected variant`,
      );
      const after = `${before}; edited from the inspector`;
      const projectionEntry = GLOSSARY.find((candidate) =>
        candidate.term === "File ownership"
      );
      assert(projectionEntry !== undefined);
      const pages = await glossaryProjectionPages(projectionEntry.definition);
      let renders = 0;
      const report = await saveField(
        editRequest("glossary", fixture.slug, fixture.field, before, after),
        {
          root,
          guardsFor: () => [],
          buildSnapshot: () => {
            renders += 1;
            return Promise.resolve(fixtureSnapshot(pages));
          },
        },
      );
      assert(report.ok && report.applied);
      assertEquals(renders, 1, "the normal save path rerenders the glossary");
      assertEquals(
        report.pages,
        [],
        "plain metadata does not invent visible projection content",
      );
      assert(
        (await Deno.readTextFile(
          join(root, "scripts", "glossary_registry.ts"),
        )).includes(after),
        "the existing literal changes without rewriting the object variant",
      );
      for (const page of pages) {
        assertEquals(
          await Deno.readTextFile(join(root, page.rel)),
          stripAnnotationMarkers(page.full),
          `${page.id}: both real glossary producers remain exact`,
        );
      }
    });
  });
}

for (const refusedPolicy of ["map", "manual"] as const) {
  Deno.test(`a red ${refusedPolicy} prose policy restores the registry and both glossary projections`, async () => {
    await withPipelineFixture(async (root) => {
      await installGlossaryProjections(root);
      const registryPath = join(root, "scripts", "glossary_registry.ts");
      const held = new Map<string, string>();
      for (
        const path of [
          registryPath,
          join(root, GLOSSARY_MAP_REL),
          join(root, GLOSSARY_MANUAL_REL),
        ]
      ) {
        held.set(path, await Deno.readTextFile(path));
      }
      const { before, after } = glossaryDefinitionFixture();
      const report = await saveField(
        editRequest(
          "glossary",
          "file-ownership",
          "definition",
          before,
          after,
        ),
        {
          root,
          guardsFor: () => [],
          buildSnapshot: async () =>
            fixtureSnapshot(await glossaryProjectionPages(after)),
          checkProse: (policy) =>
            Promise.resolve(
              policy === refusedPolicy
                ? { ok: false, issue: `${policy} fixture red` }
                : { ok: true },
            ),
        },
      );
      assert(!report.ok && report.stage === "prose" && report.restored);
      for (const [path, bytes] of held) {
        assertEquals(await Deno.readTextFile(path), bytes, path);
      }
    });
  });
}

Deno.test("a glossary render failure restores the registry before any projection moves", async () => {
  await withPipelineFixture(async (root) => {
    await installGlossaryProjections(root);
    const registryPath = join(root, "scripts", "glossary_registry.ts");
    const beforeBytes = await Deno.readTextFile(registryPath);
    const mapBytes = await Deno.readTextFile(join(root, GLOSSARY_MAP_REL));
    const manualBytes = await Deno.readTextFile(
      join(root, GLOSSARY_MANUAL_REL),
    );
    const { before, after } = glossaryDefinitionFixture();
    const report = await saveField(
      editRequest("glossary", "file-ownership", "definition", before, after),
      {
        root,
        guardsFor: () => [],
        buildSnapshot: () => Promise.reject(new Error("fixture render red")),
      },
    );
    assert(!report.ok && report.stage === "render" && report.restored);
    assertEquals(await Deno.readTextFile(registryPath), beforeBytes);
    assertEquals(
      await Deno.readTextFile(join(root, GLOSSARY_MAP_REL)),
      mapBytes,
    );
    assertEquals(
      await Deno.readTextFile(join(root, GLOSSARY_MANUAL_REL)),
      manualBytes,
    );
  });
});

Deno.test("a red glossary guard restores the registry and both projections", async () => {
  await withPipelineFixture(async (root) => {
    await installGlossaryProjections(root);
    const registryPath = join(root, "scripts", "glossary_registry.ts");
    const held = new Map<string, string>();
    for (
      const path of [
        registryPath,
        join(root, GLOSSARY_MAP_REL),
        join(root, GLOSSARY_MANUAL_REL),
      ]
    ) {
      held.set(path, await Deno.readTextFile(path));
    }
    const guard = await writeGuard(root, "fixture_glossary_red", false);
    const { before, after } = glossaryDefinitionFixture();
    const report = await saveField(
      editRequest("glossary", "file-ownership", "definition", before, after),
      {
        root,
        guardsFor: () => [guard],
        buildSnapshot: async () =>
          fixtureSnapshot(await glossaryProjectionPages(after)),
        checkProse: () => Promise.resolve({ ok: true }),
      },
    );
    assert(!report.ok && report.stage === "guards" && report.restored);
    for (const [path, bytes] of held) {
      assertEquals(await Deno.readTextFile(path), bytes, path);
    }
  });
});
