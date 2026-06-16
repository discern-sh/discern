/**
 * The **icculus config document** — the one JSON shape that declaratively
 * describes a project's gate config (ADR 0005). It is consumed in two places:
 *
 *   - `icculus init --config <file>` — drives a fresh, non-interactive install.
 *   - an adapter's `adapter.json` — the config half of an `add-adapter` overlay.
 *
 * Both apply the document's `slots` / `scopes` / `side_gates` / `ratchets` to a
 * project's `icculus.toml` through the comment-preserving `TomlEditor`. Because
 * this shape is a published contract (a JSON Schema ships at
 * `schema/icculus-config.schema.json`), it carries an optional `version` so it
 * can evolve without silently misreading an older or newer document, and accepts
 * a `$schema` pointer for editor validation.
 */

import { KNOWN_PHASES } from "./config.ts";
import type { InitFlags } from "./prompts.ts";
import type { TomlEditor } from "./toml_edit.ts";

/**
 * The config-document major version this build understands. A document may omit
 * `version` (assumed current) or carry a matching major; a different major is a
 * breaking shape this build refuses rather than misreads.
 */
export const CONFIG_DOC_VERSION = "1";

/** A named ratchet table as expressed in the config document. */
interface RatchetSpec {
  metric?: string;
  direction?: string;
  limit: number | string;
  slot?: string;
}

/** The full shape of an icculus config document (every field optional). */
export interface IcculusConfigDoc {
  /** Editor-only JSON Schema pointer; ignored by the loader. */
  $schema?: string;
  /** Document major version (default: the current `CONFIG_DOC_VERSION`). */
  version?: string | number;
  name?: string;
  slug?: string;
  branch_prefix?: string;
  source_globs?: string[];
  brief?: string;
  agents?: string[];
  /** Adapter metadata; ignored by `init --config`. */
  description?: string;
  /** `[slots.<name>]` fills. Omit `phase` for a measurement slot. */
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

/** Major component of a version value ("1.2" -> "1", 1 -> "1"). */
function majorOf(version: string | number): string {
  return String(version).split(".")[0].trim();
}

/**
 * Load and shallow-validate a config document. `source` is a path, or `-` for
 * stdin. Throws a clear error on a missing/invalid file or an unsupported
 * `version` major (the caller reports it). Unknown keys are ignored, so a newer
 * field within the same major never breaks an older reader.
 */
export async function loadConfigDoc(
  source: string,
): Promise<IcculusConfigDoc> {
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
  assertSupportedVersion(parsed as IcculusConfigDoc);
  return parsed as IcculusConfigDoc;
}

/**
 * Throw when a document declares a `version` whose major this build does not
 * understand. An absent version is assumed current.
 */
export function assertSupportedVersion(doc: IcculusConfigDoc): void {
  if (doc.version === undefined) {
    return;
  }
  const major = majorOf(doc.version);
  if (major !== CONFIG_DOC_VERSION) {
    throw new Error(
      `unsupported config-document version "${doc.version}" (this build understands version ${CONFIG_DOC_VERSION})`,
    );
  }
}

/**
 * Overlay a document's *base* fields onto the CLI flags as the fallback layer:
 * an explicit flag wins, else the document value, else (later) the default.
 * Array fields are rendered to the comma-string shape the flags use, so the
 * existing flag-parsing path is reused unchanged.
 */
export function mergeDocIntoFlags(
  flags: InitFlags,
  doc: IcculusConfigDoc | undefined,
): InitFlags {
  if (!doc) {
    return flags;
  }
  return {
    ...flags,
    name: flags.name ?? doc.name,
    slug: flags.slug ?? doc.slug,
    branchPrefix: flags.branchPrefix ?? doc.branch_prefix,
    sourceGlobs: flags.sourceGlobs ?? doc.source_globs?.join(","),
    brief: flags.brief ?? doc.brief,
    agents: flags.agents ?? doc.agents?.join(","),
  };
}

/**
 * Apply a document's `slots`/`scopes`/`side_gates`/`ratchets` fills to a
 * `TomlEditor` over a project's `icculus.toml`. Validates names and enum-ish
 * values (phase, direction) the same way the `config` subcommand does; throws on
 * bad input so the caller can report it.
 */
export function applyConfigDoc(
  editor: TomlEditor,
  doc: IcculusConfigDoc,
): void {
  for (const [name, slot] of Object.entries(doc.slots ?? {})) {
    assertName("slot", name);
    if (slot.phase !== undefined) {
      if (!(KNOWN_PHASES as readonly string[]).includes(slot.phase)) {
        throw new Error(
          `slot "${name}": unknown phase "${slot.phase}" (use ${
            KNOWN_PHASES.join(", ")
          }, or omit it for a measurement slot)`,
        );
      }
      editor.setString(`slots.${name}.phase`, slot.phase);
    }
    if (slot.run !== undefined) {
      editor.setString(`slots.${name}.run`, slot.run);
    }
  }

  for (const [name, globs] of Object.entries(doc.scopes ?? {})) {
    assertName("scope", name);
    if (!Array.isArray(globs)) {
      throw new Error(`scope "${name}": value must be an array of globs`);
    }
    editor.setStringArray(`scopes.${name}`, globs);
  }

  for (const [scope, cmd] of Object.entries(doc.side_gates ?? {})) {
    assertName("side gate", scope);
    editor.setString(`scopes.side_gates.${scope}`, cmd);
  }

  for (const [name, spec] of Object.entries(doc.ratchets ?? {})) {
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
