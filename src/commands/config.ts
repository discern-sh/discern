/**
 * `discern config <subcommand>` — programmatic, comment-preserving edits to an
 * existing `discern.toml` (ADR 0005). Lets a scaffolder or CI set jobs, scopes,
 * standards, and arbitrary scalars without re-implementing TOML
 * editing. Every subcommand honours `--json` and `--dry-run`.
 */

import { join, relative } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { Logger } from "../lib/log.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { CONFIG_REL, NO_PROJECT } from "../shared/env.ts";
import {
  type ConfigValueKind,
  configWriteIssues,
  settableConfigValueKind,
  toCommandList,
} from "../shared/config_schema.ts";
import { isKnownJob, KNOWN_JOBS, STAGES } from "../lib/config.ts";
import { retiredConfigKeySuccessor } from "../shared/vocabulary.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  interactiveHints,
} from "../shared/hints.ts";
import { observeResult } from "../shared/result_capture.ts";
import type { DiscernResult, ErrorSlug } from "../shared/result.ts";
import type { ConfigData } from "../shared/result_schemas.ts";
import {
  tomlBool,
  TomlEditor,
  tomlNumber,
  tomlString,
  tomlStringArray,
} from "../lib/toml_edit.ts";
import { writeDiscernToml } from "../lib/tidy_format.ts";

/** Options shared by every `config` subcommand (global flags folded in). */
export interface ConfigOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Project root to edit in; defaults to the process cwd. An injected seam so
   * tests can drive the editor without mutating the process working directory. */
  cwd?: string;
}

/** Producer facts accepted by the dedicated record editors. */
interface ProducerOptions {
  inputs?: string[] | undefined;
  needs?: string[] | undefined;
  artifacts?: string[] | undefined;
  environment?: string[] | undefined;
  toolchain?: string[] | undefined;
}

/** Preserve every supplied producer fact in one atomic record edit. */
function producerEdits(prefix: string, opts: ProducerOptions): Edit[] {
  return [
    "inputs",
    "needs",
    "artifacts",
    "environment",
    "toolchain",
  ].flatMap((key) => {
    const value = opts[key as keyof ProducerOptions];
    return value === undefined
      ? []
      : [{ key: `${prefix}.${key}`, literal: tomlStringArray(value) }];
  });
}

/** One planned edit: the dotted key and the rendered TOML value literal. */
interface Edit {
  key: string;
  literal: string | null;
}

/** A complete config mutation decision, computed before the editor changes any
 * bytes. Dry runs and applied runs render this same plan. */
interface EditPlan {
  ok: true;
  edits: Edit[];
  summary: string;
  hints: FiredHint[];
}

/** A read-only planning refusal. */
interface EditRefusal {
  ok: false;
  message: string;
  error?: ErrorSlug;
}

type EditDecision = EditPlan | EditRefusal;

/** TOML bare-key shape, enforced for job/scope/standard names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Emit a failure on the right surface and return exit code 1. */
function fail(
  opts: ConfigOptions,
  message: string,
  error: ErrorSlug = "invalid_arguments",
): number {
  const log = new Logger(opts);
  if (opts.json) {
    log.result({ ok: false, verb: "config", error, message });
  } else {
    log.error(message);
  }
  return 1;
}

/**
 * Load `discern.toml` from the cwd, apply the edits through `TomlEditor`
 * (preserving comments), and write it back — or, with `--dry-run`, report what
 * would change and write nothing. `summary` is the human success line.
 */
