/**
 * The runtime config reader: one parse of the install config (`discern.toml`, or
 * a legacy `discern.toml`) via `@std/toml`, exposing the small accessor
 * surface the engine and recipes need. Replaces the shell `config.sh` + `toml.awk`
 * pair with a single typed reader.
 *
 * `@std/toml` is a full TOML parser, stricter than the lenient `toml.awk` it
 * replaces (Risk R4): a config the awk read leniently could now throw on parse.
 * The shipped template stays within strict TOML, and `doctor`/`migrate` surface
 * a parse failure rather than letting it pass silently.
 */

import { parse } from "@std/toml";
import { join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "./env.ts";

/** True for a non-null, non-array object (a TOML table). */
function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A friendly one-line summary of a TOML parse failure. `@std/toml`'s message is
 * accurate but cryptic (e.g. "key length is not a positive number, Parse error
 * on line 3, column 8"); lead with a plain "syntax error near line N in
 * discern.toml" when a line number is present, keeping the raw detail in parens.
 * Shared by {@link ConfigParseError} (engine verbs) and `parseDiscernToml`
 * (doctor/upgrade/migrate) so the diagnostic reads the same everywhere.
 */
export function tomlSyntaxHint(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).trim()
    // `@std/toml` sometimes repeats its own "Parse error on line N, column M:"
    // prefix; collapse the duplicate so the detail reads once.
    .replace(
      /(Parse error on line \d+, column \d+: )(?=Parse error on line \d+, column \d+: )/g,
      "",
    );
  const line = raw.match(/line (\d+)/i)?.[1];
  return line !== undefined
    ? `syntax error near line ${line} in discern.toml (${raw})`
    : `discern.toml is not valid TOML: ${raw}`;
}

/**
 * A clear, catchable error for an unparseable install config. Replaces the raw
 * `@std/toml` `SyntaxError` (which, uncaught, dumps a stack trace at a user who
 * merely has a config typo). The CLI's top-level handler turns this into a clean
 * one-line message and a non-zero exit, in both human and `--json` modes.
 */
export class ConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigParseError";
  }
}

/**
 * A parsed `discern.toml` with the engine's read accessors. Mirrors the
 * shell `config_get`/`config_array`/`config_subsections`/`config_keys`/
 * `config_has`/`config_bool`.
 */
export class Config {
  private readonly data: Record<string, unknown>;

  constructor(text: string) {
    try {
      this.data = parse(text) as Record<string, unknown>;
    } catch (err) {
      throw new ConfigParseError(tomlSyntaxHint(err));
    }
  }

  /** Load and parse the install config (`discern.toml`, or a legacy
   * `discern.toml`) from under a project `root`. */
  static async load(root: string): Promise<Config> {
    const rel = (await installedConfigRel(root)) ?? CONFIG_REL;
    return new Config(await Deno.readTextFile(join(root, rel)));
  }

  /** Resolve a dotted key to its raw parsed value, or undefined. */
  private resolve(key: string): unknown {
    let cur: unknown = this.data;
    for (const seg of key.split(".")) {
      if (!isTable(cur)) {
        return undefined;
      }
      cur = cur[seg];
    }
    return cur;
  }

  /**
   * A scalar as a string (numbers/booleans stringified), or `dflt` when absent.
   * Mirrors `config_get`.
   */
  get(key: string, dflt = ""): string {
    const v = this.resolve(key);
    if (typeof v === "string") {
      return v;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
    return dflt;
  }

  /** A numeric scalar, or undefined when absent/non-numeric. */
  getNumber(key: string): number | undefined {
    const v = this.resolve(key);
    if (typeof v === "number") {
      return v;
    }
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
    return undefined;
  }

  /** True only when the value is boolean `true` (or the string "true"). */
  bool(key: string): boolean {
    const v = this.resolve(key);
    return v === true || v === "true";
  }

  /**
   * Array of string items. Mirrors `config_array`: a TOML array yields its
   * items, a scalar yields a one-element list, an absent value yields `[]`.
   * Empty items and the `:` no-op are dropped. (Unlike the shell's incidental
   * comma-splitting of scalars, a scalar is taken whole — multi-command values
   * use a TOML array, as the config documents.)
   */
  array(key: string): string[] {
    const v = this.resolve(key);
    const items: string[] = [];
    const push = (s: string): void => {
      if (s !== "" && s !== ":") {
        items.push(s);
      }
    };
    if (Array.isArray(v)) {
      for (const it of v) {
        if (typeof it === "string") {
          push(it);
        } else if (typeof it === "number" || typeof it === "boolean") {
          push(String(it));
        }
      }
    } else if (typeof v === "string") {
      push(v);
    } else if (typeof v === "number" || typeof v === "boolean") {
      push(String(v));
    }
    return items;
  }

  /**
   * Immediate child table names under `prefix` (the `[prefix.<name>]` tables).
   * Mirrors `config_subsections`.
   */
  subsections(prefix: string): string[] {
    const t = this.resolve(prefix);
    if (!isTable(t)) {
      return [];
    }
    return Object.entries(t).filter(([, v]) => isTable(v)).map(([k]) => k);
  }

  /**
   * Flat key names declared directly in `[section]` (scalar/array values, not
   * nested tables). Mirrors `config_keys`.
   */
  keys(section: string): string[] {
    const t = this.resolve(section);
    if (!isTable(t)) {
      return [];
    }
    return Object.entries(t).filter(([, v]) => !isTable(v)).map(([k]) => k);
  }

  /** True when a key resolves to anything — a scalar, array, or table header. */
  has(key: string): boolean {
    return this.resolve(key) !== undefined;
  }
}
