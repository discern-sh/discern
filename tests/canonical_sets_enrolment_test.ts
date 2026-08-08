/**
 * Closed-set ENROLMENT guard for the canonical-sets meta-registry — the
 * ADR 0051 parity discipline applied to the discipline itself (ADR 0176,
 * beside `feature_canon_enrolment` and `glossary_enrolment`).
 *
 * Forward: every declared set's single source resolves to a non-empty member
 * list, the atlas renders those members in source order, every declared guard
 * exists and references its source, and every declared artifact is committed
 * with its banner or block markers, enrolled as a codegen target, and canonical
 * under the embedded Markdown formatter — the rewrite loop between the
 * formatter and the generator, cured as a class.
 *
 * Reverse: convention sweeps. Every conventionally named guard test, every
 * codegen write target must be claimed by a declared set or recorded
 * unaffiliated with a reason — exactly one of the two. The pattern's observable
 * footprint cannot grow without enrolling in the pattern's own set.
 *
 * The meta-layer only references the guards it names; none of them run or
 * change here. Synthetic controls prove each predicate discriminates.
 */

import { assert, assertEquals } from "@std/assert";
import { basename, join, relative } from "@std/path";
import {
  CANONICAL_SETS,
  type CanonicalSetEntry,
  codegenWriteTargets,
  CONVENTIONAL_GUARD_SUFFIXES,
  type GeneratedArtifact,
  REGISTRY_ATLAS_PAGE_REL,
  renderRegistryAtlasDoc,
  resolveSetMembers,
  UNAFFILIATED_CODEGEN_TARGETS,
  UNAFFILIATED_GUARDS,
} from "../scripts/canonical_sets.ts";
import { generatedBrandDocuments } from "../scripts/brand_registry.ts";
import { REGISTERS } from "../scripts/brand/model.ts";
import { GLOSSARY } from "../scripts/glossary_registry.ts";
import { allFeatureNodes, SURFACE_SETS } from "../scripts/feature_registry.ts";
import { loadConfig, toCommandList } from "../src/shared/config_schema.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import {
  REGISTRY_ATLAS_REL,
  withoutRegistryAtlasMembers,
} from "./registry_atlas_scan.ts";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const REGISTRY_MODULE = "scripts/canonical_sets.ts";

/** Recognize guard tests by the filename suffixes that trigger automatic enrollment. */
function isConventionalGuard(rel: string): boolean {
  return CONVENTIONAL_GUARD_SUFFIXES.some((suffix) => rel.endsWith(suffix));
}

/** Read an enrolled artifact when committed, leaving absence for the guard to diagnose. */
async function fileText(rel: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(join(REPO_ROOT, rel));
  } catch {
    return undefined;
  }
}

/** All conventionally named guard tests on disk, as `tests/…` paths. */
async function conventionalGuardFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const item of Deno.readDir(join(REPO_ROOT, "tests"))) {
    if (item.isFile && isConventionalGuard(item.name)) {
      files.push(`tests/${item.name}`);
    }
  }
  return files.sort();
}

// --- Predicates, pure over their inputs so the controls can inject fixtures.

/** Sweep offenders: conventional guards neither claimed nor recorded. */
function guardSweepOffenders(
  files: readonly string[],
  entries: readonly CanonicalSetEntry[],
  unaffiliated: Readonly<Record<string, string>>,
): string[] {
  const claimed = new Set(entries.flatMap((entry) => entry.guards));
  const offenders: string[] = [];
  for (const file of files) {
    const isClaimed = claimed.has(file);
    const isRecorded = Object.hasOwn(unaffiliated, file);
    if (!isClaimed && !isRecorded) {
      offenders.push(
        `${file} belongs to no canonical set — claim it from an entry's ` +
          `guards in ${REGISTRY_MODULE}, or record it in UNAFFILIATED_GUARDS ` +
          "with the reason",
      );
    }
    if (isClaimed && isRecorded) {
      offenders.push(
        `${file} is recorded unaffiliated, but an entry claims it — delete ` +
          "the stale record",
      );
    }
  }
  return offenders;
}

/** Artifact offenders for one artifact, given its committed text. */
function artifactOffenders(
  artifact: GeneratedArtifact,
  text: string | undefined,
): string[] {
  if (text === undefined) {
    return [`${artifact.path} is declared but not committed`];
  }
  const offenders: string[] = [];
  if (artifact.kind === "generated-file") {
    if (artifact.banner && !text.includes("GENERATED")) {
      offenders.push(
        `${artifact.path} carries no generated banner — the renderer must ` +
          "stamp one so a reader cannot mistake it for an authored file",
      );
    }
  } else {
    if (
      !text.includes("<!-- BEGIN GENERATED") ||
      !text.includes("<!-- END GENERATED")
    ) {
      offenders.push(
        `${artifact.path} is declared a maintained block but carries no ` +
          "BEGIN/END GENERATED markers",
      );
    }
  }
  return offenders;
}

