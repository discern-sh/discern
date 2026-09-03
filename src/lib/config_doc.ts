/**
 * The **discern config document** — the one JSON shape that declaratively
 * describes a project's gate config (ADR 0005, ADR 0017/0018). It is consumed by
 * `discern setup begin --config <file>` to drive a fresh, non-interactive install.
 * It applies the document's `jobs` / `scopes` / `generated` / `standards` /
 * `checkpoints` to a project's `discern.toml` through the comment-preserving
 * `TomlEditor`.
 * Because this shape is a published contract (a JSON Schema ships at
 * `schema/discern-setup-config.schema.json`), it carries an optional `version`
 * so it can evolve without silently misreading an older or newer document, and
 * accepts a `$schema` pointer for editor validation.
 */

import { isKnownJob, KNOWN_JOBS, STAGES } from "./config.ts";
import {
  type CommandValue,
  CONFIG_DOC_BOUNDED_SECTION_SCHEMAS,
  CONFIG_DOC_VERSION,
  configDocRuntimeSchema,
  configDocSchema,
  type DiscernConfigDoc,
  RECORD_ENTRY_SCHEMAS,
  toCommandList,
} from "../shared/config_schema.ts";
import { decodeJson } from "../shared/runtime_decode.ts";
import {
  CHECKPOINT_MODES,
  isBuiltInCheckpoint,
  selectCheckpointQuestionSource,
} from "../shared/checkpoints.ts";
import type { InitFlags } from "./terminal_interaction.ts";
import type { TomlEditor } from "./toml_edit.ts";

// The document's shape, its major version, and its editor JSON Schema all derive
// from the one canonical schema (`config_schema.ts`, ADR 0026) — re-exported here
// so the installer keeps importing them from this module. `applyConfigDoc` below
// is the runtime translator that writes a validated, closed document
// into a project's discern.toml, with author-friendly per-section messages; the
// schema is the published contract setup validates against.
export { CONFIG_DOC_VERSION };
export type { DiscernConfigDoc };

/** How every accepted top-level document key produces an effect or validation. */
export const CONFIG_DOC_FIELD_CONSUMERS = {
  $schema: "editor_schema",
  version: "version_gate",
  name: "setup_input",
  slug: "setup_input",
  branch_prefix: "setup_input",
  brief: "setup_input",
  agents: "setup_input",
  map: "setup_input_and_config_fill",
  jobs: "config_fill",
  scopes: "config_fill",
  generated: "config_fill",
  standards: "config_fill",
  checkpoints: "config_fill",
  setup: "config_fill",
  worktree: "config_fill",
} as const;

const configDocSchemaKeys = Object.keys(configDocSchema.shape).toSorted();
const configDocConsumerKeys = Object.keys(CONFIG_DOC_FIELD_CONSUMERS)
  .toSorted();
if (
  JSON.stringify(configDocSchemaKeys) !== JSON.stringify(configDocConsumerKeys)
) {
  throw new Error(
    "every setup-config document key must declare its runtime consumer",
  );
}

/** A job/gate value: one command, or a list run in order. */
type CommandOrList = string | string[];

/** TOML bare-key shape, enforced for slot/scope/side-gate/standard names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Major component of a version value ("1.2" -> "1", 1 -> "1"). */
function majorOf(version: string | number): string {
  return (String(version).split(".")[0] ?? "").trim();
}

