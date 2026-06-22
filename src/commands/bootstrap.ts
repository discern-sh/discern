/**
 * `discern bootstrap` — seed a freshly-installed harness from the project brief.
 *
 * Bootstrap is a CLI command, not a materialized skill (ADR 0024): there is no
 * `bootstrap/SKILL.md` left in the project tree to pollute every agent session
 * forever. Instead the agent already in the loop runs `discern bootstrap`, reads
 * the instructions it prints (the bundled `templates/bootstrap/instructions.md`),
 * does the authoring, and runs `discern bootstrap done` to validate the result and
 * record `[meta].bootstrapped`. From the agent's view this is identical to reading
 * a skill file — discern just hands it the brief over stdout instead — and the
 * first CLI call doubles as a smoke-test that the binary is on PATH.
 *
 * The command itself only does the deterministic, mechanical part: laying the doc
 * skeletons when — and only when — the project has none, so the agent never copies
 * files by hand and an existing `docs/` tree is never disturbed. All authoring
 * stays with the agent.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { Config } from "../shared/config_read.ts";
import { CONFIG_REL, findRoot } from "../shared/env.ts";
import { resolveBootstrapDir, resolveConfigPath } from "../lib/paths.ts";
import { TomlEditor } from "../lib/toml_edit.ts";

const NO_PROJECT =
  "not inside a discern project (no discern.toml in this directory or any parent).";

/** Options for `discern bootstrap` and `discern bootstrap done`. */
export interface BootstrapOptions {
  json: boolean;
  force: boolean;
}

/** The config key recording that one-time setup is complete. */
const BOOTSTRAPPED_KEY = "meta.bootstrapped";

/**
 * Markers a scaffolded skeleton carries until the agent fills it: the
 * `<!-- bootstrap fills this -->` sentinels and the placeholder EXAMPLE principle.
 * `bootstrap done` refuses to mark setup complete while any remain.
 */
const SKELETON_MARKERS: readonly string[] = [
  "bootstrap fills this",
  "(EXAMPLE",
];

/** Resolve the project root, or print the standard "no project" error and return undefined. */
async function rootOrError(json: boolean): Promise<string | undefined> {
  const root = await findRoot();
  if (root === undefined) {
    if (json) {
      console.log(
        JSON.stringify({ ok: false, error: "no_project", message: NO_PROJECT }),
      );
    } else {
      console.error(`discern: ${NO_PROJECT}`);
      console.error("       Run `discern init` to scaffold one.");
    }
  }
  return root;
}

/** Title-case a kebab/underscore slug into a display name ("my-app" → "My App"). */
function displayNameFromSlug(slug: string): string {
  const words = slug.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return "the project";
  }
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** True when a path exists (any type, symlinks not followed). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Copy one text file, substituting `{{project_name}}`, creating parent dirs. */
async function copyTextSubstituting(
  src: string,
  dest: string,
  name: string,
): Promise<void> {
  const text = (await Deno.readTextFile(src)).replaceAll(
    "{{project_name}}",
    name,
  );
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, text);
}

/** Recursively copy a skel subtree into the project, substituting tokens per file. */
async function copyTreeSubstituting(
  srcDir: string,
  destDir: string,
  name: string,
): Promise<void> {
  for await (const entry of walk(srcDir, { includeDirs: false })) {
    const rel = relative(srcDir, entry.path);
    await copyTextSubstituting(entry.path, join(destDir, rel), name);
  }
}

/**
 * `discern bootstrap` — lay the doc skeletons (only where the project has none),
 * then print the setup instructions for the agent in the loop to act on.
 */