/** One set's detail section from the generated atlas. */
function atlasSetSection(doc: string, entry: CanonicalSetEntry): string {
  const heading = `## \`${entry.id}\` — ${entry.title}`;
  const start = doc.indexOf(`${heading}\n`);
  assert(start >= 0, `${entry.id}: the atlas carries no detail section`);
  const bodyStart = start + heading.length + 1;
  const nextHeading = doc.indexOf("\n## ", bodyStart);
  return doc.slice(bodyStart, nextHeading < 0 ? doc.length : nextHeading);
}

/** Decode the nested code-span bullets under a section's member count. */
function atlasMemberNames(section: string): string[] {
  const lines = section.split("\n");
  const countLine = lines.findIndex((line) => line.startsWith("- Members:"));
  assert(countLine >= 0, "the atlas section carries no member count");
  const names: string[] = [];
  for (const line of lines.slice(countLine + 1)) {
    if (!line.startsWith("  - ")) break;
    const span = line.slice("  - ".length);
    const fence = span.match(/^`+/)?.[0];
    assert(
      fence !== undefined && span.endsWith(fence),
      `atlas member is not a code span: ${line}`,
    );
    let name = span.slice(fence.length, -fence.length);
    if (name.startsWith(" ") && name.endsWith(" ")) {
      const unpadded = name.slice(1, -1);
      if (unpadded.startsWith("`") || unpadded.endsWith("`")) {
        name = unpadded;
      }
    }
    names.push(name);
  }
  return names;
}

// --- Forward checks: the declarations hold against the live repository.

Deno.test("every declared source resolves to a non-empty member set", async () => {
  const ids = new Set<string>();
  for (const entry of CANONICAL_SETS) {
    assert(!ids.has(entry.id), `duplicate entry id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.source.kind === "module") {
      const source = await fileText(entry.source.module);
      assert(
        source !== undefined,
        `${entry.id}: source module ${entry.source.module} does not exist`,
      );
      assert(
        source.includes(entry.source.exportName),
        `${entry.id}: ${entry.source.module} no longer mentions ` +
          `${entry.source.exportName} — the set moved under the registry`,
      );
      const members = await resolveSetMembers(entry);
      assert(
        members !== undefined && members.length > 0,
        `${entry.id}: the members thunk must resolve a non-empty set`,
      );
      for (const member of members) {
        assert(
          member.length > 0 && member === member.trim() &&
            !member.includes("\n") && !member.includes("\r"),
          `${entry.id}: every atlas member name must be non-empty and fit on one line`,
        );
      }
    } else {
      const text = await fileText(entry.source.path);
      assert(
        text !== undefined,
        `${entry.id}: source file ${entry.source.path} does not exist`,
      );
      assert(
        text.includes(entry.source.mustContain),
        `${entry.id}: ${entry.source.path} no longer contains ` +
          `"${entry.source.mustContain}" — the set moved under the registry`,
      );
    }
  }
});

Deno.test("every members thunk imports the module its source declares", async () => {
  const registryText = await fileText(REGISTRY_MODULE);
  assert(registryText !== undefined, `${REGISTRY_MODULE} must exist`);
  for (const entry of CANONICAL_SETS) {
    if (entry.source.kind !== "module") continue;
    if (entry.source.module === REGISTRY_MODULE) continue;
    const asSrc = `"../${entry.source.module}"`;
    const asSibling = `"./${basename(entry.source.module)}"`;
    // A source under scripts/ may live in a subdirectory (scripts/brand/…);
    // the thunk then imports it relative to the registry's own directory.
    const asScriptsChild = `"./${relative("scripts", entry.source.module)}"`;
    assert(
      registryText.includes(asSrc) || registryText.includes(asSibling) ||
        registryText.includes(asScriptsChild),
      `${entry.id}: no import of ${entry.source.module} in ` +
        `${REGISTRY_MODULE} — the source declaration and the members thunk ` +
        "have drifted apart",
    );
  }
});

