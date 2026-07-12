/**
 * `discern config <subcommand>` — programmatic, comment-preserving edits to an
 * existing `discern.toml` (ADR 0005). Lets a scaffolder or CI set capabilities,
 * checks, scopes, standards, and arbitrary scalars without re-implementing TOML
 * editing. Every subcommand honours `--json` and `--dry-run`.
 */

import { join, relative } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { Logger } from "../lib/log.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { CONFIG_REL } from "../shared/env.ts";
import {
  type ConfigValueKind,
  configWriteIssues,
  settableConfigValueKind,
  toCommandList,
} from "../shared/config_schema.ts";
import { KNOWN_CAPABILITIES, STAGES } from "../lib/config.ts";
import { retiredConfigKeySuccessor } from "../shared/vocabulary.ts";
import {
  tomlBool,
  TomlEditor,
  tomlNumber,
  tomlString,
  tomlStringArray,
} from "../lib/toml_edit.ts";

/** Options shared by every `config` subcommand (global flags folded in). */
export interface ConfigOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Project root to edit in; defaults to the process cwd. An injected seam so
   * tests can drive the editor without mutating the process working directory. */
  cwd?: string;
}

/** One planned edit: the dotted key and the rendered TOML value literal. */
interface Edit {
  key: string;
  literal: string;
}

/** TOML bare-key shape, enforced for check/scope/standard names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Emit a failure on the right surface and return exit code 1. */
function fail(
  opts: ConfigOptions,
  message: string,
  error = "invalid_argument",
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
async function applyEdits(
  edits: Edit[],
  opts: ConfigOptions,
  summary: string,
  hints: string[] = [],
): Promise<number> {
  const log = new Logger(opts);
  const root = opts.cwd ?? Deno.cwd();
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  // Report the install-relative config path (discern.toml, or a legacy location).
  const fileRel = relative(root, path);

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    const message = isMissing
      ? "no discern install here — run `discern setup` first, or cd into the project root."
      : `could not read the config: ${
        error instanceof Error ? error.message : String(error)
      }`;
    return fail(opts, message, isMissing ? "not_initialized" : "read_error");
  }

  let result: string;
  try {
    const editor = new TomlEditor(text);
    for (const edit of edits) {
      editor.setLiteral(edit.key, edit.literal);
    }
    result = editor.toString();
  } catch (error) {
    return fail(
      opts,
      `could not edit the config: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "edit_error",
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
    if (opts.json) {
      log.result({
        ok: true,
        verb: "config",
        dry_run: true,
        ...(hints.length > 0 ? { hints } : {}),
        data: { file: fileRel, edits },
      });
    } else {
      log.info("Dry run — would set:");
      for (const edit of edits) {
        log.line(`  ${edit.key} = ${edit.literal}`);
      }
      for (const hint of hints) {
        log.info(hint);
      }
    }
    return 0;
  }

  await Deno.writeTextFile(path, result);
  if (opts.json) {
    log.result({
      ok: true,
      verb: "config",
      ...(hints.length > 0 ? { hints } : {}),
      data: { file: fileRel, edits },
    });
  } else {
    log.ok(summary);
    for (const edit of edits) {
      log.line(`  ${edit.key} = ${edit.literal}`);
    }
    for (const hint of hints) {
      log.info(hint);
    }
  }
  return 0;
}

/**
 * `config set-capability <name> <command>`
 *
 * `<name>` must be a known capability (format/build/lint/typecheck/test/smoke);
 * the gate stage is derived by the engine. The CLI sets one command; the array
 * (multi-command) form is reachable via a config document.
 */
export async function runConfigSetCapability(
  name: string,
  command: string,
  opts: ConfigOptions,
): Promise<number> {
  if (!Object.hasOwn(KNOWN_CAPABILITIES, name)) {
    return fail(
      opts,
      `unknown capability "${name}". Known capabilities are: ${
        Object.keys(KNOWN_CAPABILITIES).join(", ")
      }. For custom work use \`config set-check\` with a stage.`,
    );
  }
  // A no-op value (the same test the gate and the assurance summary use) means
  // DEFERRED, not enforced — say so, rather than let a silent success read as
  // "wired".
  const deferred = toCommandList(command).length === 0;
  return await applyEdits(
    [{ key: `capabilities.${name}`, literal: tomlString(command) }],
    opts,
    `Set capability "${name}".`,
    deferred
      ? [
        `An empty command records "${name}" as deferred — present but a no-op, so the gate skips it. Add an inline # comment beside it saying why, or set a real command to enforce it.`,
      ]
      : [],
  );
}