async function applyEditPlan(
  opts: ConfigOptions,
  decide: (current: string) => EditDecision,
): Promise<number> {
  const log = new Logger(opts);
  const root = opts.cwd ?? Deno.cwd();
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  // Report the install-relative config path (discern.toml, or an earlier location).
  const fileRel = relative(root, path);

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    const message = isMissing
      ? "no discern install here — run `discern setup begin`, or cd into the project root."
      : `could not read the config: ${
        error instanceof Error ? error.message : String(error)
      }`;
    return fail(opts, message, isMissing ? NO_PROJECT : "read_error");
  }

  let decision: EditDecision;
  try {
    decision = decide(text);
  } catch (error) {
    return fail(
      opts,
      `could not plan the config edit: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "edit_failed",
    );
  }
  if (!decision.ok) {
    return fail(opts, decision.message, decision.error);
  }
  const { edits, summary, hints } = decision;

  let result: string;
  try {
    const editor = new TomlEditor(text);
    for (const edit of edits) {
      if (edit.literal === null) editor.deleteKey(edit.key);
      else editor.setLiteral(edit.key, edit.literal);
    }
    result = editor.toString();
  } catch (error) {
    return fail(
      opts,
      `could not edit the config: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "edit_failed",
    );
  }

  // The write boundary: never leave (or, dry-run, promise) a config the next
  // read rejects. Whatever the subcommands rendered, the edited text must parse
  // and satisfy the schema — bar the documented incomplete-record allowance —
  // before it touches disk; otherwise the edit is refused with the exact issues.
  const issues = configWriteIssues(result);
  if (issues.length > 0) {
    const detail = issues
      .map((i) => (i.path === "" ? i.message : `${i.path}: ${i.message}`))
      .join("; ");
    return fail(
      opts,
      `refusing this edit — it would leave ${fileRel} invalid (${detail}).`,
      "invalid_value",
    );
  }

  if (opts.dryRun) {
    const envelope: DiscernResult<ConfigData> = {
      ok: true,
      verb: "config",
      dry_run: true,
      ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
      data: { operation: "edit", file: fileRel, edits },
    };
    observeResult(envelope);
    if (opts.json) {
      log.result(envelope);
    } else {
      log.info("Dry run — planned edits:");
      for (const edit of edits) {
        log.line(
          edit.literal === null
            ? `  Remove ${edit.key}`
            : `  ${edit.key} = ${edit.literal}`,
        );
      }
      for (const hint of interactiveHints(hints)) {
        log.info(hint.text);
      }
    }
    return 0;
  }

  await writeDiscernToml(path, result);
  const envelope: DiscernResult<ConfigData> = {
    ok: true,
    verb: "config",
    ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
    data: { operation: "edit", file: fileRel, edits },
  };
  observeResult(envelope);
  if (opts.json) {
    log.result(envelope);
  } else {
    log.ok(summary);
    for (const edit of edits) {
      log.line(
        edit.literal === null
          ? `  Remove ${edit.key}`
          : `  ${edit.key} = ${edit.literal}`,
      );
    }
    for (const hint of interactiveHints(hints)) {
      log.info(hint.text);
    }
  }
  return 0;
}

/** Apply a state-independent edit list through the shared plan/apply boundary. */
async function applyEdits(
  edits: Edit[],
  opts: ConfigOptions,
  summary: string,
  hints: FiredHint[] = [],
): Promise<number> {
  return await applyEditPlan(opts, () => ({
    ok: true,
    edits,
    summary,
    hints,
  }));
}

/** Quote one literal argv item for a copyable POSIX-shell correction. */
function shellQuoteArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** The supported ordered-list invocation for one known job. */
function orderedJobCommand(name: string, commands: readonly string[]): string {
  const entries = commands.length === 0 ? ["<command>"] : commands;
  return `discern config set-job ${name} ${
    entries.map((command) => `--run ${shellQuoteArgument(command)}`).join(" ")
  }`;
}

