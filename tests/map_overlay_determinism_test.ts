/**
 * The private-overlay determinism guard: no measured map value may depend on
 * whether `project/map/_private/` content is present. After the launch scrub
 * that tree becomes a local, gitignored overlay — present in the owner's
 * checkouts, absent from a contributor's clean clone — so a disk-walking map
 * check that counted its content would make the same commit measure
 * differently across machines.
 *
 * Two layers, so the class stays cured rather than the instances:
 *
 *  1. a FORCING FUNCTION over the live config: every `[jobs]`, `[standards]`,
 *     and scope-gate command that reads the configured map directory must have
 *     an overlay adapter registered here — a new map-measuring check enrols
 *     the moment its command names `${map.dir}`, or this test fails naming it;
 *  2. the GUARD, parameterised over the adapters: each check measures a
 *     fixture map twice — without `_private`, then with poison content under
 *     `_private/` built to move every number — and both measurements must be
 *     identical. A bite proof plants the same poison in a visible section and
 *     requires the measurement to change, so the poison can never rot into a
 *     vacuous fixture.
 *
 * The shipped map-integrity preflight walks the map inside every project's
 * gate without a config command naming it, so it is enrolled unconditionally.
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  loadConfig,
  parseConfigOrThrow,
  toCommandList,
} from "../src/shared/config_schema.ts";
import { normalizeMapDir } from "../src/shared/map_path.ts";
import { expandSourcePathReferences } from "../src/shared/source_path_references.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { MAP_SECTION_REGISTRY } from "../src/lib/paths.ts";
import { checkDocsIntegrity } from "../src/lib/map_integrity.ts";
import { measureVocabSignals } from "../scripts/vocab_signals_lib.ts";
import { withStagedProseInput } from "../scripts/prose_lib.ts";
import type { GlossaryEntry } from "../scripts/glossary_registry.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";

const MAP = SOURCE_PATHS.map.defaultPath.replace(/\/$/, "");

/** A public-audience section name, from the manual registry it must exist in. */
const PUBLIC_SECTION =
  MAP_SECTION_REGISTRY.find((section) => section.audience === "project")?.dir ??
    "";

/** The fixture glossary: Widget is used by the baseline, Sprocket is dead. */
const GLOSSARY_FIXTURE = [
  { term: "Widget", plain: { phrase: "widget" }, definition: "A part." },
  { term: "Sprocket", plain: { phrase: "sprocket" }, definition: "A gear." },
] as const satisfies readonly GlossaryEntry[];

/**
 * Content built to move every adapter's number if it were counted: it
 * references the dead term, restates the live one bold-faced, adds prose
 * words, adds a non-README leaf, and carries a dead link, a dead anchor, a
 * stale fenced command, and an unknown-skill citation.
 */
const POISON = [
  "# Poison",
  "",
  "A Sprocket appears, and **Widget** — restated boldly.",
  "",
  "Prose words to swell every word count in the corpus.",
  "",
  "A [dead link](nowhere-at-all.md) and a [dead anchor](#no-heading).",
  "",
  "```sh",
  "discern frobnicate",
  "```",
  "",
  "Reach for the `discern-made-up-skill` skill here.",
  "",
].join("\n");

/** Scaffold the baseline fixture map under a temp project root. */
async function writeBaseline(root: string): Promise<void> {
  assert(
    PUBLIC_SECTION !== "",
    "the manual registry lists no public section for the fixture to use",
  );
  const files: Record<string, string> = {
    [`${MAP}/README.md`]: [
      "# Map",
      "",
      "A Widget turns; see the [guide](" + PUBLIC_SECTION + "/guide.md#setup).",
      "",
    ].join("\n"),
    [`${MAP}/${PUBLIC_SECTION}/guide.md`]: [
      "# Guide",
      "",
      "## Setup",
      "",
      "Baseline prose about the Widget.",
      "",
    ].join("\n"),
  };
  for (const [rel, content] of Object.entries(files)) {
    await ensureDir(join(root, dirname(rel)));
    await Deno.writeTextFile(join(root, rel), content);
  }
}

