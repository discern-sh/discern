/**
 * The **icculus config document** — the one JSON shape that declaratively
 * describes a project's gate config (ADR 0005, ADR 0017/0018). It is consumed in
 * two places:
 *
 *   - `icculus init --config <file>` — drives a fresh, non-interactive install.
 *   - a preset's `preset.json` — the config half of an `add-preset` overlay.
 *
 * Both apply the document's `capabilities` / `checks` / `scopes` / `ratchets` to
 * a project's `.icculus/config.toml` through the comment-preserving `TomlEditor`.
 * Because this shape is a published contract (a JSON Schema ships at
 * `schema/icculus-config.schema.json`), it carries an optional `version` so it
 * can evolve without silently misreading an older or newer document, and accepts
 * a `$schema` pointer for editor validation.
 */

import { KNOWN_CAPABILITIES, STAGES } from "./config.ts";
import type { InitFlags } from "./prompts.ts";
import type { TomlEditor } from "./toml_edit.ts";

/**
 * The config-document major version this build understands. A document may omit
 * `version` (assumed current) or carry a matching major; a different major is a
 * breaking shape this build refuses rather than misreads.
 */
export const CONFIG_DOC_VERSION = "2";

/** A capability/check/gate value: one command, or a list run in order. */
type CommandOrList = string | string[];

/** A `[checks.<name>]` table — custom gate work with an explicit stage. */
interface CheckSpec {
  stage: string;
  run: CommandOrList;
  provides?: string;
}

/** A `[scopes.<name>]` table — a named region with optional attributes. */
interface ScopeSpec {
  paths: string[];
  neutral?: boolean;
  previewable?: boolean;
  gate?: CommandOrList;
}

/** A `[ratchets.<name>]` table as expressed in the config document. */
interface RatchetSpec {
  metric?: string;
  direction?: string;
  limit: number | string;
  run: CommandOrList;
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
  /** Preset metadata; ignored by `init --config`. */
  description?: string;
  /** `[capabilities]` fills — a known capability name mapped to a command (or list). */
  capabilities?: Record<string, CommandOrList>;
  /** `[checks.<name>]` fills — custom gate work with an explicit stage. */
  checks?: Record<string, CheckSpec>;
  /** `[scopes.<name>]` fills — a named region with paths and optional attributes. */
  scopes?: Record<string, ScopeSpec>;
  /** `[ratchets.<name>]` tables (coverage is just a conventional name). */
  ratchets?: Record<string, RatchetSpec>;
}

/** TOML bare-key shape, enforced for slot/scope/side-gate/ratchet names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Major component of a version value ("1.2" -> "1", 1 -> "1"). */
function majorOf(version: string | number): string {
  return String(version).split(".")[0]!.trim();
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
 * Apply a document's `capabilities`/`checks`/`scopes`/`ratchets` fills to a
 * `TomlEditor` over a project's `.icculus/config.toml`. Validates names and
 * enum-ish values (capability name, stage, direction) the same way the `config`
 * subcommand does; throws on bad input so the caller can report it.
 */
export function applyConfigDoc(
  editor: TomlEditor,
  doc: IcculusConfigDoc,
): void {
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
    setCommand(editor, `capabilities.${name}`, run);
  }

  // Checks: an explicit stage (∈ STAGES) + a run command + an optional label.
  for (const [name, spec] of Object.entries(doc.checks ?? {})) {
    assertName("check", name);
    if (spec.stage === undefined) {
      throw new Error(`check "${name}": a stage is required`);
    }
    if (!(STAGES as readonly string[]).includes(spec.stage)) {
      throw new Error(
        `check "${name}": unknown stage "${spec.stage}" (use ${
          STAGES.join(", ")
        })`,
      );
    }
    if (spec.run === undefined) {
      throw new Error(`check "${name}": a run command is required`);
    }
    editor.setString(`checks.${name}.stage`, spec.stage);
    setCommand(editor, `checks.${name}.run`, spec.run);
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
    const direction = spec.direction ?? "up";
    if (direction !== "up" && direction !== "down") {
      throw new Error(`ratchet "${name}": direction must be "up" or "down"`);
    }
    if (spec.run === undefined) {
      throw new Error(`ratchet "${name}": a run command is required`);
    }
    editor.setString(`ratchets.${name}.metric`, spec.metric ?? name);
    editor.setString(`ratchets.${name}.direction`, direction);
    editor.setNumber(`ratchets.${name}.limit`, spec.limit);
    setCommand(editor, `ratchets.${name}.run`, spec.run);
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
