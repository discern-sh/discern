/**
 * `icculus config <subcommand>` — programmatic, comment-preserving edits to an
 * existing `icculus.toml` (ADR 0005). Lets a scaffolder or CI set slots, scopes,
 * side-gates, ratchets, and arbitrary scalars without re-implementing TOML
 * editing. Every subcommand honours `--json` and `--dry-run`.
 */

import { join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { KNOWN_PHASES } from "../lib/config.ts";
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

/** TOML bare-key shape, enforced for slot/scope/side-gate/ratchet names. */
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
 * Load `icculus.toml` from the cwd, apply the edits through `TomlEditor`
 * (preserving comments), and write it back — or, with `--dry-run`, report what
 * would change and write nothing. `summary` is the human success line.
 */
async function applyEdits(
  edits: Edit[],
  opts: ConfigOptions,
  summary: string,
): Promise<number> {
  const log = new Logger(opts);
  const path = join(Deno.cwd(), "icculus.toml");

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    const message = isMissing
      ? "no icculus.toml here — run `icculus init` first, or cd into the project root."
      : `could not read icculus.toml: ${
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
      `could not edit icculus.toml: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "edit_error",
    );
  }

  if (opts.dryRun) {
    if (opts.json) {
      log.jsonResult({ ok: true, dry_run: true, file: "icculus.toml", edits });
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
    log.jsonResult({ ok: true, file: "icculus.toml", edits });
  } else {
    log.ok(summary);
    for (const edit of edits) {
      log.line(`  ${edit.key} = ${edit.literal}`);
    }
  }
  return 0;
}

/**
 * `config set-slot <name> [--phase <phase>] --run <cmd>`
 *
 * Omit `--phase` to define a MEASUREMENT slot: one the gate never runs, that a
 * `[ratchets.<name>]` references to read a metric on demand.
 */
export async function runConfigSetSlot(
  name: string,
  opts: ConfigOptions & { phase?: string; run: string },
): Promise<number> {
  if (!NAME_RE.test(name)) {
    return fail(
      opts,
      `slot name must be letters, digits, '_' or '-' (got "${name}").`,
    );
  }
  const edits: Edit[] = [];
  if (opts.phase !== undefined) {
    if (!(KNOWN_PHASES as readonly string[]).includes(opts.phase)) {
      return fail(
        opts,
        `unknown phase "${opts.phase}". Use one of: ${
          KNOWN_PHASES.join(", ")
        } (or omit --phase for a measurement slot).`,
      );
    }
    edits.push({ key: `slots.${name}.phase`, literal: tomlString(opts.phase) });
  }
  edits.push({ key: `slots.${name}.run`, literal: tomlString(opts.run) });
  return await applyEdits(edits, opts, `Set slot "${name}".`);
}

/** `config set-scope <name> <glob>...` */
export async function runConfigSetScope(
  name: string,
  globs: string[],
  opts: ConfigOptions,
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
  return await applyEdits(
    [{ key: `scopes.${name}`, literal: tomlStringArray(globs) }],
    opts,
    `Set scope "${name}".`,
  );
}

/** `config set-side-gate <scope> --run <cmd>` */
export async function runConfigSetSideGate(
  scope: string,
  opts: ConfigOptions & { run: string },
): Promise<number> {
  if (!NAME_RE.test(scope)) {
    return fail(
      opts,
      `side-gate scope must be letters, digits, '_' or '-' (got "${scope}").`,
    );
  }
  return await applyEdits(
    [{ key: `scopes.side_gates.${scope}`, literal: tomlString(opts.run) }],
    opts,
    `Set side gate "${scope}".`,
  );
}

/**
 * `config set-ratchet <name> --limit <n> --slot <slot> [--metric] [--direction]`
 *
 * Every ratchet is a `[ratchets.<name>]` table — `coverage` is just a
 * conventional name, with no special handling.
 */
export async function runConfigSetRatchet(
  name: string,
  opts: ConfigOptions & {
    limit: string;
    slot: string;
    metric?: string;
    direction?: string;
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
    { key: `ratchets.${name}.slot`, literal: tomlString(opts.slot) },
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
