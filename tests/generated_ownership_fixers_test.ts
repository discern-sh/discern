/**
 * Class guard: no discern fixer writes a path a `[generated.<name>]` group
 * owns. A fixer rewrites a file someone else authored to converge it on a
 * discern convention, so on a generator-owned file every rewrite is undone by
 * the next regeneration and fails the gate as drift.
 *
 * The fixers are enumerated from their planners: every `discern tidy` type in
 * {@link TIDY_TYPES}, and every effect the complete refresh plan carries. The
 * fixture hands every authored source surface in the paths registry, plus the
 * config, to one generator, through live references where the surface has one,
 * so a new surface or tidy type enrolls without editing this file. A control
 * run without the generator proves each enumerated fixer would otherwise write
 * an owned path, so the guard cannot pass vacuously.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { dirname, join, relative, SEPARATOR } from "@std/path";
import { planTidy, TIDY_TYPES } from "../src/engine/tidy/tidy.ts";
import { planRefresh } from "../src/engine/tracked_refresh.ts";
import { resolveInstructionSources } from "../src/lib/paths.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { CONFIG_REL } from "../src/shared/env.ts";
import {
  generatedGroupForPath,
  resolveGeneratedGroups,
} from "../src/shared/generated_artifacts.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { sourcePathReference } from "../src/shared/source_path_references.ts";
import { resolveSourcePaths } from "../src/shared/source_path_resolution.ts";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

const EXTRA_SOURCE = "external/guidance.md";

/** Markdown every tidy convention rewrites: no blank line, padded bullet. */
const UNTIDY_MARKDOWN = "# Owned page\nIntro:\n-   item\n";

/** Write a file, creating its parent directories. */
async function write(root: string, rel: string, text: string): Promise<void> {
  await ensureDir(dirname(join(root, rel)));
  await Deno.writeTextFile(join(root, rel), text);
}

/** The base project: two instruction sources and an untidy TOML table. */
function baseConfig(): string[] {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[instructions]",
    `sources = ["discern/instructions.md", ${JSON.stringify(EXTRA_SOURCE)}]`,
    "",
  ];
}

/** One ownership pattern per authored surface, preferring its live reference. */
function ownershipPatterns(): string[] {
  const patterns = Object.entries(SOURCE_PATHS).map(([name, entry]) => {
    const reference = sourcePathReference(name as keyof typeof SOURCE_PATHS);
    const base = reference ?? entry.defaultPath;
    return entry.pathKind === "directory" ? `${base}/**` : base;
  });
  return [...patterns, EXTRA_SOURCE, CONFIG_REL];
}

/** Seed untidy bytes into every Markdown surface plus a stale ADR index. */
async function seedFixerInputs(root: string, owned: boolean): Promise<void> {
  await writeConfig(root, baseConfig().join("\n"));
  // Appended raw and unspaced, past the canonical config writer, so that
  // `discern tidy toml` has a rewrite to make in both variants.
  const [name, paths] = owned
    ? ["everything", ownershipPatterns()]
    : ["unrelated", ["unrelated/**"]];
  await Deno.writeTextFile(
    join(root, CONFIG_REL),
    `\n[generated.${name}]\npaths=${JSON.stringify(paths)}\nrun="true"\n`,
    { append: true },
  );
  const config = await loadConfig(root);
  for (const source of await resolveInstructionSources(root, config)) {
    await write(root, relative(root, source), UNTIDY_MARKDOWN);
  }
  for (const surface of resolveSourcePaths(config)) {
    if (surface.name === "map") {
      await write(root, join(surface.path, "README.md"), UNTIDY_MARKDOWN);
      await write(
        root,
        join(surface.path, "_adr", "README.md"),
        [
          "# Decisions",
          "",
          "<!-- BEGIN GENERATED: current ADR records -->",
          "",
          "<!-- END GENERATED: current ADR records -->",
          "",
        ].join("\n"),
      );
      await write(
        root,
        join(surface.path, "_adr", "0001-first-choice.md"),
        "# ADR 0001: A first choice\n",
      );
    } else if (surface.name === "todo") {
      await write(root, surface.path, UNTIDY_MARKDOWN);
    }
  }
}

