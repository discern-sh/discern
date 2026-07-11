/**
 * Structural guard for the `config set` write contract — the class behind two
 * shipped defects: `agents = "claude_code"` written where an array belongs, and
 * `limit = .5` written as unparseable TOML, both reported ok:true and left an
 * install every later command (doctor included) rejected.
 *
 * The contract, held over EVERY settable leaf path derived from the live Zod
 * schema (the single source of truth, so a new config key auto-enrols here with
 * nobody extending a list):
 *
 *   - exit 0  ⇒ the resulting discern.toml parses as TOML and validates against
 *               the schema, bar the documented incomplete-record allowance (a
 *               required key still MISSING inside a `[checks.<n>]`-family entry);
 *   - exit ≠0 ⇒ the file is byte-identical to what it was before.
 *
 * The oracle is independent of the production write-time check: raw @std/toml +
 * parseConfig, with the allowance re-derived from the issue's raw value being
 * absent — so a bug in `configWriteIssues` cannot vacuously pass this guard.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { z } from "@zod/zod";
import {
  configSchema,
  type ConfigValueKind,
  parseConfig,
  settableConfigValueKind,
} from "../src/shared/config_schema.ts";
import { runConfigSet } from "../src/commands/config.ts";
import { withTempDir } from "./helpers.ts";

/** A minimal valid install config the probes reset to between edits. */
const PRISTINE = `[project]
slug = "demo"
`;

/** True for a non-null, non-array object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Every settable LEAF path in the live schema, walked from the generated JSON
 * Schema: fixed properties recurse; a record section (additionalProperties)
 * substitutes the entry name `x`; anything else — scalar, array, or union — is
 * a leaf `config set` can target.
 */
function settableLeafPaths(
  node: Record<string, unknown>,
  prefix: string[],
): string[] {
  if (isRecord(node.properties)) {
    const out: string[] = [];
    for (const [key, child] of Object.entries(node.properties)) {
      if (isRecord(child)) {
        out.push(...settableLeafPaths(child, [...prefix, key]));
      }
    }
    return out;
  }
  if (isRecord(node.additionalProperties)) {
    return settableLeafPaths(node.additionalProperties, [...prefix, "x"]);
  }
  return prefix.length >= 2 ? [prefix.join(".")] : [];
}

/** Adversarial probe values per expected kind — each has historically been (or
 * plausibly is) the spelling that tricks value-based type inference. */
function probesFor(kind: ConfigValueKind): string[] {
  switch (kind.kind) {
    case "string":
      // Numeric-looking (must be quoted, never a TOML number) + a value outside
      // any enum vocabulary.
      return ["2048", "bogus-value"];
    case "number":
      // JS-numeric but invalid TOML (the corrupt-literal class) + a non-number.
      return [".5", "totally-not-a-number"];
    case "boolean":
      return ["true", "maybe"];
    case "string-array":
      // A bare scalar (must wrap, never land unquoted), a TOML array, junk.
      return ["single-value", '["a", "b"]', "[broken"];
    case "mixed":
      // Inference bait: numeric spelling against a union that may not take one.
      return [".5", "plain-command"];
    case "table":
      return [];
  }
}

/** The raw parsed value at a dotted issue path, or undefined when absent. */
function rawValueAt(raw: unknown, dotted: string): unknown {
  let node: unknown = raw;
  for (const seg of dotted.split(".")) {
    if (!isRecord(node)) {
      return undefined;
    }
    node = node[seg];
  }
  return node;
}

Deno.test("config set, over every schema leaf: success leaves a readable config, failure leaves no trace", async () => {
  const schemaJson = z.toJSONSchema(configSchema, { io: "input" }) as Record<
    string,
    unknown
  >;
  const leaves = settableLeafPaths(schemaJson, []);
  assert(leaves.length > 30, `suspiciously few leaves: ${leaves.length}`);

  await withTempDir(async (dir) => {
    const configPath = join(dir, "discern.toml");
    for (const leaf of leaves) {
      const kind = settableConfigValueKind(leaf);
      // The enumeration and the production path-walk share the schema; if they
      // ever disagree the walk has drifted from the source of truth.
      assert(
        kind !== undefined && kind.kind !== "table",
        `settableConfigValueKind disagrees with the schema walk at "${leaf}": ${
          JSON.stringify(kind)
        }`,
      );
      for (const probe of probesFor(kind)) {
        await Deno.writeTextFile(configPath, PRISTINE);
        const code = await runConfigSet(leaf, probe, {
          json: true,
          noColor: true,
          dryRun: false,
          cwd: dir,
        });
        const after = await Deno.readTextFile(configPath);
        const label = `config set ${leaf} ${JSON.stringify(probe)}`;

        if (code !== 0) {
          assertEquals(
            after,
            PRISTINE,
            `${label} failed but modified the file`,
          );
          continue;
        }
        // Success: the file must be TOML the config reader accepts…
        let raw: unknown;
        try {
          raw = parseToml(after);
        } catch (err) {
          throw new Error(
            `${label} reported success but corrupted the file into unparseable TOML: ${
              err instanceof Error ? err.message : String(err)
            }\n${after}`,
          );
        }
        // …and schema-valid, excusing only a key still MISSING inside an
        // incrementally-built record entry (never a present-but-wrong value).
        const { issues } = parseConfig(after);
        const blocking = issues.filter((i) =>
          rawValueAt(raw, i.path) !== undefined
        );
        assertEquals(
          blocking,
          [],
          `${label} reported success but left an invalid config:\n${after}`,
        );
      }
    }
  });
});