/** Normalize Cliffy's collected option value across zero, one, and many uses. */
function collectedRuns(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Parse a plausible TOML/JSON string-list literal from the positional command.
 * A normal shell test such as `[ -f file ]` does not parse as TOML and remains a
 * legal scalar command. */
function serializedCommandList(command: string): string[] | undefined {
  try {
    const parsed = parseToml(`commands = ${command}`) as {
      commands?: unknown;
    };
    return Array.isArray(parsed.commands) &&
        parsed.commands.every((item) => typeof item === "string")
      ? parsed.commands
      : undefined;
  } catch {
    // discern-best-effort: config-command-list-parse-fallback
    return undefined;
  }
}

/** The current facts `set-job` needs to plan applicability without requiring the
 * rest of an incrementally-authored config to be complete. */
function knownJobEditState(
  current: string,
  name: string,
): { configured: boolean; notApplicable: string[] } | EditRefusal {
  const parsed = parseToml(current) as Record<string, unknown>;
  const jobs = typeof parsed.jobs === "object" && parsed.jobs !== null &&
      !Array.isArray(parsed.jobs)
    ? parsed.jobs as Record<string, unknown>
    : {};
  const setup = typeof parsed.setup === "object" &&
      parsed.setup !== null && !Array.isArray(parsed.setup)
    ? parsed.setup as Record<string, unknown>
    : {};
  const raw = setup.not_applicable ?? [];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    return {
      ok: false,
      message:
        "setup.not_applicable is not a string list. Run `discern doctor`, fix that config diagnostic, then retry this command.",
      error: "invalid_value",
    };
  }
  return {
    configured: Object.hasOwn(jobs, name),
    notApplicable: raw,
  };
}

/** Plan one known-job command value and remove a prior not-applicable declaration
 * in the same atomic config edit. */
function knownJobCommandPlan(
  current: string,
  name: string,
  literal: string,
  hints: FiredHint[],
  facts: Edit[],
): EditDecision {
  const state = knownJobEditState(current, name);
  if ("ok" in state) return state;
  const raw = parseToml(current);
  const jobs = raw.jobs as Record<string, unknown> | undefined;
  const previous = jobs?.[name];
  const fields = new Map<string, string>();
  if (
    previous !== null && typeof previous === "object" &&
    !Array.isArray(previous)
  ) {
    for (const [key, value] of Object.entries(previous)) {
      fields.set(
        key,
        typeof value === "number"
          ? tomlNumber(String(value))
          : Array.isArray(value)
          ? tomlStringArray(value as string[])
          : tomlString(String(value)),
      );
    }
  }
  for (const fact of facts) {
    if (fact.literal !== null) {
      fields.set(fact.key.slice(`jobs.${name}.`.length), fact.literal);
    }
  }
  fields.set("run", literal);
  const edits: Edit[] = [{
    key: `jobs.${name}`,
    literal: fields.size === 1
      ? literal
      : `{ ${
        [...fields].map(([key, value]) => `${key} = ${value}`).join(", ")
      } }`,
  }];
  if (state.notApplicable.includes(name)) {
    edits.push({
      key: "setup.not_applicable",
      literal: tomlStringArray(
        state.notApplicable.filter((candidate) => candidate !== name),
      ),
    });
  }
  return {
    ok: true,
    edits,
    summary: `Set job "${name}".`,
    hints,
  };
}

/** Plan a supported mark/unmark of one known job's setup applicability. */
function knownJobApplicabilityPlan(
  current: string,
  name: string,
  applicable: boolean,
): EditDecision {
  const state = knownJobEditState(current, name);
  if ("ok" in state) return state;
  if (!applicable && state.configured) {
    return {
      ok: false,
      message:
        `known job "${name}" is configured under [jobs], so it cannot be declared not applicable. Run \`discern config set-job ${name} --applicable\` to keep that command.`,
      error: "invalid_value",
    };
  }
  const notApplicable = applicable
    ? state.notApplicable.filter((candidate) => candidate !== name)
    : state.notApplicable.includes(name)
    ? state.notApplicable
    : [...state.notApplicable, name];
  return {
    ok: true,
    edits: [{
      key: "setup.not_applicable",
      literal: tomlStringArray(notApplicable),
    }],
    summary: applicable
      ? `Marked known job "${name}" as applicable.`
      : `Marked known job "${name}" as not applicable.`,
    hints: [],
  };
}

/**
 * `config set-job <name> [command] [--run <command>...]`
 *
 * A known name takes either the compatible positional scalar or repeatable
 * `--run` entries and derives its stage. A custom name takes `--stage` and one
 * or more `--run` entries, producing the required table form. Known names also
 * carry the supported applicability mark/unmark path.
 */
