/**
 * The pen's discipline. The patcher refuses everything but a plain
 * string-literal prose field and edits nothing but that literal; the
 * save-and-prove pipeline leaves a proven save coherent on disk and rolls an
 * unprovable one back to the exact prior bytes. The two mutation tests below
 * run against the real tree — a no-op save (same value) and a red-guard
 * rollback — and restore the bytes they touched in `finally`, belt and
 * braces beside the pipeline's own rollback.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { Node, Project } from "ts-morph";
import {
  patchRegistrySource,
  proseValueIssue,
} from "../scripts/scriptorium/patch.ts";
import { saveField, spawnSnapshot } from "../scripts/scriptorium/pipeline.ts";
import { buildSnapshot } from "../scripts/scriptorium/snapshot.ts";
import { MARK_OPEN } from "../scripts/scriptorium/annotation.ts";
import { REPO_ROOT } from "../scripts/scriptorium/root.ts";
import { allFeatureNodes } from "../scripts/feature_registry.ts";
import { PRACTICE_CANON } from "../scripts/practice_registry.ts";

const FEATURE_FILE = join(REPO_ROOT, "scripts", "feature_registry.ts");

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

Deno.test("the patcher refuses everything but editable prose literals", () => {
  const cases: readonly {
    registry: "feature" | "glossary";
    slug: string;
    field: string;
    expect: RegExp;
  }[] = [
    { registry: "feature", slug: "proof", field: "id", expect: /locked/ },
    {
      registry: "feature",
      slug: "proof",
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
      expect: /no studio semantics/,
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
  ];
  for (const row of cases) {
    const outcome = patchRegistrySource(REPO_ROOT, {
      registry: row.registry,
      slug: row.slug,
      field: row.field,
      value: "A replacement sentence.",
    });
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
  const outcome = patchRegistrySource(REPO_ROOT, {
    registry: "feature",
    slug: "proof",
    field: "why",
    value,
  });
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

Deno.test("preview mode proves the patch without touching the tree", async () => {
  const before = await Deno.readTextFile(FEATURE_FILE);
  const report = await saveField(
    {
      registry: "feature",
      slug: "proof",
      field: "why",
      value: liveFieldValue("proof", "why") + " Previewed.",
    },
    {
      root: REPO_ROOT,
      guardsFor: () => [],
      buildSnapshot,
      apply: false,
    },
  );
  assert(report.ok);
  assertEquals(report.applied, false);
  assertEquals(report.registryChanged, true);
  assertEquals(await Deno.readTextFile(FEATURE_FILE), before);
});

Deno.test("a no-op save proves itself and leaves identical bytes", async () => {
  const before = await Deno.readTextFile(FEATURE_FILE);
  try {
    const report = await saveField(
      {
        registry: "feature",
        slug: "proof",
        field: "why",
        value: liveFieldValue("proof", "why"),
      },
      {
        root: REPO_ROOT,
        guardsFor: () => ["tests/feature_canon_plain_register_test.ts"],
        buildSnapshot: () => spawnSnapshot(REPO_ROOT),
      },
    );
    assert(report.ok, "an identical value must prove green");
    assert(report.applied);
    assertEquals(report.pages.length, 0, "no page moved for a no-op");
    assertEquals(report.guards?.ok, true);
    assertEquals(report.twin, "plain.why");
  } finally {
    await Deno.writeTextFile(FEATURE_FILE, before);
  }
  assertEquals(await Deno.readTextFile(FEATURE_FILE), before);
});

Deno.test("a red guard rolls the whole save back", async () => {
  const before = await Deno.readTextFile(FEATURE_FILE);
  const pagePath = join(
    REPO_ROOT,
    "project",
    "map",
    "_internal",
    "feature-canon.md",
  );
  const pageBefore = await Deno.readTextFile(pagePath);
  try {
    const report = await saveField(
      {
        registry: "feature",
        slug: "proof",
        field: "why",
        value: liveFieldValue("proof", "why") + " This must not survive.",
      },
      {
        root: REPO_ROOT,
        guardsFor: () => ["tests/scriptorium_this_guard_does_not_exist.ts"],
        buildSnapshot: () => spawnSnapshot(REPO_ROOT),
      },
    );
    assert(!report.ok, "a red guard must refuse the save");
    assertEquals(report.ok === false && report.stage, "guards");
    assert(
      report.ok === false && report.restored === true,
      "the report says the held bytes were restored",
    );
  } finally {
    await Deno.writeTextFile(FEATURE_FILE, before);
    await Deno.writeTextFile(pagePath, pageBefore);
  }
  assertEquals(
    await Deno.readTextFile(FEATURE_FILE),
    before,
    "the registry rolled back to its exact prior bytes",
  );
  assertEquals(await Deno.readTextFile(pagePath), pageBefore);
});

Deno.test("a save the gate's prose voice refuses rolls back", async () => {
  // A tenet obligation renders as paragraph prose on two pages, where the
  // voice rules bite; the exclamation must red the prose stage, not guards.
  const registryPath = join(REPO_ROOT, "scripts", "practice_registry.ts");
  const before = await Deno.readTextFile(registryPath);
  const held = new Map<string, string>();
  for (
    const rel of [
      ["project", "map", "_internal", "practice-canon.md"],
      ["project", "map", "00-orientation", "the-practice.md"],
    ]
  ) {
    const path = join(REPO_ROOT, ...rel);
    held.set(path, await Deno.readTextFile(path));
  }
  const tenet = PRACTICE_CANON.find((item) => item.id === "arrive-knowing");
  assert(tenet !== undefined, "the probed tenet should exist");
  try {
    const report = await saveField(
      {
        registry: "practice",
        slug: "arrive-knowing",
        field: "obligation",
        value: tenet.obligation + " Surprise, it works!",
      },
      {
        root: REPO_ROOT,
        guardsFor: () => [],
        buildSnapshot: () => spawnSnapshot(REPO_ROOT),
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
  } finally {
    await Deno.writeTextFile(registryPath, before);
    for (const [path, bytes] of held) await Deno.writeTextFile(path, bytes);
  }
  assertEquals(await Deno.readTextFile(registryPath), before);
  for (const [path, bytes] of held) {
    assertEquals(await Deno.readTextFile(path), bytes);
  }
});
