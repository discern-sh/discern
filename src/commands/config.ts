/**
 * `discern config <subcommand>` — programmatic, comment-preserving edits to an
 * existing `discern.toml` (ADR 0005). Lets a scaffolder or CI set capabilities,
 * checks, scopes, ratchets, and arbitrary scalars without re-implementing TOML
 * editing. Every subcommand honours `--json` and `--dry-run`.
 */

import { join, relative } from "@std/path";
import { Logger } from "../lib/log.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { CONFIG_REL } from "../shared/env.ts";
import { KNOWN_CAPABILITIES, STAGES } from "../lib/config.ts";
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
}

/** One planned edit: the dotted key and the rendered TOML value literal. */
interface Edit {
  key: string;
  literal: string;
}

/** TOML bare-key shape, enforced for check/scope/ratchet names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Emit a failure on the right surface and return exit code 1. */
function fail(
  opts: ConfigOptions,
  message: string,
  error = "invalid_argument",
): number {
  const log = new Logger(opts);
  if (opts.json) {
    log.jsonResult({ ok: false, error, message });
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
): Promise<number> {
  const log = new Logger(opts);
  const path = (await resolveConfigPath(Deno.cwd())) ??
    join(Deno.cwd(), CONFIG_REL);
  // Report the install-relative config path (discern.toml, or a legacy location).
  const fileRel = relative(Deno.cwd(), path);

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    const message = isMissing
      ? "no discern install here — run `discern init` first, or cd into the project root."
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

  if (opts.dryRun) {
    if (opts.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        file: fileRel,
        edits,
      });
    } else {
      log.info("Dry run — would set:");
      for (const edit of edits) {
        log.line(`  ${edit.key} = ${edit.literal}`);
      }
    }
    return 0;
  }

  await Deno.writeTextFile(path, result);
  if (opts.json) {
    log.jsonResult({ ok: true, file: fileRel, edits });
  } else {
    log.ok(summary);
    for (const edit of edits) {
      log.line(`  ${edit.key} = ${edit.literal}`);
    }
  }
  return 0;
}

/**
 * `config set-capability <name> <command>`
 *
 * `<name>` must be a known capability (format/build/lint/typecheck/test); the
 * gate stage is derived by the engine. The CLI sets one command; the array
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
  return await applyEdits(
    [{ key: `capabilities.${name}`, literal: tomlString(command) }],
    opts,
    `Set capability "${name}".`,
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
 * `config set-ratchet <name> --limit <n> --run <cmd> [--metric] [--direction]`
 *
 * Every ratchet is a `[ratchets.<name>]` table — `coverage` is just a
 * conventional name, with no special handling. The `run` command emits the
 * metric line: `DISCERN_METRIC <metric> <number>`.
 */
export async function runConfigSetRatchet(
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
      `ratchet name must be letters, digits, '_' or '-' (got "${name}").`,
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
      key: `ratchets.${name}.metric`,
      literal: tomlString(opts.metric ?? name),
    },
    { key: `ratchets.${name}.direction`, literal: tomlString(direction) },
    { key: `ratchets.${name}.limit`, literal: limitLiteral },
    { key: `ratchets.${name}.run`, literal: tomlString(opts.run) },
  ];
  return await applyEdits(edits, opts, `Set ratchet "${name}".`);
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
  if ([opts.number, opts.bool, opts.string].filter(Boolean).length > 1) {
    return fail(opts, `give at most one of --number, --bool, --string.`);
  }

  let literal: string;
  try {
    literal = renderTypedValue(value, opts);
  } catch (error) {
    return fail(opts, error instanceof Error ? error.message : String(error));
  }
  return await applyEdits([{ key, literal }], opts, `Set ${key}.`);
}

/**
 * Render a CLI value to a TOML literal. An explicit `--string`/`--number`/`--bool`
 * forces the type; otherwise the type is inferred: `true`/`false` → bool, a finite
 * number → number, anything else → string.
 */
function renderTypedValue(
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