export async function runConfigSetJob(
  name: string,
  command: string | undefined,
  opts: ConfigOptions & ProducerOptions & {
    stage?: string | undefined;
    run?: string | string[] | undefined;
    /** Number of --run occurrences in argv. Cliffy normalizes an explicit empty
     * value away, so the action carries this count to distinguish it from no
     * option at all and reject every empty entry. */
    runCount?: number | undefined;
    /** True when raw argv supplied an empty value or another option where a
     * --run command was required. */
    runMissingValue?: boolean | undefined;
    provides?: string | undefined;
    timeout?: string | undefined;
    notApplicable?: boolean | undefined;
    applicable?: boolean | undefined;
  },
): Promise<number> {
  if (!NAME_RE.test(name)) {
    return fail(
      opts,
      `job name must be letters, digits, '_' or '-' (got "${name}").`,
    );
  }
  const runs = collectedRuns(opts.run);
  const runCount = opts.runCount ?? runs.length;
  const nonEmptyRuns = runs.filter((run) => run.trim() !== "");
  const applicabilitySelected = opts.notApplicable === true ||
    opts.applicable === true;
  if (opts.runMissingValue === true) {
    const correction = isKnownJob(name)
      ? orderedJobCommand(name, [])
      : `discern config set-job ${name} --stage check --run '<command>'`;
    return fail(
      opts,
      `--run needs a non-empty command. Run \`${correction}\`.`,
    );
  }
  if (opts.notApplicable === true && opts.applicable === true) {
    return fail(
      opts,
      `job "${name}" cannot be marked applicable and not applicable in one invocation. Run \`discern config set-job ${name} --applicable\`.`,
    );
  }
  if (isKnownJob(name)) {
    if (opts.stage !== undefined) {
      const correction = opts.notApplicable === true
        ? `discern config set-job ${name} --not-applicable`
        : opts.applicable === true
        ? `discern config set-job ${name} --applicable`
        : runs.length > 0
        ? orderedJobCommand(name, nonEmptyRuns)
        : `discern config set-job ${name} ${
          shellQuoteArgument(command ?? "<command>")
        }`;
      return fail(
        opts,
        `known job "${name}" derives stage "${
          KNOWN_JOBS[name]
        }" from its name; remove --stage and run \`${correction}\`.`,
      );
    }
    if (opts.provides !== undefined) {
      const correction = opts.notApplicable === true
        ? `discern config set-job ${name} --not-applicable`
        : opts.applicable === true
        ? `discern config set-job ${name} --applicable`
        : runs.length > 0
        ? orderedJobCommand(name, nonEmptyRuns)
        : `discern config set-job ${name} ${
          shellQuoteArgument(command ?? "<command>")
        }`;
      return fail(
        opts,
        `known job "${name}" does not take --provides. Run \`${correction}\`.`,
      );
    }
    if (
      applicabilitySelected &&
      (command !== undefined || runs.length > 0 || opts.timeout !== undefined ||
        producerEdits(`jobs.${name}`, opts).length > 0)
    ) {
      const correction = command !== undefined
        ? `discern config set-job ${name} ${shellQuoteArgument(command)}`
        : orderedJobCommand(name, nonEmptyRuns);
      return fail(
        opts,
        `an applicability declaration cannot also set commands. Run \`${correction}\` to configure the job; setting a command restores applicability.`,
      );
    }
    if (command !== undefined && runs.length > 0) {
      return fail(
        opts,
        `cannot combine the positional command with --run entries. Run \`${
          orderedJobCommand(name, [command, ...nonEmptyRuns])
        }\`.`,
      );
    }
    if (runs.length !== runCount || runs.length !== nonEmptyRuns.length) {
      return fail(
        opts,
        `each --run entry needs a non-empty command. Run \`${
          orderedJobCommand(name, nonEmptyRuns)
        }\`.`,
      );
    }
    if (opts.notApplicable === true || opts.applicable === true) {
      return await applyEditPlan(
        opts,
        (current) =>
          knownJobApplicabilityPlan(
            current,
            name,
            opts.applicable === true,
          ),
      );
    }
    if (command !== undefined) {
      const serialized = serializedCommandList(command);
      if (serialized !== undefined) {
        return fail(
          opts,
          `the positional value would be stored as one literal command, not an ordered list. Run \`${
            orderedJobCommand(name, serialized)
          }\`.`,
        );
      }
    }
    // Cliffy normalizes an explicitly empty optional positional argument to
    // undefined. Preserve the established "present but deferred" write by
    // treating an omitted known-job command as the empty command.
    const value = runs.length > 0 ? runs : command ?? "";
    const deferred = toCommandList(value).length === 0;
    const literal = Array.isArray(value)
      ? tomlStringArray(value)
      : tomlString(value);
    const facts = producerEdits(`jobs.${name}`, opts);
    if (opts.timeout !== undefined) {
      try {
        facts.push({
          key: `jobs.${name}.timeout`,
          literal: tomlNumber(opts.timeout),
        });
      } catch {
        return fail(
          opts,
          `--timeout must be a number (got "${opts.timeout}").`,
        );
      }
    }
    return await applyEditPlan(
      opts,
      (current) =>
        knownJobCommandPlan(
          current,
          name,
          literal,
          deferred ? [fire(HINTS["config-job-deferred"], { name })] : [],
          facts,
        ),
    );
  }
  if (applicabilitySelected) {
    return fail(
      opts,
      `job "${name}" is custom; applicability declarations accept known jobs only (${
        Object.keys(KNOWN_JOBS).join(", ")
      }). Run \`discern config set-job ${name} --stage check --run '<command>'\` to configure this custom job.`,
    );
  }
  if (command !== undefined) {
    return fail(
      opts,
      `custom job "${name}" uses the table form. Run \`discern config set-job ${name} --stage check --run ${
        shellQuoteArgument(command)
      }\`.`,
    );
  }
  if (opts.stage === undefined) {
    return fail(
      opts,
      `custom job "${name}" needs --stage (${
        STAGES.join(", ")
      }) and --run. Run \`discern config set-job ${name} --stage check --run '<command>'\`.`,
    );
  }
  if (!(STAGES as readonly string[]).includes(opts.stage)) {
    return fail(
      opts,
      `unknown stage "${opts.stage}". Run \`discern config set-job ${name} --stage check --run '<command>'\`; valid stages are ${
        STAGES.join(", ")
      }.`,
    );
  }
  if (runs.length === 0) {
    return fail(
      opts,
      `custom job "${name}" needs --run. Run \`discern config set-job ${name} --stage ${opts.stage} --run '<command>'\`.`,
    );
  }
  if (runs.length !== runCount || runs.length !== nonEmptyRuns.length) {
    return fail(
      opts,
      `each --run entry needs a non-empty command. Run \`discern config set-job ${name} --stage ${opts.stage} --run '<command>'\`.`,
    );
  }
  const edits: Edit[] = [
    { key: `jobs.${name}.stage`, literal: tomlString(opts.stage) },
    {
      key: `jobs.${name}.run`,
      literal: runs.length === 1
        ? tomlString(runs[0] ?? "")
        : tomlStringArray(runs),
    },
  ];
  if (opts.provides !== undefined) {
    edits.push({
      key: `jobs.${name}.provides`,
      literal: tomlString(opts.provides),
    });
  }
  if (opts.timeout !== undefined) {
    try {
      edits.push({
        key: `jobs.${name}.timeout`,
        literal: tomlNumber(opts.timeout),
      });
    } catch {
      return fail(opts, `--timeout must be a number (got "${opts.timeout}").`);
    }
  }
  edits.push(...producerEdits(`jobs.${name}`, opts));
  return await applyEdits(edits, opts, `Set job "${name}".`);
}

