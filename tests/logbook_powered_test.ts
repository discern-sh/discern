import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  LOGBOOK_POWERED,
  type LogbookPoweredCapability,
  logbookPoweredPhraseList,
} from "../src/shared/logbook_powered.ts";
import { renderManualConfigReferenceDoc } from "../src/shared/config_codegen.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

// These hold every wording surface that explains `[project].logbook = false` to
// the registry in `logbook_powered.ts` (ADR 0160): the hand-authored surfaces —
// the config template's `[project]` comment block, this repo's own
// `discern.toml`, and the logbook reference page — must carry every member's
// phrase verbatim, and the generated schema carries the rendered list by
// construction. A reader census ties the list to the code in both directions,
// so a new logbook reader cannot ship without the opt-out wording naming what
// it would switch off.

const TEMPLATE_REL = "templates/discern.toml.tmpl";
const MAP_PAGE_REL = "70-reference/the-logbook.md";

/** The `[project]` section of a TOML text: its header line up to the next table. */
function projectBlockOf(text: string, file: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf("[project]");
  assert(start !== -1, `${file} has no [project] section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]?.startsWith("[") === true) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The keys of every member whose phrase `text` does not carry verbatim. */
function missingPhrases(
  text: string,
  members: readonly LogbookPoweredCapability[],
): string[] {
  return members.filter((m) => !text.includes(m.phrase)).map((m) => m.key);
}

Deno.test("the registry's keys are unique kebab-case and its members complete", () => {
  const keys = LOGBOOK_POWERED.map((m) => m.key);
  assertEquals(keys.length, new Set(keys).size, "registry keys must be unique");
  for (const member of LOGBOOK_POWERED) {
    assert(
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(member.key),
      `key "${member.key}" must be kebab-case`,
    );
    assert(member.phrase.length > 0, `${member.key} needs a phrase`);
    assert(
      !member.phrase.endsWith("."),
      `${member.key}'s phrase must not end with punctuation — it sits mid-sentence`,
    );
    assert(member.surface.length > 0, `${member.key} needs a surface`);
    assert(
      member.readers.length > 0,
      `${member.key} needs at least one reader`,
    );
  }
});

Deno.test("the config template's [project] block names every logbook-powered capability", async () => {
  const template = await Deno.readTextFile(join(REPO_ROOT, TEMPLATE_REL));
  const missing = missingPhrases(
    projectBlockOf(template, TEMPLATE_REL),
    LOGBOOK_POWERED,
  );
  assertEquals(
    missing,
    [],
    `${TEMPLATE_REL} [project] comment block is missing the phrase for: ` +
      `${missing.join(", ")} — carry each registry phrase verbatim in the ` +
      `logbook comment`,
  );
});

Deno.test("this repo's own discern.toml mirrors the template's logbook wording", async () => {
  const config = await Deno.readTextFile(join(REPO_ROOT, "discern.toml"));
  const missing = missingPhrases(
    projectBlockOf(config, "discern.toml"),
    LOGBOOK_POWERED,
  );
  assertEquals(
    missing,
    [],
    `discern.toml [project] comment block is missing the phrase for: ` +
      `${missing.join(", ")} — mirror the template's logbook comment`,
  );
});

Deno.test("the logbook reference page names every logbook-powered capability", async () => {
  const page = await Deno.readTextFile(
    join(REPO_AUTHORED_PATHS.map, MAP_PAGE_REL),
  );
  const missing = missingPhrases(page, LOGBOOK_POWERED);
  assertEquals(
    missing,
    [],
    `${REPO_AUTHORED_PATHS.mapRel}/${MAP_PAGE_REL} is missing the phrase ` +
      `for: ${missing.join(", ")} — its "What it powers" list carries each ` +
      `registry phrase verbatim`,
  );
});

Deno.test("the generated config reference carries the rendered capability list", () => {
  assertStringIncludes(
    renderManualConfigReferenceDoc(),
    logbookPoweredPhraseList(),
    "the logbook key's describe() must render logbookPoweredPhraseList()",
  );
});

Deno.test("the guard detects a member whose phrase no surface carries", () => {
  const ghost: LogbookPoweredCapability = {
    key: "ghost-capability",
    phrase: "a capability no wording surface mentions",
    surface: "nowhere",
    readers: ["src/engine/status/status.ts"],
  };
  assertEquals(missingPhrases("unrelated wording", [ghost]), [
    "ghost-capability",
  ]);
});