/** Every root-relative path one fixer's plan would change, by fixer name. */
async function fixerWrites(root: string): Promise<Map<string, string[]>> {
  const writes = new Map<string, string[]>();
  for (const type of TIDY_TYPES) {
    const plan = await planTidy(root, type);
    writes.set(
      `tidy ${type}`,
      plan.changes.map((change) =>
        relative(root, change.abs).replaceAll(SEPARATOR, "/")
      ),
    );
  }
  const refresh = await planRefresh(root, { reconcileProofNotesFetch: false });
  writes.set(
    "refresh",
    refresh.effects.flatMap((effect) => {
      if (effect.type === "file") {
        const { operation } = effect;
        return operation.bytesChanged || operation.modeChanged
          ? [effect.target]
          : [];
      }
      return effect.type === "skill" ? [effect.target] : [];
    }),
  );
  return writes;
}

Deno.test("no discern fixer writes a path a [generated] group owns", async () => {
  await withTempDir(async (control) => {
    await scaffoldEngine(control);
    await seedFixerInputs(control, false);
    await withTempDir(async (owned) => {
      await scaffoldEngine(owned);
      await seedFixerInputs(owned, true);
      const groups = resolveGeneratedGroups(await loadConfig(owned));
      const controlWrites = await fixerWrites(control);
      const ownedWrites = await fixerWrites(owned);
      assertEquals([...ownedWrites.keys()], [...controlWrites.keys()]);

      for (const [fixer, paths] of controlWrites) {
        assert(
          paths.some((path) => generatedGroupForPath(groups, path)),
          `${fixer}: the control fixture must give this fixer an owned path to write; extend seedFixerInputs (wrote ${
            JSON.stringify(paths)
          })`,
        );
      }
      for (const [fixer, paths] of ownedWrites) {
        assertEquals(
          paths.filter((path) => generatedGroupForPath(groups, path)),
          [],
          `${fixer} must leave generator-owned paths to their generator`,
        );
      }
    });
  });
});

Deno.test("prepare then done stay green when a generator owns untidy map pages and the ADR index", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        ...baseConfig(),
        "[jobs]",
        'format = "discern tidy"',
        "",
        "[generated.external]",
        `paths = [${JSON.stringify(EXTRA_SOURCE)}, "\${map.dir}/**"]`,
        `run = ${
          JSON.stringify(
            `mkdir -p external && cp source/guidance.md ${EXTRA_SOURCE} && rm -rf discern/map && cp -R source/map discern/map`,
          )
        }`,
        "",
      ].join("\n"),
    );
    await write(
      dir,
      "discern/instructions.md",
      "# Project policy\n\nKeep generated context current.\n",
    );
    await write(dir, "source/guidance.md", UNTIDY_MARKDOWN);
    await write(dir, "source/map/README.md", UNTIDY_MARKDOWN);
    await write(
      dir,
      "source/map/_adr/README.md",
      [
        "# Decisions",
        "",
        "<!-- BEGIN GENERATED: current ADR records -->",
        "",
        "<!-- END GENERATED: current ADR records -->",
        "",
      ].join("\n"),
    );
    await write(
      dir,
      "source/map/_adr/0001-first-choice.md",
      "# ADR 0001: A first choice\n",
    );
    await gitInit(dir);

    const prepare = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prepare.code, 0, prepare.output);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "Converge generated artifacts");

    const done = await runAgent(dir, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    for (const path of [EXTRA_SOURCE, "discern/map/README.md"]) {
      assertEquals(
        await Deno.readTextFile(join(dir, path)),
        UNTIDY_MARKDOWN,
        `${path} keeps its generator's bytes`,
      );
    }
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      "discern/map/** merge=discern-generated",
      "the slash-separated directory reference carries its merge rule",
    );
    const status = await new Deno.Command("git", {
      args: ["status", "--porcelain"],
      cwd: dir,
      stdout: "piped",
    }).output();
    assertEquals(new TextDecoder().decode(status.stdout), "");
  });
});