/** `config set-scope <name> <glob>... [--neutral] [--preview <cmd>] [--gate <cmd>]` */
export async function runConfigSetScope(
  name: string,
  globs: string[],
  opts: ConfigOptions & ProducerOptions & {
    neutral?: boolean | undefined;
    preview?: string | undefined;
    gate?: string | undefined;
    timeout?: string | undefined;
  },
): Promise<number> {
  if (globs.includes("--previewable")) {
    return fail(
      opts,
      "--previewable was replaced by --preview <cmd>; name the read-only command an agent can run.",
    );
  }
  if (!NAME_RE.test(name)) {
    return fail(
      opts,
      `scope name must be letters, digits, '_' or '-' (got "${name}").`,
    );
  }
  if (globs.length === 0) {
    return fail(opts, `set-scope needs at least one glob (e.g. "src/**").`);
  }
  const edits: Edit[] = [
    { key: `scopes.${name}.paths`, literal: tomlStringArray(globs) },
  ];
  if (opts.neutral) {
    edits.push({ key: `scopes.${name}.neutral`, literal: tomlBool(true) });
  }
  if (opts.preview !== undefined) {
    edits.push({
      key: `scopes.${name}.preview`,
      literal: tomlString(opts.preview),
    });
  }
  if (opts.gate !== undefined) {
    edits.push({ key: `scopes.${name}.gate`, literal: tomlString(opts.gate) });
  }
  if (opts.timeout !== undefined) {
    try {
      edits.push({
        key: `scopes.${name}.timeout`,
        literal: tomlNumber(opts.timeout),
      });
    } catch {
      return fail(opts, `--timeout must be a number (got "${opts.timeout}").`);
    }
  }
  edits.push(...producerEdits(`scopes.${name}`, opts));
  return await applyEdits(edits, opts, `Set scope "${name}".`);
}