/** One overlay adapter: measure a fixture map into a comparable value. */
type OverlayAdapter = (root: string) => Promise<unknown>;

const vocabularyAdapter: OverlayAdapter = async (root) =>
  await measureVocabSignals(join(root, MAP), GLOSSARY_FIXTURE);

const proseAdapter: OverlayAdapter = async (root) => {
  return await withStagedProseInput(join(root, MAP), async (stage) => {
    const collect = async (dir: string, rel: string): Promise<string[]> => {
      const out: string[] = [];
      for await (const entry of Deno.readDir(dir)) {
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory) {
          out.push(...await collect(join(dir, entry.name), childRel));
        } else {
          out.push(childRel);
        }
      }
      return out;
    };
    const files = (await collect(stage.dir, "")).sort();
    return { words: stage.words, files };
  });
};

const integrityAdapter: OverlayAdapter = async (root) => {
  const findings = await checkDocsIntegrity(
    root,
    parseConfigOrThrow(""),
    TEST_CLI_MODEL(),
  );
  return findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.detail}`);
};

/**
 * Every map-measuring check, keyed by the config entry (or built-in) that
 * runs it. The forcing function below keeps this table complete.
 */
const OVERLAY_ADAPTERS: Record<string, OverlayAdapter> = {
  "jobs.prose": proseAdapter,
  "standards.prose": proseAdapter,
  "standards.vocabulary": vocabularyAdapter,
  "map-integrity-preflight": integrityAdapter,
};

Deno.test("every configured command that reads the map has an overlay adapter", async () => {
  const config = await loadConfig(REPO_ROOT);
  const mapDir = normalizeMapDir(config.map.dir);
  const readsMap = (value: Parameters<typeof toCommandList>[0]): boolean =>
    toCommandList(value).some((command) =>
      expandSourcePathReferences(command, config).includes(mapDir)
    );

  const required: string[] = [];
  for (const [name, job] of Object.entries(config.jobs)) {
    if (readsMap(job)) required.push(`jobs.${name}`);
  }
  for (const [name, standard] of Object.entries(config.standards)) {
    if (readsMap(standard.run)) required.push(`standards.${name}`);
  }
  for (const [name, scope] of Object.entries(config.scopes)) {
    if (readsMap(scope.gate)) required.push(`scopes.${name}`);
  }
  assert(required.length > 0, "the map-measuring checks went missing entirely");
  for (const name of required) {
    assert(
      name in OVERLAY_ADAPTERS,
      `${name} reads the configured map directory but has no overlay ` +
        "adapter in tests/map_overlay_determinism_test.ts — register one so " +
        "its measurement is proven independent of local `_private` content",
    );
  }
});

Deno.test("no map measurement changes when `_private` content appears", async () => {
  for (const [name, adapter] of Object.entries(OVERLAY_ADAPTERS)) {
    await withTempDir(async (root) => {
      await writeBaseline(root);
      const without = await adapter(root);

      const overlay = join(root, MAP, "_private", "notes.md");
      await ensureDir(dirname(overlay));
      await Deno.writeTextFile(overlay, POISON);
      const withOverlay = await adapter(root);

      assertEquals(
        withOverlay,
        without,
        `${name}: the measurement depends on \`_private\` content — the same ` +
          "commit would measure differently on a checkout carrying the " +
          "private overlay",
      );
    });
  }
});

Deno.test("the poison has teeth: the same content in a visible section moves every measurement", async () => {
  for (const [name, adapter] of Object.entries(OVERLAY_ADAPTERS)) {
    await withTempDir(async (root) => {
      await writeBaseline(root);
      const before = await adapter(root);

      const visible = join(root, MAP, PUBLIC_SECTION, "poison.md");
      await Deno.writeTextFile(visible, POISON);
      const after = await adapter(root);

      assertNotEquals(
        JSON.stringify(after),
        JSON.stringify(before),
        `${name}: the poison fixture no longer moves this measurement, so ` +
          "the determinism guard above it is vacuous — rebuild the poison",
      );
    });
  }
});
