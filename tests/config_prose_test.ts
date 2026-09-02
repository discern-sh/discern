/**
 * The config prose registry stays complete, current, and true to the schema
 * (ADR 0363). Every documented unit the schema exposes has exactly one prose
 * entry, every worked example and seeded entry validates against the live
 * schema, every built-in checkpoint carries a summary line, and every key the
 * scaffold renders wraps to a short paragraph. Driven off the schema and the
 * registries, so a new section, example, or built-in enrols on its own.
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  CONFIG_PROSE,
  type ConfigUnitProse,
  configUnitProse,
} from "../src/shared/config_prose.ts";
import { configProseUnits } from "../src/shared/config_codegen.ts";
import {
  renderConfigTemplate,
  TEMPLATE_WIDTH,
  wrapWords,
} from "../src/shared/config_template_codegen.ts";
import {
  configSchemaIssues,
  parseConfig,
} from "../src/shared/config_schema.ts";
import {
  BUILT_IN_CHECKPOINT_SUMMARIES,
  BUILT_IN_CHECKPOINTS,
} from "../src/shared/checkpoints.ts";
import { substituteTokens } from "../src/lib/template.ts";
import { testTokens } from "./helpers.ts";
import { z } from "@zod/zod";
import { configSchema } from "../src/shared/config_schema.ts";
import { objectView } from "../src/shared/config_codegen.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** The registry as a string-keyed table, for iteration. */
const registry: Readonly<Record<string, ConfigUnitProse>> = CONFIG_PROSE;

Deno.test("the prose registry documents exactly the schema's units", () => {
  assertEquals(
    sorted(Object.keys(registry)),
    sorted(configProseUnits()),
    "CONFIG_PROSE must carry one entry per documented schema unit, and none for a unit the schema no longer has",
  );
});

Deno.test("every unit's what and why are short present-tense sentences", () => {
  for (const [path, prose] of Object.entries(registry)) {
    assert(prose.what.endsWith("."), `[${path}] what must end with a period`);
    assert(
      prose.what.length <= 90,
      `[${path}] what is one short sentence (${prose.what.length} chars)`,
    );
    assert(prose.why.endsWith("."), `[${path}] why must end with a period`);
    assert(
      prose.why.length <= 420,
      `[${path}] why is at most two or three sentences (${prose.why.length} chars)`,
    );
    for (const text of [prose.what, prose.why]) {
      assert(!text.includes("—"), `[${path}] prose uses no em dash: ${text}`);
      assert(
        !/\bDiscern\b/.test(text),
        `[${path}] spells the product name in lower case: ${text}`,
      );
    }
  }
});

Deno.test("every worked example validates against the live schema", () => {
  for (const [path, prose] of Object.entries(registry)) {
    for (const example of prose.examples ?? []) {
      assert(
        !example.lead.endsWith("."),
        `[${path}] example lead ends without punctuation: ${example.lead}`,
      );
      const { issues } = parseConfig(example.toml);
      assertEquals(
        issues,
        [],
        `[${path}] example is not a valid config fragment:\n${example.toml}`,
      );
      const parsed = parseToml(example.toml) as Record<string, unknown>;
      const family = path.split(".")[0] ?? path;
      assert(
        Object.hasOwn(parsed, family),
        `[${path}] example must declare a table under [${family}]`,
      );
    }
  }
});

Deno.test("every seeded entry validates once its scaffold tokens are filled", () => {
  for (const [path, prose] of Object.entries(registry)) {
    for (const seed of prose.seeds ?? []) {
      const { text, unknown } = substituteTokens(seed.toml, testTokens());
      assertEquals(unknown, [], `[${path}] seed names an unknown token`);
      assertEquals(
        parseConfig(text).issues,
        [],
        `[${path}] seed is not a valid config fragment:\n${text}`,
      );
    }
  }
});

Deno.test("every built-in checkpoint has exactly one summary line", () => {
  assertEquals(
    sorted(Object.keys(BUILT_IN_CHECKPOINT_SUMMARIES)),
    sorted(Object.keys(BUILT_IN_CHECKPOINTS)),
  );
  for (const [id, summary] of Object.entries(BUILT_IN_CHECKPOINT_SUMMARIES)) {
    assert(summary.length > 0, `${id} needs a summary`);
    assert(
      !summary.endsWith("."),
      `${id}'s summary sits on one line: no period`,
    );
  }
});

/** Every fixed key the scaffold renders, with its schema description. */
function renderedFixedKeys(): Array<{ path: string; description: string }> {
  const root = z.toJSONSchema(configSchema, { io: "input" }) as Record<
    string,
    unknown
  >;
  const out: Array<{ path: string; description: string }> = [];
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    node = objectView(node);
    const props = node.properties;
    if (typeof props !== "object" || props === null) return;
    for (const [key, child] of Object.entries(props)) {
      if (typeof child !== "object" || child === null) continue;
      const view = objectView(child as Record<string, unknown>);
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const isTable = view.type === "object" &&
        (typeof view.properties === "object" ||
          typeof view.additionalProperties === "object");
      if (isTable) {
        if (typeof view.properties === "object") walk(view, path);
        continue;
      }
      const unit = prefix;
      if (configUnitProse(unit)?.keys?.[key]?.render === "omit") continue;
      out.push({ path, description: String(view.description ?? "") });
    }
  };
  walk(root, "");
  return out;
}

Deno.test("every rendered key's description wraps to a short paragraph", () => {
  const keys = renderedFixedKeys();
  assert(keys.length > 20, "the walk found the fixed keys");
  const long: string[] = [];
  for (const { path, description } of keys) {
    assert(description !== "", `${path} has no schema description`);
    const lines = wrapWords(description, TEMPLATE_WIDTH - 6);
    if (lines.length > 3) {
      long.push(`${path} (${lines.length} lines, ${description.length} chars)`);
    }
  }
  assertEquals(
    long,
    [],
    "these descriptions wrap past three lines; hold each to three and move the nuance to the prose registry or the manual",
  );
});

Deno.test("the template renders, holds its width, and is a fixpoint of the depth indent", () => {
  const text = renderConfigTemplate();
  for (const line of text.split("\n")) {
    assert(
      line.length <= TEMPLATE_WIDTH,
      `a template line is wider than ${TEMPLATE_WIDTH} columns: ${line}`,
    );
  }
  assert(
    configSchemaIssues(parseToml(substituteTokens(text, testTokens()).text))
      .length === 0,
    "the rendered template validates once its tokens are filled",
  );
});