/** Render a standard denominator flag as its canonical TOML literal. */
function standardPerLiteral(value: string): string {
  const extent = value.match(/^(files|lines|words|bytes)=(.+)$/);
  if (extent === null) return tomlString(value);
  const [, name, glob] = extent;
  if (name === undefined || glob === undefined || glob.trim() === "") {
    throw new Error("extent needs a non-empty glob");
  }
  return `{ ${name} = ${tomlString(glob)} }`;
}

/**
 * `config set-standard <name> --direction <up|down> --limit <n> --run <cmd> [--metric]`
 *
 * Every standard is a `[standards.<name>]` table — `coverage` is just a
 * conventional name. A standard produces with `run` or consumes an existing
 * `producer`; optional extraction receives captured output or an artifact.
 */
export async function runConfigSetStandard(
  name: string,
  opts: ConfigOptions & ProducerOptions & {
    limit: string;
    run?: string | undefined;
    producer?: string | undefined;
    extract?: string | undefined;
    artifact?: string | undefined;
    metric?: string | undefined;
    direction: string;
    per?: string | undefined;
    scale?: string | undefined;
    margin?: string | undefined;
    timeout?: string | undefined;
  },
): Promise<number> {
  if (!NAME_RE.test(name)) {
    return fail(
      opts,
      `standard name must be letters, digits, '_' or '-' (got "${name}").`,
    );
  }
  if ((opts.run === undefined) === (opts.producer === undefined)) {
    return fail(opts, "Set exactly one of --run or --producer.");
  }
  const direction = opts.direction;
  if (direction !== "up" && direction !== "down") {
    return fail(
      opts,
      `--direction must be "up" or "down" (got "${direction}").`,
    );
  }
  let limitLiteral: string;
  try {
    limitLiteral = tomlNumber(opts.limit);
  } catch {
    return fail(opts, `--limit must be a number (got "${opts.limit}").`);
  }

  const edits: Edit[] = [
    {
      key: `standards.${name}.metric`,
      literal: tomlString(opts.metric ?? name),
    },
    { key: `standards.${name}.direction`, literal: tomlString(direction) },
    { key: `standards.${name}.limit`, literal: limitLiteral },
    {
      key: `standards.${name}.run`,
      literal: opts.run === undefined ? null : tomlString(opts.run),
    },
    {
      key: `standards.${name}.producer`,
      literal: opts.producer === undefined ? null : tomlString(opts.producer),
    },
  ];
  if (opts.per !== undefined) {
    try {
      edits.push({
        key: `standards.${name}.per`,
        literal: standardPerLiteral(opts.per),
      });
    } catch {
      return fail(
        opts,
        `--per must be a metric name or one extent assignment such as lines=src/** (got "${opts.per}").`,
      );
    }
  }
  for (
    const [key, value] of [
      ["scale", opts.scale],
      ["margin", opts.margin],
      ["timeout", opts.timeout],
    ] as const
  ) {
    if (value === undefined) continue;
    try {
      edits.push({
        key: `standards.${name}.${key}`,
        literal: tomlNumber(value),
      });
    } catch {
      return fail(opts, `--${key} must be a number (got "${value}").`);
    }
  }
  for (const key of ["extract", "artifact"] as const) {
    const value = opts[key];
    if (value !== undefined) {
      edits.push({
        key: `standards.${name}.${key}`,
        literal: tomlString(value),
      });
    }
  }
  edits.push(...producerEdits(`standards.${name}`, opts));
  return await applyEdits(edits, opts, `Set standard "${name}".`);
}