// ── the reader census ───────────────────────────────────────────────────────

/** The modules that define the logbook's read entry points. */
const ENTRY_MODULES = [
  "src/engine/logbook/read.ts",
  "src/engine/logbook/surfaces.ts",
] as const;

/**
 * The logbook subsystem itself — recorder, store, schema, detectors, and the
 * `patterns` verb. Excluded from the file→member census with a stated reason:
 * it is the substrate the capabilities read through, not a consuming surface,
 * and its one consuming verb is enrolled explicitly as `patterns-report`.
 * Members claiming a file here are still verified to call an entry point.
 */
const SUBSTRATE_PREFIX = "src/engine/logbook/";

/** Exported function names of a module — the census's entry-point vocabulary. */
function exportedFunctionNames(moduleText: string): string[] {
  return [...moduleText.matchAll(/^export (?:async )?function (\w+)/gm)]
    .map((m) => m[1] ?? "")
    .filter((name) => name.length > 0);
}

/** Whether `text` calls any of `names` (a bare `name(` call site). */
function callsAny(text: string, names: readonly string[]): boolean {
  return names.some((name) => new RegExp(`\\b${name}\\(`).test(text));
}

Deno.test("every module reading the logbook is claimed by a registry member, and every member reads", async () => {
  const entryNames: string[] = [];
  for (const rel of ENTRY_MODULES) {
    entryNames.push(
      ...exportedFunctionNames(await Deno.readTextFile(join(REPO_ROOT, rel))),
    );
  }
  assert(entryNames.length > 0, "no read entry points found — census is blind");

  // Member → code: each claimed reader exists and actually reads the logbook.
  const authored = new Set(
    await structuralGuardScope({
      guard: "tests/logbook_powered_test.ts#registered-reader-paths",
      universe: "authored-ts",
    }),
  );
  for (const member of LOGBOOK_POWERED) {
    for (const rel of member.readers) {
      assert(
        authored.has(rel),
        `${member.key} claims reader ${rel}, which is not an authored file`,
      );
      assert(
        callsAny(await Deno.readTextFile(join(REPO_ROOT, rel)), entryNames),
        `${member.key} claims reader ${rel}, but it calls no logbook read ` +
          `entry point — remove the member or fix its readers`,
      );
    }
  }

  // Code → member: a consuming module outside the substrate must be claimed.
  const claimed = new Set(LOGBOOK_POWERED.flatMap((m) => m.readers));
  const scanSet = await structuralGuardScope({
    guard: "tests/logbook_powered_test.ts#unclaimed-logbook-readers",
    universe: "authored-ts",
    narrow: {
      reason:
        "The reader registry governs production consumers outside the logbook substrate and its declared entry modules.",
      include: (rel) =>
        rel.startsWith("src/") &&
        !rel.startsWith(SUBSTRATE_PREFIX) &&
        !(ENTRY_MODULES as readonly string[]).includes(rel),
    },
  });
  const unclaimed: string[] = [];
  for (const rel of scanSet) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (callsAny(text, entryNames) && !claimed.has(rel)) {
      unclaimed.push(rel);
    }
  }
  assertEquals(
    unclaimed,
    [],
    `these modules read the logbook but no registry member claims them: ` +
      `${unclaimed.join(", ")} — add or extend a member in ` +
      `src/shared/logbook_powered.ts so the opt-out wording names what they power`,
  );
});

Deno.test("historical archive selection stays confined to the advisory Patterns reader", async () => {
  const callers: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/logbook_powered_test.ts#historical-archive-readers",
      universe: "authored-ts",
      narrow: {
        reason:
          "Historical archive selection is a production-reader rule; the read authority itself defines the selected API.",
        include: (path) =>
          path.startsWith("src/") && path !== "src/engine/logbook/read.ts",
      },
    })
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/\breadLogbookFile\(/.test(text)) {
      callers.push(rel);
    }
  }
  assertEquals(
    callers,
    ["src/engine/logbook/patterns.ts"],
    "only advisory Patterns may select sealed history; status, Gate hints, queue estimates, and work-in-flight readers must stay on active entry points",
  );
});