/**
 * Load and validate a config document. `source` is a path, or `-` for
 * stdin. Throws a clear error on a missing/invalid file or an unsupported
 * `version` major (the caller reports it). Unknown keys are refused so a typo or
 * retired field cannot silently produce an incomplete install.
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
  return decodeConfigDoc(
    text,
    source === "-" ? "--config stdin" : `--config file \"${source}\"`,
  );
}

/** Decode the setup document contract from one JSON source. */
export function decodeConfigDoc(
  text: string,
  source: string,
): DiscernConfigDoc {
  const doc = decodeJson(configDocRuntimeSchema, text, source);
  assertSupportedVersion(doc);
  return doc;
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

/** Every discern.toml target one setup document asks the writer to fill. */
export function configDocFillPaths(doc: DiscernConfigDoc): string[] {
  const paths: string[] = [];
  if (doc.map?.dir !== undefined) paths.push("map.dir");
  for (const [name, spec] of Object.entries(doc.jobs ?? {})) {
    if (isKnownJob(name) || !isRecord(spec)) {
      paths.push(`jobs.${name}`);
    } else {
      paths.push(
        ...recordFillPaths(
          `jobs.${name}`,
          spec,
          RECORD_ENTRY_SCHEMAS.jobs,
        ),
      );
    }
  }
  for (const section of ["scopes", "generated", "checkpoints"] as const) {
    for (const [name, spec] of Object.entries(doc[section] ?? {})) {
      paths.push(
        ...recordFillPaths(
          `${section}.${name}`,
          spec,
          RECORD_ENTRY_SCHEMAS[section],
        ),
      );
    }
  }
  for (const [name, spec] of Object.entries(doc.standards ?? {})) {
    paths.push(
      ...recordFillPaths(
        `standards.${name}`,
        { ...spec, metric: spec.metric ?? name },
        RECORD_ENTRY_SCHEMAS.standards,
      ),
    );
  }
  for (
    const field of presentSchemaFields(
      doc.setup ?? {},
      CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.setup.unwrap(),
    )
  ) {
    paths.push(`setup.${field}`);
  }
  const worktree = doc.worktree;
  if (worktree !== undefined) {
    for (
      const field of presentSchemaFields(
        worktree,
        CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.worktree.unwrap(),
      )
    ) {
      if (field === "resources") {
        for (
          const [name, resource] of Object.entries(worktree.resources ?? {})
        ) {
          paths.push(
            ...recordFillPaths(
              `worktree.resources.${name}`,
              resource,
              RECORD_ENTRY_SCHEMAS["worktree.resources"],
            ),
          );
        }
      } else if (field === "setup") {
        for (const setupField of Object.keys(worktree.setup ?? {})) {
          paths.push(`worktree.setup.${setupField}`);
        }
      } else {
        paths.push(`worktree.${field}`);
      }
    }
  }
  return paths;
}

interface SchemaWithShape {
  readonly shape: Readonly<Record<string, unknown>>;
}

/** Fields present in one validated record, derived from its live schema. */
function presentSchemaFields(
  spec: Readonly<Record<string, unknown>>,
  schema: SchemaWithShape,
): string[] {
  return Object.keys(schema.shape).filter((field) => spec[field] !== undefined);
}

/** Exact config leaves written for one schema-backed named record. */
function recordFillPaths(
  path: string,
  spec: Readonly<Record<string, unknown>>,
  schema: SchemaWithShape,
): string[] {
  const fields = presentSchemaFields(spec, schema);
  return fields.length === 0
    ? [path]
    : fields.map((field) => `${path}.${field}`);
}

/** Render the standard `per` extent as one canonical inline TOML table. */
function inlineStringTable(value: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(value);
  if (
    entries.length !== 1 ||
    entries.some(([key, child]) =>
      !NAME_RE.test(key) ||
      (typeof child !== "string" &&
        !(Array.isArray(child) &&
          child.every((item) => typeof item === "string")))
    )
  ) {
    throw new Error(
      "inline config tables require one named string or string-array value",
    );
  }
  const [entry] = entries;
  if (entry === undefined) {
    throw new Error(
      "inline config tables require one named string or string-array value",
    );
  }
  const rendered = Array.isArray(entry[1])
    ? `[${entry[1].map((item) => JSON.stringify(item)).join(", ")}]`
    : JSON.stringify(entry[1]);
  return `{ ${entry[0]} = ${rendered} }`;
}

/** Write one schema-backed config leaf through its matching TOML primitive. */
function setConfigField(
  editor: TomlEditor,
  path: string,
  value: unknown,
): void {
  if (typeof value === "string") {
    editor.setString(path, value);
  } else if (typeof value === "number") {
    editor.setNumber(path, value);
  } else if (typeof value === "boolean") {
    editor.setBool(path, value);
  } else if (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  ) {
    editor.setStringArray(path, value);
  } else if (isRecord(value)) {
    editor.setLiteral(path, inlineStringTable(value));
  } else {
    throw new Error(`unsupported setup-config value at ${path}`);
  }
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
 * a conservative caller can fill missing config without overwriting it. The
 * default (used by `setup begin --config` over a freshly generated
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
  /** Write every present member of one open record from its canonical shape. */
  const writeRecord = (
    path: string,
    spec: Readonly<Record<string, unknown>>,
    schema: SchemaWithShape,
  ): void => {
    const targets = recordFillPaths(path, spec, schema);
    if (skipExisting && editor.hasSection(path)) {
      report.skipped.push(...targets);
      return;
    }
    const fields = presentSchemaFields(spec, schema);
    if (fields.length === 0) {
      editor.ensureSection(path);
    } else {
      for (const field of fields) {
        setConfigField(editor, `${path}.${field}`, spec[field]);
      }
    }
    report.filled.push(...targets);
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
    writeRecord(`jobs.${name}`, value, RECORD_ENTRY_SCHEMAS.jobs);
  }

  // Every scope field comes from the same entry schema the document publishes.
  for (const [name, spec] of Object.entries(doc.scopes ?? {})) {
    assertName("scope", name);
    if (!Array.isArray(spec.paths)) {
      throw new Error(`scope "${name}": paths must be an array of globs`);
    }
    writeRecord(`scopes.${name}`, spec, RECORD_ENTRY_SCHEMAS.scopes);
  }

  // Every generated-group field comes from the document's live entry schema.
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
    writeRecord(
      `generated.${name}`,
      spec,
      RECORD_ENTRY_SCHEMAS.generated,
    );
  }

  // Checkpoints: one canonical question-source selector, one path selector at
  // most, and a mode from the closed pair. Remaining fields write through.
  for (const [name, spec] of Object.entries(doc.checkpoints ?? {})) {
    assertName("checkpoint", name);
    const builtIn = isBuiltInCheckpoint(name);
    const questionSource = selectCheckpointQuestionSource(spec, builtIn);
    if (questionSource.kind === "invalid") {
      switch (questionSource.problem) {
        case "multiple":
          throw new Error(
            `[checkpoints.${name}] sets both question and question_file. ` +
              `Keep exactly one: question = "…" or ` +
              `question_file = "path/to/question.md".` +
              (builtIn ? " Remove both fields to inherit." : ""),
          );
        case "missing":
          throw new Error(
            `[checkpoints.${name}] must set exactly one question source: ` +
              `question = "…" or question_file = "path/to/question.md".`,
          );
        case "empty_question":
          throw new Error(
            `[checkpoints.${name}].question must contain non-whitespace judgment prose, or use question_file`,
          );
        case "invalid_file":
          throw new Error(
            `[checkpoints.${name}].question_file must be a project-relative file path`,
          );
      }
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
    writeRecord(
      `checkpoints.${name}`,
      spec,
      RECORD_ENTRY_SCHEMAS.checkpoints,
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
    writeRecord(
      `standards.${name}`,
      { ...spec, metric: spec.metric ?? name },
      RECORD_ENTRY_SCHEMAS.standards,
    );
  }

  // The two bounded fixed sections are the live schemas themselves. Primitive
  // worktree fields write directly; its two nested groups preserve their
  // conventional table shape.
  for (
    const field of presentSchemaFields(
      doc.setup ?? {},
      CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.setup.unwrap(),
    )
  ) {
    const path = `setup.${field}`;
    write(path, editor.hasKey(path), () => {
      setConfigField(
        editor,
        path,
        (doc.setup as Readonly<Record<string, unknown>>)[field],
      );
    });
  }

  const worktree = doc.worktree;
  if (worktree !== undefined) {
    for (
      const field of presentSchemaFields(
        worktree,
        CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.worktree.unwrap(),
      )
    ) {
      if (field === "resources") {
        for (
          const [name, resource] of Object.entries(worktree.resources ?? {})
        ) {
          assertName("worktree resource", name);
          writeRecord(
            `worktree.resources.${name}`,
            resource,
            RECORD_ENTRY_SCHEMAS["worktree.resources"],
          );
        }
        continue;
      }
      if (field === "setup") {
        for (
          const [setupField, value] of Object.entries(worktree.setup ?? {})
        ) {
          const path = `worktree.setup.${setupField}`;
          write(path, editor.hasKey(path), () => {
            setConfigField(editor, path, value);
          });
        }
        continue;
      }
      const path = `worktree.${field}`;
      write(path, editor.hasKey(path), () => {
        setConfigField(editor, path, worktree[field as keyof typeof worktree]);
      });
    }
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
