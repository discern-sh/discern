/**
 * The **discern config document** — the one JSON shape that declaratively
 * describes a project's gate config (ADR 0005, ADR 0017/0018). It is consumed in
 * two places:
 *
 *   - `discern setup --config <file>` — drives a fresh, non-interactive install.
 *   - a preset's `preset.json` — the config half of an `preset` overlay.
 *
 * Both apply the document's `capabilities` / `checks` / `scopes` / `ratchets` to
 * a project's `discern.toml` through the comment-preserving `TomlEditor`.
 * Because this shape is a published contract (a JSON Schema ships at
 * `schema/discern-config.schema.json`), it carries an optional `version` so it
 * can evolve without silently misreading an older or newer document, and accepts
 * a `$schema` pointer for editor validation.
 */

import { KNOWN_CAPABILITIES, STAGES } from "./config.ts";
import { FEATURES, isFeature } from "../shared/features.ts";
import {
  CONFIG_DOC_VERSION,
  type DiscernConfigDoc,
} from "../shared/config_schema.ts";
import type { InitFlags } from "./prompts.ts";
import type { TomlEditor } from "./toml_edit.ts";

// The document's shape, its major version, and its editor JSON Schema all derive
// from the one canonical schema (`config_schema.ts`, ADR 0026) — re-exported here
// so the installer keeps importing them from this module. `applyConfigDoc` below
// is the runtime translator that writes a (loosely-parsed, possibly-malformed)
// document into a project's discern.toml, with author-friendly per-section
// messages; the schema is the published contract a `preset.json` validates against.
export { CONFIG_DOC_VERSION };
export type { DiscernConfigDoc };

/** A capability/check/gate value: one command, or a list run in order. */
type CommandOrList = string | string[];

/** TOML bare-key shape, enforced for slot/scope/side-gate/ratchet names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Major component of a version value ("1.2" -> "1", 1 -> "1"). */
function majorOf(version: string | number): string {
  return (String(version).split(".")[0] ?? "").trim();
}

/**
 * Load and shallow-validate a config document. `source` is a path, or `-` for
 * stdin. Throws a clear error on a missing/invalid file or an unsupported
 * `version` major (the caller reports it). Unknown keys are ignored, so a newer
 * field within the same major never breaks an older reader.
 */
export async function loadConfigDoc(
  source: string,
): Promise<DiscernConfigDoc> {
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
  assertSupportedVersion(parsed as DiscernConfigDoc);
  return parsed as DiscernConfigDoc;
}

/**
 * Throw when a document declares a `version` whose major this build does not
 * understand. An absent version is assumed current.
 */
export function assertSupportedVersion(doc: DiscernConfigDoc): void {
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
  doc: DiscernConfigDoc | undefined,
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
    docs: flags.docs ?? doc.docs?.dir,
  };
}

/**
 * Apply a document's `capabilities`/`checks`/`scopes`/`ratchets` fills to a
 * `TomlEditor` over a project's `discern.toml`. Validates names and
 * enum-ish values (capability name, stage, direction) the same way the `config`
 * subcommand does; throws on bad input so the caller can report it.
 */
export function applyConfigDoc(
  editor: TomlEditor,
  doc: DiscernConfigDoc,
): void {
  if (doc.docs?.dir !== undefined) {
    editor.setString("docs.dir", doc.docs.dir);
  }

  // Features: a known toggle name mapped to a boolean. An unknown name is a typo
  // worth catching rather than silently ignoring.
  for (const [name, value] of Object.entries(doc.features ?? {})) {
    if (!isFeature(name)) {
      throw new Error(
        `unknown feature "${name}" (known: ${FEATURES.join(", ")})`,
      );
    }
    editor.setBool(`features.${name}`, value);
  }

  // Capabilities: a known name mapped to a command (or list). The stage is
  // derived by the engine, so none is written. An unknown name has no derivable
  // stage — reject it, pointing the author at [checks].
  for (const [name, run] of Object.entries(doc.capabilities ?? {})) {
    if (!Object.hasOwn(KNOWN_CAPABILITIES, name)) {
      throw new Error(
        `unknown capability "${name}" (known: ${
          Object.keys(KNOWN_CAPABILITIES).join(", ")
        }; use a [checks.<name>] table with a stage for custom work)`,
      );
    }
    if (run === undefined) {
      continue; // a known key present with no value — nothing to write
    }
    setCommand(editor, `capabilities.${name}`, run);
  }

  // Checks: an explicit stage (∈ STAGES) + a run command + an optional label. The
  // document is loosely parsed (untrusted JSON), so each schema-required field is
  // validated here with an author-friendly message rather than trusted from the type.
  for (const [name, spec] of Object.entries(doc.checks ?? {})) {
    assertName("check", name);
    const stage = spec.stage as string | undefined;
    if (stage === undefined) {
      throw new Error(`check "${name}": a stage is required`);
    }
    if (!(STAGES as readonly string[]).includes(stage)) {
      throw new Error(
        `check "${name}": unknown stage "${stage}" (use ${STAGES.join(", ")})`,
      );
    }
    const run = spec.run as CommandOrList | undefined;
    if (run === undefined) {
      throw new Error(`check "${name}": a run command is required`);
    }
    editor.setString(`checks.${name}.stage`, stage);
    setCommand(editor, `checks.${name}.run`, run);
    if (spec.provides !== undefined) {
      editor.setString(`checks.${name}.provides`, spec.provides);
    }
  }

  // Scopes: a named region (paths) with optional neutral/previewable/gate.
  for (const [name, spec] of Object.entries(doc.scopes ?? {})) {
    assertName("scope", name);
    if (!Array.isArray(spec.paths)) {
      throw new Error(`scope "${name}": paths must be an array of globs`);
    }
    editor.setStringArray(`scopes.${name}.paths`, spec.paths);
    if (spec.neutral !== undefined) {
      editor.setBool(`scopes.${name}.neutral`, spec.neutral);
    }
    if (spec.previewable !== undefined) {
      editor.setBool(`scopes.${name}.previewable`, spec.previewable);
    }
    if (spec.gate !== undefined) {
      setCommand(editor, `scopes.${name}.gate`, spec.gate);
    }
  }

  // Ratchets: a required run (emits the metric) + limit; direction/metric default.
  for (const [name, spec] of Object.entries(doc.ratchets ?? {})) {
    assertName("ratchet", name);
    const direction = (spec.direction ?? "up") as string;
    if (direction !== "up" && direction !== "down") {
      throw new Error(`ratchet "${name}": direction must be "up" or "down"`);
    }
    const run = spec.run as CommandOrList | undefined;
    if (run === undefined) {
      throw new Error(`ratchet "${name}": a run command is required`);
    }
    const limit = spec.limit as unknown;
    if (limit === undefined) {
      throw new Error(`ratchet "${name}": a limit is required`);
    }
    if (typeof limit !== "number" && typeof limit !== "string") {
      throw new Error(`ratchet "${name}": limit must be a number`);
    }
    editor.setString(`ratchets.${name}.metric`, spec.metric ?? name);
    editor.setString(`ratchets.${name}.direction`, direction);
    editor.setNumber(`ratchets.${name}.limit`, limit);
    setCommand(editor, `ratchets.${name}.run`, run);
  }
}

/** Write a command-or-list value: a TOML array when a list, else a string. */
function setCommand(
  editor: TomlEditor,
  key: string,
  value: CommandOrList,
): void {
  if (Array.isArray(value)) {
    editor.setStringArray(key, value);
  } else {
    editor.setString(key, value);
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
