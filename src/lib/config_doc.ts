/**
 * The **discern config document** — the one JSON shape that declaratively
 * describes a project's gate config (ADR 0005, ADR 0017/0018). It is consumed in
 * two places:
 *
 *   - `discern setup --config <file>` — drives a fresh, non-interactive install.
 *   - a preset's `preset.json` — the config half of an `preset` overlay.
 *
 * Both apply the document's `capabilities` / `checks` / `scopes` / `standards` to
 * a project's `discern.toml` through the comment-preserving `TomlEditor`.
 * Because this shape is a published contract (a JSON Schema ships at
 * `schema/discern-config.schema.json`), it carries an optional `version` so it
 * can evolve without silently misreading an older or newer document, and accepts
 * a `$schema` pointer for editor validation.
 */

import { KNOWN_CAPABILITIES, STAGES } from "./config.ts";
import {
  capabilityCheckNameCollisions,
  CONFIG_DOC_VERSION,
  type DiscernConfigDoc,
} from "../shared/config_schema.ts";
import type { InitFlags } from "./prompts.ts";
import { TomlEditor } from "./toml_edit.ts";

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

/** TOML bare-key shape, enforced for slot/scope/side-gate/standard names. */
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

/** What a fill application did (or, on a dry-run's precomputed editor, would
 * do): the dotted config paths written, and — in fill-if-absent mode — those
 * left untouched because the project already sets them. */
export interface ConfigFillReport {
  /** Paths the fills wrote, e.g. `capabilities.test`, `checks.licenses`. */
  filled: string[];
  /** Paths kept as the project's own (only with `skipExisting`). */
  skipped: string[];
}

/**
 * Whether a document carries any config fill at all — the single-source answer
 * to "is there anything for {@link applyConfigDoc} to write?". It IS
 * `applyConfigDoc`: it runs the same routine against a throwaway empty editor
 * and asks whether it touched any path, so the set of fill-bearing fields can
 * never drift from the set the apply-routine actually consumes (a caller must
 * not hand-copy that field list — a docs-only preset was silently dropped
 * exactly because one had). A malformed document throws here, the same way it
 * would at apply time, so the caller reports it once.
 */
export function docHasFills(doc: DiscernConfigDoc): boolean {
  const report = applyConfigDoc(new TomlEditor(""), doc);
  return report.filled.length > 0 || report.skipped.length > 0;
}

/**
 * Apply a document's `capabilities`/`checks`/`scopes`/`standards` fills to a
 * `TomlEditor` over a project's `discern.toml`. Validates names and
 * enum-ish values (capability name, stage, direction) the same way the `config`
 * subcommand does; throws on bad input so the caller can report it.
 *
 * With `skipExisting`, a fill whose target already carries a real value (a set
 * key, or a present `[checks.*]`/`[scopes.*]`/`[standards.*]` table) is skipped
 * and reported instead of replacing it — a present value is the user's, so a
 * preset overlays config the way it overlays files: create-or-skip, never
 * overwrite. The default (used by `setup --config` over a freshly generated
 * template) writes every fill. Either way the returned report names each path
 * per outcome, so callers can disclose exactly what changed.
 */
export function applyConfigDoc(
  editor: TomlEditor,
  doc: DiscernConfigDoc,
  opts: { skipExisting?: boolean } = {},
): ConfigFillReport {
  const skipExisting = opts.skipExisting ?? false;
  const report: ConfigFillReport = { filled: [], skipped: [] };
  /** Route one validated fill: skip-and-report when its target is taken. */
  const write = (path: string, taken: boolean, apply: () => void): void => {
    if (skipExisting && taken) {
      report.skipped.push(path);
      return;
    }
    apply();
    report.filled.push(path);
  };

  {
    const dir = doc.docs?.dir;
    if (dir !== undefined) {
      write("docs.dir", editor.hasKey("docs.dir"), () => {
        editor.setString("docs.dir", dir);
      });
    }
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
    const key = `capabilities.${name}`;
    write(key, editor.hasKey(key), () => {
      setCommand(editor, key, run);
    });
  }

  // Checks: an explicit stage (∈ STAGES) + a run command + an optional label. The
  // document is loosely parsed (untrusted JSON), so each schema-required field is
  // validated here with an author-friendly message rather than trusted from the type.
  // A check sharing a declared capability's name is refused up front — the gate
  // keys job results by label, so the written config would fail its next load.
  const collisions = capabilityCheckNameCollisions({
    capabilities: doc.capabilities ?? {},
    checks: doc.checks ?? {},
  });
  if (collisions.length > 0) {
    throw new Error(
      `check "${collisions[0]}" shares its name with the "${
        collisions[0]
      }" capability — the gate keys each job's result by its label; rename the check or fold its command into the capability`,
    );
  }
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
    write(`checks.${name}`, editor.hasSection(`checks.${name}`), () => {
      editor.setString(`checks.${name}.stage`, stage);
      setCommand(editor, `checks.${name}.run`, run);
      if (spec.provides !== undefined) {
        editor.setString(`checks.${name}.provides`, spec.provides);
      }
    });
  }

  // Scopes: a named region (paths) with optional neutral/previewable/gate.
  for (const [name, spec] of Object.entries(doc.scopes ?? {})) {
    assertName("scope", name);
    if (!Array.isArray(spec.paths)) {
      throw new Error(`scope "${name}": paths must be an array of globs`);
    }
    write(`scopes.${name}`, editor.hasSection(`scopes.${name}`), () => {
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
    });
  }

  // Standards: a required run (emits the metric) + limit; direction/metric default.
  for (const [name, spec] of Object.entries(doc.standards ?? {})) {
    assertName("standard", name);
    const direction = (spec.direction ?? "up") as string;
    if (direction !== "up" && direction !== "down") {
      throw new Error(`standard "${name}": direction must be "up" or "down"`);
    }
    const run = spec.run as CommandOrList | undefined;
    if (run === undefined) {
      throw new Error(`standard "${name}": a run command is required`);
    }
    const limit = spec.limit as unknown;
    if (limit === undefined) {
      throw new Error(`standard "${name}": a limit is required`);
    }
    if (typeof limit !== "number" && typeof limit !== "string") {
      throw new Error(`standard "${name}": limit must be a number`);
    }
    write(`standards.${name}`, editor.hasSection(`standards.${name}`), () => {
      editor.setString(`standards.${name}.metric`, spec.metric ?? name);
      editor.setString(`standards.${name}.direction`, direction);
      editor.setNumber(`standards.${name}.limit`, limit);
      setCommand(editor, `standards.${name}.run`, run);
    });
  }

  return report;
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