export async function runBootstrap(opts: BootstrapOptions): Promise<number> {
  const root = await rootOrError(opts.json);
  if (root === undefined) {
    return 1;
  }
  const cfg = await Config.load(root);

  if (cfg.bool(BOOTSTRAPPED_KEY) && !opts.force) {
    const message =
      "this project is already bootstrapped. Re-run with --force to seed it again.";
    if (opts.json) {
      console.log(
        JSON.stringify({ ok: true, alreadyBootstrapped: true, message }),
      );
    } else {
      console.log(`discern: ${message}`);
    }
    return 0;
  }

  const name = displayNameFromSlug(cfg.get("project.slug", ""));
  const bootstrapDir = await resolveBootstrapDir();
  const skelDir = join(bootstrapDir, "skel");

  // Lay the skeletons non-destructively. The docs tree is all-or-nothing — skipped
  // entirely when any docs/ already exists, so an existing tree is never mixed with
  // the skeleton shape (the seamless DX: discern never imposes docs over yours).
  // TODO.md is an independent single-file seed, laid only when absent.
  const scaffolded: string[] = [];
  const skipped: string[] = [];

  const docsExisted = await pathExists(join(root, "docs"));
  if (docsExisted) {
    skipped.push("docs/");
  } else if (await pathExists(join(skelDir, "docs"))) {
    await copyTreeSubstituting(join(skelDir, "docs"), join(root, "docs"), name);
    scaffolded.push("docs/");
  }

  const todoSkel = join(skelDir, "TODO.md");
  if (await pathExists(join(root, "TODO.md"))) {
    skipped.push("TODO.md");
  } else if (await pathExists(todoSkel)) {
    await copyTextSubstituting(todoSkel, join(root, "TODO.md"), name);
    scaffolded.push("TODO.md");
  }

  const instructions = await Deno.readTextFile(
    join(bootstrapDir, "instructions.md"),
  );

  if (opts.json) {
    console.log(
      JSON.stringify({ ok: true, scaffolded, skipped, instructions }, null, 2),
    );
    return 0;
  }

  // Human/agent: a short status preamble, then the instructions verbatim so the
  // agent reads them straight off stdout.
  if (scaffolded.length > 0) {
    console.log(
      `Scaffolded ${
        scaffolded.join(", ")
      } (filled with the project name; complete them below).`,
    );
  }
  if (skipped.length > 0) {
    console.log(
      `Left your existing ${
        skipped.join(", ")
      } untouched — work with what is there.`,
    );
  }
  console.log("");
  console.log("─".repeat(72));
  console.log("");
  console.log(instructions);
  return 0;
}

/**
 * `discern bootstrap done` — validate that no skeleton markers remain, then record
 * `[meta].bootstrapped = true` so the setup reminder retires and the command hides
 * itself. Also the escape hatch for a manual setup: run it after wiring the config
 * by hand to silence the reminder. `--force` records completion despite leftovers.
 */
export async function runBootstrapDone(
  opts: BootstrapOptions,
): Promise<number> {
  const root = await rootOrError(opts.json);
  if (root === undefined) {
    return 1;
  }

  // Validate: no scaffolded doc (or the guidance source) may still carry a marker.
  const leftover: string[] = [];
  const docsDir = join(root, "docs");
  if (await pathExists(docsDir)) {
    for await (
      const entry of walk(docsDir, { includeDirs: false, exts: [".md"] })
    ) {
      try {
        const text = await Deno.readTextFile(entry.path);
        if (SKELETON_MARKERS.some((m) => text.includes(m))) {
          leftover.push(relative(root, entry.path));
        }
      } catch {
        // unreadable — skip; it cannot be asserted as a leftover marker.
      }
    }
  }
  const guidance = join(root, "guidance.md");
  if (await pathExists(guidance)) {
    try {
      if (
        (await Deno.readTextFile(guidance)).includes("bootstrap fills this")
      ) {
        leftover.push("guidance.md");
      }
    } catch {
      // unreadable — skip.
    }
  }
  leftover.sort();

  if (leftover.length > 0 && !opts.force) {
    const message =
      `bootstrap is not finished — ${leftover.length} file(s) still carry skeleton markers ` +
      "(a `<!-- bootstrap fills this -->` sentinel or the EXAMPLE principle).";
    if (opts.json) {
      console.log(
        JSON.stringify({ ok: false, error: "incomplete", leftover, message }),
      );
    } else {
      console.error(`discern: ${message}`);
      for (const f of leftover) {
        console.error(`         • ${f}`);
      }
      console.error(
        "       Fill them and re-run, or pass --force to mark complete anyway.",
      );
    }
    return 1;
  }

  // Record the marker, comment-preserving (mirrors `discern config set --bool`).
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  const editor = new TomlEditor(await Deno.readTextFile(path));
  editor.setBool(BOOTSTRAPPED_KEY, true);
  await Deno.writeTextFile(path, editor.toString());

  const forced = leftover.length > 0;
  if (opts.json) {
    console.log(
      JSON.stringify({ ok: true, bootstrapped: true, forced, leftover }),
    );
    return 0;
  }
  console.log(
    "Bootstrap complete — recorded [meta].bootstrapped = true in discern.toml.",
  );
  console.log(
    "The one-time setup reminder is now silenced and `discern bootstrap` is hidden from the command list.",
  );
  if (forced) {
    console.log(
      `(Marked complete with --force despite ${leftover.length} file(s) still carrying skeleton markers.)`,
    );
  }
  return 0;
}
