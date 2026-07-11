/**
 * Recipe-shadow consistency guard (B34) — the four surfaces that decide whether a
 * project recipe collides with a built-in verb must all read the ONE
 * `KNOWN_VERBS` set, so none can advertise or suggest a name the router will
 * refuse:
 *
 *   1. the router's recipe fallthrough (`main.ts` — refuses any KNOWN_VERBS name),
 *   2. the `--help` recipe listing (`printProjectRecipes`),
 *   3. the typo suggester's recipe names (`projectRecipeNames`),
 *   4. the shadow warning (`warnShadowedRecipe`).
 *
 * The regression B34 named was three of these reading a NARROWER set (the engine
 * verbs only), so a recipe named after an INSTALLER verb (doctor, config, help, …)
 * was listed in help as runnable, suggested on a typo, and never warned — yet the
 * router refused it. This drops a recipe for EVERY built-in verb (installer +
 * engine, from the registry so a new verb auto-enrols) and asserts help lists none
 * of them, only the one genuine recipe; then checks the warning fires and the
 * built-in wins for a representative verb from EACH family.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { KNOWN_VERBS } from "../src/main.ts";

/** Write a recipe named `name` (with a `# desc:` line so it is listable) into the
 * project's default recipes dir, echoing a unique marker if it were ever run. */
async function writeRecipe(dir: string, name: string): Promise<void> {
  await writeExecutable(
    join(dir, "discern", "recipes", name),
    `#!/usr/bin/env sh\n# desc: shadow probe ${name}\necho RECIPE-RAN-${name}\n`,
  );
}

Deno.test("no recipe named after ANY built-in verb is listed as runnable in --help (B34)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, ["[project]", 'slug = "shadow"', ""].join("\n"));
    await gitInit(dir);

    // A recipe for every built-in name — installer AND engine — plus one genuine,
    // non-colliding recipe that SHOULD be listed.
    for (const verb of KNOWN_VERBS) {
      await writeRecipe(dir, verb);
    }
    await writeRecipe(dir, "zzz-genuine");

    const help = (await runAgent(dir, ["--help"])).output;
    // The one genuine recipe is listed…
    assertStringIncludes(help, "zzz-genuine");
    // …and NONE of the shadowing names appear in the recipe listing. Scope the check
    // to the "Project recipes" section so a verb's own command row (in the grouped
    // command list above) isn't mistaken for a recipe row.
    const marker = "Project recipes";
    const at = help.indexOf(marker);
    assert(at >= 0, `expected a project-recipe section:\n${help}`);
    const recipeSection = help.slice(at);
    for (const verb of KNOWN_VERBS) {
      assert(
        !recipeSection.includes(`shadow probe ${verb}`),
        `\`discern --help\` listed shadowed recipe "${verb}" as runnable — the ` +
          `listing must exclude every KNOWN_VERBS name, not just the engine subset`,
      );
    }
  });
});

Deno.test("a recipe shadowing an INSTALLER verb warns and the built-in wins (B34)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, ["[project]", 'slug = "shadow"', ""].join("\n"));
    await gitInit(dir);
    // `doctor` is an installer verb — the family the pre-fix warning/listing MISSED.
    await writeRecipe(dir, "doctor");

    const r = await runAgent(dir, ["doctor"]);
    // The shadow warning fires (to stderr)…
    assertStringIncludes(
      r.output,
      'project recipe "doctor" is shadowed by a built-in',
    );
    // …and the built-in doctor ran, NOT the recipe.
    assert(
      !r.output.includes("RECIPE-RAN-doctor"),
      `the shadowing recipe must not run; the built-in wins:\n${r.output}`,
    );
  });
});

Deno.test("a recipe shadowing an ENGINE verb warns and the built-in wins (B34)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, ["[project]", 'slug = "shadow"', ""].join("\n"));
    await gitInit(dir);
    await writeRecipe(dir, "status");

    const r = await runAgent(dir, ["status"]);
    assertStringIncludes(
      r.output,
      'project recipe "status" is shadowed by a built-in',
    );
    assert(
      !r.output.includes("RECIPE-RAN-status"),
      `the shadowing recipe must not run; the built-in wins:\n${r.output}`,
    );
  });
});

Deno.test("a genuine (non-shadowing) recipe still runs and is suggested on a typo", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, ["[project]", 'slug = "shadow"', ""].join("\n"));
    await gitInit(dir);
    await writeRecipe(dir, "deploy");

    // It runs…
    assertStringIncludes(
      (await runAgent(dir, ["deploy"])).output,
      "RECIPE-RAN-deploy",
    );
    // …and a near-miss typo suggests it (the suggester's projectRecipeNames path,
    // which now also filters by KNOWN_VERBS but must keep the genuine recipe).
    const typo = await runAgent(dir, ["deplo"]);
    assertEquals(typo.code, 1);
    assertStringIncludes(typo.output, "deploy");
  });
});

Deno.test("the shadow-warning preflight stays silent when the config can't load, so the verb still runs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A parse-broken discern.toml: loadConfig throws. The shadow-warning preflight
    // runs for every KNOWN_VERBS name (main.ts) BEFORE the verb — installer verbs
    // like `doctor` included, the very tool you reach for WHEN the config is
    // broken. The advisory preflight must not let that throw escape and abort the
    // verb before its own handler renders. A recipe named after the verb is present
    // so the shadow path is fully exercised.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );
    await gitInit(dir);
    await writeRecipe(dir, "doctor");

    const r = await runAgent(dir, ["doctor"]);
    // `doctor`'s own handler renders its report even on a broken config…
    assertStringIncludes(
      r.output,
      "Doctor checks",
      "the advisory shadow preflight must not throw on an unloadable config and " +
        "abort the verb before its handler runs",
    );
    // …and the built-in still wins; the shadowing recipe never runs.
    assert(
      !r.output.includes("RECIPE-RAN-doctor"),
      `the built-in must win even on a broken config:\n${r.output}`,
    );
  });
});
