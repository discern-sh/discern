/**
 * **Raw, untyped** dotted-key access to a parsed `discern.toml`. The engine reads
 * the config through the typed schema (`config_schema.ts`, `loadConfig`); this
 * module is the narrow exception for the two jobs that genuinely need an
 * un-validated, generic reader and must NOT trip schema validation:
 *
 *   - `discern config <get|array|has|subsections|keys> <key>` — the Project-Script-facing
 *     passthrough, a `jq`-for-the-config that reads arbitrary dotted keys verbatim.
 *   - the Standard baseline, which reads an *older* config out of
 *     `git show main:discern.toml` and compares its definition and bound without
 *     requiring that historical config to satisfy today's complete schema.
 *
 * It carries no schema knowledge, so there is nothing here to drift. The TOML
 * syntax diagnostics and the typed loader live in `config_schema.ts`; the errors
 * are re-exported here so existing importers keep resolving.
 */

import { parse } from "@std/toml";
import { join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "./env.ts";
import { ConfigParseError, tomlSyntaxHint } from "./config_schema.ts";

export { ConfigParseError, tomlSyntaxHint } from "./config_schema.ts";

/** True for a non-null, non-array object (a TOML table). */
function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A raw view of a parsed `discern.toml` exposing generic dotted-key reads. Unlike
 * the typed {@link import("./config_schema.ts").DiscernConfig}, it applies no
 * schema, no defaults, and no validation — it returns exactly what is on disk.
 */
export class RawConfig {
  private readonly data: Record<string, unknown>;

  constructor(text: string) {
    try {
      this.data = parse(text) as Record<string, unknown>;
    } catch (err) {
      throw new ConfigParseError(tomlSyntaxHint(err));
    }
  }

  /** Read `discern.toml` under a project `root` as a raw, un-validated view. */
  static async load(root: string): Promise<RawConfig> {
    const rel = (await installedConfigRel(root)) ?? CONFIG_REL;
    return new RawConfig(await Deno.readTextFile(join(root, rel)));
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

  /** A scalar as a string (numbers/booleans stringified), or `dflt` when absent. */
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

  /**
   * Array of string items: a TOML array yields its items, a scalar yields a
   * one-element list, an absent value yields `[]`. Empty items and the `:` no-op
   * are dropped.
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

  /** Immediate child table names under `prefix` (the `[prefix.<name>]` tables). */
  subsections(prefix: string): string[] {
    const t = this.resolve(prefix);
    if (!isTable(t)) {
      return [];
    }
    return Object.entries(t).filter(([, v]) => isTable(v)).map(([k]) => k);
  }

  /** Flat key names declared directly in `[section]` (scalars/arrays, not tables). */
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
