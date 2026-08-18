/**
 * The **discern config document** — the one JSON shape that declaratively
 * describes a project's gate config (ADR 0005, ADR 0017/0018). It is consumed in
 * two places:
 *
 *   - `discern setup --config <file>` — drives a fresh, non-interactive install.
 *   - a preset's `preset.json` — the config half of an `preset` overlay.
 *
 * Both apply the document's `jobs` / `scopes` / `generated` / `standards` /
 * `checkpoints` to
 * a project's `discern.toml` through the comment-preserving `TomlEditor`.
 * Because this shape is a published contract (a JSON Schema ships at
 * `schema/discern-setup-config.schema.json`), it carries an optional `version`
 * so it can evolve without silently misreading an older or newer document, and
 * accepts a `$schema` pointer for editor validation.
 */

import { isKnownJob, KNOWN_JOBS, STAGES } from "./config.ts";
import {
  type CommandValue,
  CONFIG_DOC_VERSION,
  type DiscernConfigDoc,
  toCommandList,
} from "../shared/config_schema.ts";
import {
  CHECKPOINT_MODES,
  isBuiltInCheckpoint,
} from "../shared/checkpoints.ts";
import type { InitFlags } from "./terminal_interaction.ts";
import { TomlEditor } from "./toml_edit.ts";

// The document's shape, its major version, and its editor JSON Schema all derive
// from the one canonical schema (`config_schema.ts`, ADR 0026) — re-exported here
// so the installer keeps importing them from this module. `applyConfigDoc` below
// is the runtime translator that writes a (loosely-parsed, possibly-malformed)
// document into a project's discern.toml, with author-friendly per-section
// messages; the schema is the published contract a `preset.json` validates against.
export { CONFIG_DOC_VERSION };
export type { DiscernConfigDoc };

/** A job/gate value: one command, or a list run in order. */
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
    map: flags.map ?? doc.map?.dir,
  };
}

/** What a fill application did (or, on a dry-run's precomputed editor, would
 * do): the dotted config paths written, and — in fill-if-absent mode — those
 * left untouched because the project already sets them. */