/** `config set <dotted.key> <value> [--number|--bool|--string]` */
export async function runConfigSet(
  key: string,
  value: string,
  opts: ConfigOptions & { number?: boolean; bool?: boolean; string?: boolean },
): Promise<number> {
  if (key.split(".").length < 2) {
    return fail(opts, `key must be section.key (got "${key}").`);
  }
  // Refuse a key the schema doesn't know AT WRITE TIME, so `config set` can't
  // report success and leave a config the next read rejects (a typo'd section or
  // key). A valid-but-incomplete path (e.g. standards.coverage.limit before its
  // run) is allowed — only an unknown key/section is rejected.
  const expected = settableConfigValueKind(key);
  if (expected === undefined) {
    const [section, ...tail] = key.split(".");
    const successor = section === undefined
      ? undefined
      : retiredConfigKeySuccessor(section);
    if (section !== undefined && successor !== undefined) {
      const replacement = [successor, ...tail].join(".");
      return fail(
        opts,
        `config key "${key}" is not part of discern.toml; use "${replacement}".`,
        "renamed_config_key",
      );
    }
    return fail(
      opts,
      `unknown config key "${key}" — it is not part of the discern.toml schema (see \`discern docs config-reference\`). For custom gate work use \`config set-job\` with --stage and --run.`,
      "unknown_key",
    );
  }
  if ([opts.number, opts.bool, opts.string].filter(Boolean).length > 1) {
    return fail(opts, `give at most one of --number, --bool, --string.`);
  }
  if (expected.kind === "table") {
    return fail(
      opts,
      `"${key}" is a section, not a single key — set one of its keys instead (see \`discern docs config-reference\`).`,
    );
  }

  let literal: string;
  try {
    literal = renderTypedValue(key, value, expected, opts);
  } catch (error) {
    return fail(opts, error instanceof Error ? error.message : String(error));
  }
  return await applyEdits([{ key, literal }], opts, `Set ${key}.`);
}

/** The flag name a caller forced a type with, or undefined for none. */
function forcedTypeFlag(
  opts: { number?: boolean; bool?: boolean; string?: boolean },
): "--number" | "--bool" | "--string" | undefined {
  if (opts.number) return "--number";
  if (opts.bool) return "--bool";
  if (opts.string) return "--string";
  return undefined;
}

/**
 * Render a CLI value as the TOML literal the schema expects at `key` — the type
 * comes from the schema, never from the value's spelling, so a numeric-looking
 * slug stays a string and a single agent name lands as a one-element array. A
 * `--string`/`--number`/`--bool` flag that CONTRADICTS the schema is refused
 * (honouring it would write a config the next read rejects); only a `mixed`
 * (union-typed) key falls back to flag-forced or inferred rendering. Throws with
 * a user-ready message on any mismatch.
 */