Deno.test("every declared guard exists, and one per set references its source", async () => {
  for (const entry of CANONICAL_SETS) {
    let referencesSource = entry.source.kind !== "module";
    for (const guard of entry.guards) {
      const text = await fileText(guard);
      assert(
        text !== undefined,
        `${entry.id}: declared guard ${guard} does not exist`,
      );
      if (
        entry.source.kind === "module" &&
        (text.includes(entry.source.module) ||
          text.includes(entry.source.exportName))
      ) {
        referencesSource = true;
      }
    }
    assert(
      referencesSource,
      `${entry.id}: no declared guard references ` +
        `${
          entry.source.kind === "module" ? entry.source.module : "the source"
        }` +
        " — the guards listed cannot be holding this set",
    );
  }
});

Deno.test("every declared artifact is committed with its banner or markers", async () => {
  const offenders: string[] = [];
  for (const entry of CANONICAL_SETS) {
    for (const artifact of entry.artifacts) {
      offenders.push(
        ...artifactOffenders(artifact, await fileText(artifact.path)),
      );
    }
  }
  assertEquals(
    offenders,
    [],
    `artifact declarations out of step with the tree:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("every generated map page is tidy-canonical", async () => {
  const candidates = CANONICAL_SETS.flatMap((entry) =>
    entry.artifacts.filter((artifact) =>
      artifact.kind === "generated-file" &&
      artifact.path.endsWith(".md")
    ).map((artifact) => artifact.path)
  );
  const offenders: string[] = [];
  for (const candidate of candidates) {
    const path = join(REPO_ROOT, candidate);
    const before = await Deno.readTextFile(path);
    if (await formatMarkdownText(path, before) !== before) {
      offenders.push(candidate);
    }
  }
  assertEquals(
    offenders,
    [],
    "generated Markdown must leave codegen already tidy-canonical; route every " +
      `Markdown write through the codegen chokepoint:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("codegen writes only through the enrolled chokepoint", async () => {
  const text = await fileText("scripts/codegen.ts");
  assert(text !== undefined, "scripts/codegen.ts must exist");
  const directWrites = text.split("Deno.writeTextFile").length - 1;
  assertEquals(
    directWrites,
    1,
    "scripts/codegen.ts must write only through its write() helper, where " +
      "the meta-registry membership check lives",
  );
  assert(
    text.includes("codegenWriteTargets()"),
    "scripts/codegen.ts no longer consults codegenWriteTargets() — the " +
      "write chokepoint lost its membership check",
  );
  assert(
    text.includes("formatMarkdownText(path, text)"),
    "scripts/codegen.ts no longer formats Markdown at the write chokepoint",
  );
  const writeCalls = text.split("await write(").length - 1;
  // A registry-driven loop writes several enrolled targets through one
  // textual call site: subtract each loop's target count, add back its call.
  const loopTargets = generatedBrandDocuments().length + REGISTERS.length;
  const loops = 2; // the brand-document loop and the voice-skill loop
  assertEquals(
    writeCalls,
    codegenWriteTargets().size - loopTargets + loops,
    "codegen write calls and enrolled targets have drifted apart — declare " +
      `the new target in ${REGISTRY_MODULE} (or remove the stale entry)`,
  );
});

// --- Reverse sweeps: the pattern's footprint cannot grow without enrolling.

Deno.test("every conventionally named test is claimed or recorded unaffiliated", async () => {
  const files = await conventionalGuardFiles();
  const offenders = guardSweepOffenders(
    files,
    CANONICAL_SETS,
    UNAFFILIATED_GUARDS,
  );
  const onDisk = new Set(files);
  for (const [file, reason] of Object.entries(UNAFFILIATED_GUARDS)) {
    if (!onDisk.has(file)) {
      offenders.push(
        `${file} is recorded unaffiliated but does not exist — delete the ` +
          "stale record",
      );
    }
    if (reason.trim().length === 0) {
      offenders.push(`${file}: an unaffiliated record carries its reason`);
    }
  }
  assertEquals(
    offenders,
    [],
    `the guard-test convention sweep found strays:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("every recorded codegen stray carries a reason and is still written", async () => {
  const codegenText = await fileText("scripts/codegen.ts");
  assert(codegenText !== undefined, "scripts/codegen.ts must exist");
  const claimed = new Set(
    CANONICAL_SETS.flatMap((entry) =>
      entry.artifacts.map((artifact) => artifact.path)
    ),
  );
  for (const [path, reason] of Object.entries(UNAFFILIATED_CODEGEN_TARGETS)) {
    assert(
      reason.trim().length > 0,
      `${path}: an unaffiliated codegen record carries its reason`,
    );
    assert(
      !claimed.has(path),
      `${path} is recorded unaffiliated, but an entry claims it — delete ` +
        "the stale record",
    );
    assert(
      codegenText.includes(`"${path}"`),
      `${path} is recorded as a codegen target but scripts/codegen.ts no ` +
        "longer writes it — delete the stale record",
    );
  }
});

Deno.test("[generated.codegen] declares exactly the whole-file codegen targets", async () => {
  const config = await loadConfig(REPO_ROOT);
  const group = resolveGeneratedGroups(config).find((candidate) =>
    candidate.name === "codegen"
  );
  assert(
    group !== undefined,
    "discern.toml no longer declares [generated.codegen] — the gate's " +
      "build-stage regeneration and update's conflict resolution both hang " +
      "off that declaration",
  );
  const wholeFile = new Set(Object.keys(UNAFFILIATED_CODEGEN_TARGETS));
  for (const entry of CANONICAL_SETS) {
    for (const artifact of entry.artifacts) {
      if (artifact.kind === "generated-file") {
        wholeFile.add(artifact.path);
      }
    }
  }
  assertEquals(
    [...group.paths].sort(),
    [...wholeFile].sort(),
    "discern.toml's [generated.codegen].paths and the meta-registry's " +
      "whole-file write targets have drifted apart — declare the artifact in " +
      "both places, or delete the stale path. Maintained-block pages stay " +
      "undeclared: they are part-authored, so update must never resolve " +
      "their conflicts by regeneration",
  );
  assertEquals(
    group.run,
    "deno task codegen",
    "[generated.codegen].run and the write chokepoint have drifted apart",
  );
  assert(
    !toCommandList(config.jobs.build).includes(group.run),
    "[jobs].build still carries the codegen command — the generated group " +
      "already runs it in the build stage, so the gate would pay it twice",
  );
});

// --- Enrolments: every reference names a live member of the enrolling registry.

Deno.test("enrolments reference live glossary terms, surface sets, and canon nodes", () => {
  const terms = new Set(GLOSSARY.map((entry) => entry.term));
  const nodeIds = new Set(allFeatureNodes().map((flat) => flat.node.id));
  const surfaceClaims = new Map<string, string>();
  const offenders: string[] = [];
  for (const entry of CANONICAL_SETS) {
    const glossary = entry.enrolledIn.glossary;
    if ("term" in glossary && !terms.has(glossary.term)) {
      offenders.push(
        `${entry.id}: glossary enrolment names "${glossary.term}", not a ` +
          "live term",
      );
    }
    if ("perMember" in glossary && !entry.guards.includes(glossary.perMember)) {
      offenders.push(
        `${entry.id}: per-member glossary enrolment cites ` +
          `${glossary.perMember}, which the entry does not declare as a guard`,
      );
    }
    const canon = entry.enrolledIn.featureCanon;
    if ("surfaceSet" in canon) {
      if (!(SURFACE_SETS as readonly string[]).includes(canon.surfaceSet)) {
        offenders.push(
          `${entry.id}: canon enrolment names surface set ` +
            `"${canon.surfaceSet}", which the canon does not define`,
        );
      } else if (surfaceClaims.has(canon.surfaceSet)) {
        offenders.push(
          `${entry.id}: surface set "${canon.surfaceSet}" is already ` +
            `enrolled by ${surfaceClaims.get(canon.surfaceSet)}`,
        );
      } else {
        surfaceClaims.set(canon.surfaceSet, entry.id);
      }
    }
    if ("nodeId" in canon && !nodeIds.has(canon.nodeId)) {
      offenders.push(
        `${entry.id}: canon enrolment names node "${canon.nodeId}", not a ` +
          "live node",
      );
    }
  }
  for (const set of SURFACE_SETS) {
    if (!surfaceClaims.has(set)) {
      offenders.push(
        `the canon's "${set}" surface set is enrolled by no canonical-set ` +
          "entry — the two registries have drifted apart",
      );
    }
  }
  assertEquals(
    offenders,
    [],
    `enrolment references out of step:\n  ${offenders.join("\n  ")}`,
  );
});

// --- Self-enrolment and the atlas.

Deno.test("the meta-registry enrols itself", () => {
  const self = CANONICAL_SETS.find((entry) => entry.id === "canonical-sets");
  assert(self !== undefined, "the meta-registry must declare itself");
  assert(
    self.guards.includes("tests/canonical_sets_enrolment_test.ts"),
    "the self entry must declare this guard",
  );
  assert(
    self.artifacts.some((artifact) =>
      artifact.path.endsWith(REGISTRY_ATLAS_PAGE_REL)
    ),
    "the self entry must declare the registry atlas as its artifact",
  );
});

Deno.test("the registry atlas lists every resolvable member in source order", async () => {
  const doc = await renderRegistryAtlasDoc();
  for (const entry of CANONICAL_SETS) {
    const section = atlasSetSection(doc, entry);
    const members = await resolveSetMembers(entry);
    if (members === undefined) {
      assert(
        section.includes(
          "- Members: — (the authored source does not expose member names to codegen)",
        ),
        `${entry.id}: the atlas does not explain why member names are unavailable`,
      );
      assertEquals(
        atlasMemberNames(section),
        [],
        `${entry.id}: a set without a member reader cannot render member names`,
      );
      continue;
    }
    assert(
      section.includes(`- Members: ${members.length}`),
      `${entry.id}: the atlas count does not match the source`,
    );
    assertEquals(
      atlasMemberNames(section),
      members,
      `${entry.id}: the atlas member names have drifted from the source`,
    );
  }
});

Deno.test("control: semantic scans ignore member names and keep atlas prose", () => {
  const retired = ["`", "in", "it", "`"].join("");
  const skillLike = "discern-future-token";
  const doc = [
    "## `control` — Control",
    "",
    `Prose still names ${skillLike}.`,
    "",
    "- Members: 2",
    `  - ${retired}`,
    `  - \`${skillLike}\``,
    "- Guards: `tests/control_test.ts`",
  ].join("\n");
  assertEquals(
    withoutRegistryAtlasMembers(REGISTRY_ATLAS_REL, doc),
    [
      "## `control` — Control",
      "",
      `Prose still names ${skillLike}.`,
      "",
      "- Members: 2",
      "",
      "",
      "- Guards: `tests/control_test.ts`",
    ].join("\n"),
  );
  assertEquals(
    withoutRegistryAtlasMembers("project/map/elsewhere.md", doc),
    doc,
    "the projection must leave every other file byte-for-byte unchanged",
  );
});

Deno.test("the committed registry atlas matches the renderer", async () => {
  const rel = join(REPO_AUTHORED_PATHS.mapRel, REGISTRY_ATLAS_PAGE_REL);
  const path = join(REPO_ROOT, rel);
  const committed = await fileText(rel);
  assert(committed !== undefined, "the registry atlas page is not committed");
  assertEquals(
    committed,
    await canonicalGeneratedMarkdown(path, await renderRegistryAtlasDoc()),
    "the committed registry atlas has drifted from the meta-registry — run " +
      "`deno task codegen` and commit the result",
  );
});

// --- Positive controls: prove the predicates discriminate, so the guard
// cannot rot into a sweep that passes because nothing looks enrolled.

const CONTROL_ENTRY: CanonicalSetEntry = {
  id: "control",
  title: "Control",
  what: "A fixture.",
  source: { kind: "module", module: "src/none.ts", exportName: "NONE" },
  guards: ["tests/control_parity_test.ts"],
  artifacts: [
    {
      path: "project/map/70-reference/control.md",
      kind: "generated-file",
      banner: true,
    },
  ],
  enrolledIn: {
    glossary: { absent: "a fixture" },
    featureCanon: { absent: "a fixture" },
  },
};

Deno.test("control: an unclaimed conventional test and a stale record both fail the sweep", () => {
  const strays = guardSweepOffenders(
    ["tests/future_enrolment_test.ts"],
    [CONTROL_ENTRY],
    {},
  );
  assertEquals(strays.length, 1, "an unclaimed conventional test must offend");
  const stale = guardSweepOffenders(
    ["tests/control_parity_test.ts"],
    [CONTROL_ENTRY],
    { "tests/control_parity_test.ts": "also recorded" },
  );
  assertEquals(stale.length, 1, "claimed-and-recorded must offend");
});

Deno.test("control: a bannerless artifact and a markerless block both offend", () => {
  assertEquals(
    artifactOffenders(
      { path: "x.md", kind: "generated-file", banner: true },
      "no banner here",
    ).length,
    1,
    "a missing banner must offend",
  );
  assertEquals(
    artifactOffenders({ path: "x.md", kind: "maintained-block" }, "plain page")
      .length,
    1,
    "missing block markers must offend",
  );
  assertEquals(
    artifactOffenders(
      { path: "x.md", kind: "generated-file", banner: true },
      undefined,
    ).length,
    1,
    "an uncommitted artifact must offend",
  );
});