export interface ConfigFillReport {
  /** Paths the fills wrote, e.g. `jobs.test`, `jobs.licenses`. */
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
 * Apply a document's `jobs`/`scopes`/`generated`/`standards`/`checkpoints`
 * fills to a
 * `TomlEditor` over a project's `discern.toml`. Validates names and
 * enum-ish values (known job name, stage, direction) the same way the `config`
 * subcommand does; throws on bad input so the caller can report it.
 *
 * With `skipExisting`, a fill whose target already carries a real value (a set
 * key, or a present named-record table) is skipped
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
    const dir = doc.map?.dir;
    if (dir !== undefined) {
      write("map.dir", editor.hasKey("map.dir"), () => {
        editor.setString("map.dir", dir);
      });
    }
  }

  // Jobs share one namespace. Known names use the compact command value and
  // derive their stage; custom names require the stage-bearing table form. The
  // document is loosely parsed, so validate both positions again here with the
  // same actionable errors as the live config.
  for (const [name, value] of Object.entries(doc.jobs ?? {})) {
    assertName("job", name);
    if (isKnownJob(name)) {
      if (isRecord(value) && Object.hasOwn(value, "stage")) {
        throw new Error(
          `known job "${name}" derives stage "${
            KNOWN_JOBS[name]
          }" from its name; remove stage`,
        );
      }
      const key = `jobs.${name}`;
      write(key, editor.hasKey(key), () => {
        setCommand(editor, key, value as CommandValue);
      });
      continue;
    }
    if (!isRecord(value)) {
      throw new Error(
        `custom job "${name}" must use the table form with stage and run`,
      );
    }
    const stage = "stage" in value && typeof value.stage === "string"
      ? value.stage
      : undefined;
    if (stage === undefined) {
      throw new Error(`custom job "${name}": a stage is required`);
    }
    if (!(STAGES as readonly string[]).includes(stage)) {
      throw new Error(
        `custom job "${name}": unknown stage "${stage}" (use ${
          STAGES.join(", ")
        })`,
      );
    }
    const run = "run" in value
      ? value.run as CommandOrList | undefined
      : undefined;
    if (run === undefined) {
      throw new Error(`custom job "${name}": a run command is required`);
    }
    write(`jobs.${name}`, editor.hasSection(`jobs.${name}`), () => {
      editor.setString(`jobs.${name}.stage`, stage);
      setCommand(editor, `jobs.${name}.run`, run);
      if ("provides" in value && typeof value.provides === "string") {
        editor.setString(`jobs.${name}.provides`, value.provides);
      }
      if (typeof value.timeout === "number") {
        editor.setNumber(`jobs.${name}.timeout`, value.timeout);
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

  // Generated artifacts: ownership globs, a deterministic regeneration command,
  // and an optional time budget.
  for (const [name, spec] of Object.entries(doc.generated ?? {})) {
    assertName("generated group", name);
    if (!Array.isArray(spec.paths)) {
      throw new Error(
        `generated group "${name}": paths must be an array of globs`,
      );
    }
    const run = spec.run as unknown;
    if (!isCommandOrList(run) || toCommandList(run).length === 0) {
      throw new Error(
        `generated group "${name}": run must contain at least one command`,
      );
    }
    if (
      spec.timeout !== undefined &&
      (typeof spec.timeout !== "number" || spec.timeout < 0)
    ) {
      throw new Error(
        `generated group "${name}": timeout must be zero or a positive number`,
      );
    }
    write(`generated.${name}`, editor.hasSection(`generated.${name}`), () => {
      editor.setStringArray(`generated.${name}.paths`, spec.paths);
      setCommand(editor, `generated.${name}.run`, run);
      if (spec.timeout !== undefined) {
        editor.setNumber(`generated.${name}.timeout`, spec.timeout);
      }
    });
  }

  // Checkpoints: a criterion is required unless the id names a shipped
  // built-in (which carries its own); one selector at most; mode from the
  // closed pair. The remaining trigger fields write through as given.
  for (const [name, spec] of Object.entries(doc.checkpoints ?? {})) {
    assertName("checkpoint", name);
    const criterion = spec.criterion;
    if (
      !isBuiltInCheckpoint(name) &&
      (typeof criterion !== "string" || criterion.trim() === "")
    ) {
      throw new Error(
        `checkpoint "${name}": a criterion is required (only a shipped built-in id may omit it)`,
      );
    }
    if (spec.scope !== undefined && spec.paths !== undefined) {
      throw new Error(
        `checkpoint "${name}": use one selector — scope or paths, not both`,
      );
    }
    if (spec.paths !== undefined && !Array.isArray(spec.paths)) {
      throw new Error(`checkpoint "${name}": paths must be an array of globs`);
    }
    const mode = spec.mode as string | undefined;
    if (
      mode !== undefined && !(CHECKPOINT_MODES as readonly string[]).includes(
        mode,
      )
    ) {
      throw new Error(
        `checkpoint "${name}": unknown mode "${mode}" (use ${
          CHECKPOINT_MODES.join(", ")
        })`,
      );
    }
    write(
      `checkpoints.${name}`,
      editor.hasSection(`checkpoints.${name}`),
      () => {
        const key = `checkpoints.${name}`;
        if (spec.scope !== undefined) {
          editor.setString(`${key}.scope`, spec.scope);
        }
        if (spec.paths !== undefined) {
          editor.setStringArray(`${key}.paths`, spec.paths);
        }
        if (spec.unless_changed !== undefined) {
          editor.setStringArray(`${key}.unless_changed`, spec.unless_changed);
        }
        if (spec.min_changed_files !== undefined) {
          editor.setNumber(`${key}.min_changed_files`, spec.min_changed_files);
        }
        if (spec.deletion_dominant !== undefined) {
          editor.setBool(`${key}.deletion_dominant`, spec.deletion_dominant);
        }
        if (spec.similar_new_file !== undefined) {
          editor.setBool(`${key}.similar_new_file`, spec.similar_new_file);
        }
        if (spec.when !== undefined) {
          editor.setString(`${key}.when`, spec.when);
        }
        if (mode !== undefined) {
          editor.setString(`${key}.mode`, mode);
        }
        if (typeof criterion === "string") {
          editor.setString(`${key}.criterion`, criterion);
        }
        if (spec.teach !== undefined) {
          editor.setString(`${key}.teach`, spec.teach);
        }
      },
    );
  }

  // Standards: direction, run (emits the metric), and limit are required; metric
  // defaults to the standard name.
  for (const [name, spec] of Object.entries(doc.standards ?? {})) {
    assertName("standard", name);
    const direction = spec.direction as string | undefined;
    if (direction === undefined) {
      throw new Error(
        `standard "${name}": direction is required ("up" or "down")`,
      );
    }
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
  value: CommandValue,
): void {
  if (typeof value === "object" && !Array.isArray(value)) {
    // The known-job table form: rendered as an inline table. JSON string
    // escaping is valid TOML basic-string escaping, so the quoting is shared.
    const run = Array.isArray(value.run)
      ? `[${value.run.map((s) => JSON.stringify(s)).join(", ")}]`
      : JSON.stringify(value.run);
    const timeout = value.timeout !== undefined
      ? `, timeout = ${value.timeout}`
      : "";
    editor.setLiteral(key, `{ run = ${run}${timeout} }`);
    return;
  }
  if (Array.isArray(value)) {
    editor.setStringArray(key, value);
  } else {
    editor.setString(key, value);
  }
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a loosely parsed value has the command-or-list wire shape. */
function isCommandOrList(value: unknown): value is CommandOrList {
  return typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

/** Throw if `name` is not a TOML-bare-key-shaped identifier. */
function assertName(kind: string, name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `${kind} name must be letters, digits, '_' or '-' (got "${name}")`,
    );
  }
}