/**
 * `config set-check <name> --stage <stage> --run <cmd> [--provides <label>]`
 *
 * Custom gate work outside the known capability vocabulary: an explicit stage
 * (fix/build/check/test), a command, and an optional free-text label.
 */
export async function runConfigSetCheck(
  name: string,
  opts: ConfigOptions & {
    stage: string;
    run: string;
    provides?: string | undefined;
  },
): Promise<number> {
  if (!NAME_RE.test(name)) {
    return fail(
      opts,
      `check name must be letters, digits, '_' or '-' (got "${name}").`,
    );
  }
  if (!(STAGES as readonly string[]).includes(opts.stage)) {
    return fail(
      opts,
      `unknown stage "${opts.stage}". Use one of: ${STAGES.join(", ")}.`,
    );
  }
  const edits: Edit[] = [
    { key: `checks.${name}.stage`, literal: tomlString(opts.stage) },
    { key: `checks.${name}.run`, literal: tomlString(opts.run) },
  ];
  if (opts.provides !== undefined) {
    edits.push({
      key: `checks.${name}.provides`,
      literal: tomlString(opts.provides),
    });
  }
  return await applyEdits(edits, opts, `Set check "${name}".`);
}

/** `config set-scope <name> <glob>... [--neutral] [--previewable] [--gate <cmd>]` */
export async function runConfigSetScope(
  name: string,
  globs: string[],
  opts: ConfigOptions & {
    neutral?: boolean | undefined;
    previewable?: boolean | undefined;
    gate?: string | undefined;
  },
): Promise<number> {
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
  if (opts.previewable) {
    edits.push({ key: `scopes.${name}.previewable`, literal: tomlBool(true) });
  }
  if (opts.gate !== undefined) {
    edits.push({ key: `scopes.${name}.gate`, literal: tomlString(opts.gate) });
  }
  return await applyEdits(edits, opts, `Set scope "${name}".`);
}

/**
 * `config set-standard <name> --limit <n> --run <cmd> [--metric] [--direction]`
 *
 * Every standard is a `[standards.<name>]` table — `coverage` is just a
 * conventional name, with no special handling. The `run` command emits the
 * metric line: `DISCERN_METRIC <metric> <number>`.
 */
export async function runConfigSetStandard(
  name: string,
  opts: ConfigOptions & {
    limit: string;
    run: string;
    metric?: string | undefined;
    direction?: string | undefined;
  },
): Promise<number> {
  if (!NAME_RE.test(name)) {
    return fail(
      opts,
      `standard name must be letters, digits, '_' or '-' (got "${name}").`,
    );
  }
  const direction = opts.direction ?? "up";
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
    { key: `standards.${name}.run`, literal: tomlString(opts.run) },
  ];
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
        `config key "${key}" was renamed; use "${replacement}". Run \`discern upgrade\` if the old key is already in discern.toml.`,
        "renamed_config_key",
      );
    }
    return fail(
      opts,
      `unknown config key "${key}" — it is not part of the discern.toml schema (see \`discern help config-reference\`). For custom gate work use \`config set-check\`.`,
      "unknown_key",
    );
  }
  if ([opts.number, opts.bool, opts.string].filter(Boolean).length > 1) {
    return fail(opts, `give at most one of --number, --bool, --string.`);
  }
  if (expected.kind === "table") {
    return fail(
      opts,
      `"${key}" is a section, not a single key — set one of its keys instead (see \`discern help config-reference\`).`,
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
 * a one-element array — `config set guidance.agents claude_code` means
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
