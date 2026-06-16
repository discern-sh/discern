/**
 * The `init --config <file>` answers file (ADR 0005): a JSON document that drives
 * a fresh, non-interactive `init` declaratively. Base fields mirror the `init`
 * flags; the value-add is `slots` / `scopes` / `side_gates` / `ratchets`, applied
 * to the generated `icculus.toml` via the comment-preserving `TomlEditor`.
 */

import { KNOWN_PHASES } from "./config.ts";
import type { InitFlags } from "./prompts.ts";
import type { TomlEditor } from "./toml_edit.ts";

/** A named ratchet table as expressed in the answers file. */
interface RatchetSpec {
  metric?: string;
  direction?: string;
  limit: number | string;
  slot?: string;
}

/** The full shape of an `init --config` answers file (every field optional). */
export interface InitAnswersFile {
  name?: string;
  slug?: string;
  branch_prefix?: string;
  source_globs?: string[];
  brief?: string;
  agents?: string[];
  /** `[slots.<name>]` fills. */
  slots?: Record<string, { phase?: string; run?: string }>;
  /** `[scopes].<name>` glob arrays. */
  scopes?: Record<string, string[]>;
  /** `[scopes.side_gates].<scope>` commands. */
  side_gates?: Record<string, string>;
  /** `[ratchets.<name>]` tables (coverage is just a conventional name). */
  ratchets?: Record<string, RatchetSpec>;
}

/** TOML bare-key shape, enforced for slot/scope/side-gate/ratchet names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Load and shallow-validate an answers file. `source` is a path, or `-` for
 * stdin. Throws a clear error on a missing/invalid file (the caller reports it).
 */
export async function loadInitAnswers(
  source: string,
): Promise<InitAnswersFile> {
  let text: string;
  if (source === "-") {
    text = await new Response(Deno.stdin.readable).text();
  } else {
    try {
      text = await Deno.readTextFile(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`could not read --config file "${source}": ${message}`);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--config file is not valid JSON: ${message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--config file must be a JSON object");
  }
  return parsed as InitAnswersFile;
}

/**
 * Overlay an answers file's *base* fields onto the CLI flags as the fallback
 * layer: an explicit flag wins, else the file value, else (later) the default.
 * Array fields are rendered to the comma-string shape the flags use, so the
 * existing flag-parsing path is reused unchanged.
 */
export function mergeFileIntoFlags(
  flags: InitFlags,
  file: InitAnswersFile | undefined,
): InitFlags {
  if (!file) {
    return flags;
  }
  return {
    ...flags,
    name: flags.name ?? file.name,
    slug: flags.slug ?? file.slug,
    branchPrefix: flags.branchPrefix ?? file.branch_prefix,
    sourceGlobs: flags.sourceGlobs ?? file.source_globs?.join(","),
    brief: flags.brief ?? file.brief,
    agents: flags.agents ?? file.agents?.join(","),
  };
}

/**
 * Apply the answers file's `slots`/`scopes`/`side_gates`/`ratchets` fills to a
 * `TomlEditor` over the generated `icculus.toml`. Validates names and enum-ish
 * values (phase, direction) the same way the `config` subcommand does; throws on
 * bad input so the caller can report it.
 */
export function applyAnswerFills(
  editor: TomlEditor,
  file: InitAnswersFile,
): void {
  for (const [name, slot] of Object.entries(file.slots ?? {})) {
    assertName("slot", name);
    if (slot.phase !== undefined) {
      if (!(KNOWN_PHASES as readonly string[]).includes(slot.phase)) {
        throw new Error(
          `slot "${name}": unknown phase "${slot.phase}" (use ${
            KNOWN_PHASES.join(", ")
          })`,
        );
      }
      editor.setString(`slots.${name}.phase`, slot.phase);
    }
    if (slot.run !== undefined) {
      editor.setString(`slots.${name}.run`, slot.run);
    }
  }

  for (const [name, globs] of Object.entries(file.scopes ?? {})) {
    assertName("scope", name);
    if (!Array.isArray(globs)) {
      throw new Error(`scope "${name}": value must be an array of globs`);
    }
    editor.setStringArray(`scopes.${name}`, globs);
  }

  for (const [scope, cmd] of Object.entries(file.side_gates ?? {})) {
    assertName("side gate", scope);
    editor.setString(`scopes.side_gates.${scope}`, cmd);
  }

  for (const [name, spec] of Object.entries(file.ratchets ?? {})) {
    assertName("ratchet", name);
    const direction = spec.direction ?? "up";
    if (direction !== "up" && direction !== "down") {
      throw new Error(`ratchet "${name}": direction must be "up" or "down"`);
    }
    editor.setString(`ratchets.${name}.metric`, spec.metric ?? name);
    editor.setString(`ratchets.${name}.direction`, direction);
    editor.setNumber(`ratchets.${name}.limit`, spec.limit);
    if (spec.slot !== undefined) {
      editor.setString(`ratchets.${name}.slot`, spec.slot);
    }
  }
}

/** Throw if `name` is not a TOML-bare-key-shaped identifier. */
function assertName(kind: string, name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `${kind} name must be letters, digits, '_' or '-' (got "${name}")`,
    );
  }
}