function renderTypedValue(
  key: string,
  value: string,
  expected: Exclude<ConfigValueKind, { kind: "table" }>,
  opts: { number?: boolean; bool?: boolean; string?: boolean },
): string {
  const flag = forcedTypeFlag(opts);
  if (expected.kind === "string") {
    if (flag !== undefined && flag !== "--string") {
      throw new Error(
        `"${key}" holds a string, so ${flag} would write a value the next read rejects.`,
      );
    }
    if (expected.values !== undefined && !expected.values.includes(value)) {
      throw new Error(
        `"${key}" must be one of: ${
          expected.values.join(", ")
        } (got "${value}").`,
      );
    }
    return tomlString(value);
  }
  if (expected.kind === "number") {
    if (flag !== undefined && flag !== "--number") {
      throw new Error(
        `"${key}" holds a number, so ${flag} would write a value the next read rejects.`,
      );
    }
    try {
      return tomlNumber(value);
    } catch {
      throw new Error(`"${key}" holds a number (got "${value}").`);
    }
  }
  if (expected.kind === "boolean") {
    if (flag !== undefined && flag !== "--bool") {
      throw new Error(
        `"${key}" holds a boolean, so ${flag} would write a value the next read rejects.`,
      );
    }
    if (value !== "true" && value !== "false") {
      throw new Error(
        `"${key}" holds a boolean — use a bare true or false (got "${value}").`,
      );
    }
    return tomlBool(value === "true");
  }
  if (expected.kind === "string-array") {
    if (flag !== undefined) {
      throw new Error(
        `"${key}" holds an array of strings, so ${flag} would write a value the next read rejects.`,
      );
    }
    return renderStringArrayValue(key, value);
  }
  // A union-typed key (command-or-list, a standard `per`): no single required
  // type, so honour an explicit flag or infer from the value's spelling. The
  // write-time validation in applyEdits still backstops a wrong guess.
  return renderInferredValue(value, opts);
}

/**
 * Render a value for an array-of-strings key: a `["a", "b"]`-shaped value is
 * parsed as a TOML array and re-rendered canonically (so a stray comment or
 * trailing text can never ride into the file verbatim); any other value becomes
 * a one-element array — `config set project.agents claude_code` means
 * `agents = ["claude_code"]`.
 */
function renderStringArrayValue(key: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && !/[\r\n]/.test(trimmed)) {
    let parsed: { v?: unknown };
    try {
      parsed = parseToml(`v = ${trimmed}`) as { v?: unknown };
    } catch {
      throw new Error(
        `"${key}" holds an array of strings — pass one value (wrapped automatically) or a TOML array like ["a", "b"] (got "${value}").`,
      );
    }
    const items = parsed.v;
    if (
      !Array.isArray(items) ||
      !items.every((item): item is string => typeof item === "string")
    ) {
      throw new Error(
        `"${key}" holds an array of strings — every item must be a quoted string (got "${value}").`,
      );
    }
    return tomlStringArray(items);
  }
  return tomlStringArray([value]);
}

/**
 * Render a CLI value for a union-typed key. An explicit `--string`/`--number`/
 * `--bool` forces the type; otherwise it is inferred: `true`/`false` → bool, a
 * finite number → number, anything else → string.
 */
function renderInferredValue(
  value: string,
  opts: { number?: boolean; bool?: boolean; string?: boolean },
): string {
  if (opts.string) {
    return tomlString(value);
  }
  if (opts.bool) {
    if (value !== "true" && value !== "false") {
      throw new Error(
        `--bool value must be "true" or "false" (got "${value}").`,
      );
    }
    return tomlBool(value === "true");
  }
  if (opts.number) {
    return tomlNumber(value);
  }
  // Infer.
  if (value === "true" || value === "false") {
    return tomlBool(value === "true");
  }
  if (value.trim() !== "" && Number.isFinite(Number(value))) {
    return tomlNumber(value);
  }
  return tomlString(value);
}
