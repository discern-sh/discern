/**
 * Class guard for "an MCP agent-facing string states a `discern.toml`-configurable
 * value as a fixed literal" — the MCP sibling of the guidance-render guard
 * (`guidance_render_test.ts`). The graduate_to / guidance.sources fixes templated
 * the GUIDANCE surface against config; this holds the MCP surface (every tool
 * description + title, and the instructions block for both locations) to the same
 * bar: a value it names must flow from config, never a baked-in default that
 * misleads a project which changed it.
 *
 * Driven off the SSOT — `mcpContext`'s own variable set — so a newly exposed
 * `{{var}}` can't ship without a metamorphic case here, and swapping any `{{var}}`
 * back to a literal makes that case stop tracking config. The render goes through the
 * SAME `renderMcpText` the server ships, so the guard can never pass on a render that
 * differs from production.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { z } from "@zod/zod";
import {
  buildInstructions,
  mcpContext,
  renderMcpText,
  TOOLS,
} from "../src/engine/mcp/server.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../src/shared/config_schema.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** The schema defaults with `patch` merged in — the metamorphic lever ("changing
 * this value changes the rendered surface"). `configSchema.parse({})` is the
 * fully-defaulted config (every section prefaulted). */
function configWith(patch: Record<string, unknown>): DiscernConfig {
  return configSchema.parse(patch);
}

/**
 * Every agent-facing string the server renders for `config`: each tool's
 * description + title (interpolated through the production `renderMcpText`), each
 * input schema's `.describe()` text (static — not interpolated, but scanned so a
 * stray literal there is caught too), and the instructions
 * (the fullest text). Joined into one blob for scanning.
 */
function mcpSurface(config: DiscernConfig): string {
  const parts: string[] = [];
  for (const tool of TOOLS) {
    parts.push(renderMcpText(tool.description, config));
    if (tool.title !== undefined) {
      parts.push(renderMcpText(tool.title, config));
    }
    if (tool.inputSchema !== undefined) {
      // The advertised input JSON Schema carries every `.describe()` string.
      parts.push(JSON.stringify(z.toJSONSchema(z.object(tool.inputSchema))));
    }
  }
  parts.push(renderMcpText(buildInstructions(), config));
  return parts.join("\n\n");
}

Deno.test("mcp surface: every config value it names flows from config — no hardcoded literal", () => {
  // The SSOT cases: each `mcpContext` var paired with a sentinel value to set it to,
  // the default literal that must NOT survive once it does, and `allow` — the CLOSED,
  // finite set of legitimate non-branch uses of an overloaded default token. "main"
  // is overloaded: as the integration BRANCH (the bug) it must interpolate, but as
  // the checkout/location ROLE ("the main checkout/repo") and the `data.location`
  // enum value (`"main"`) it is correct and stays. `allow` enumerates exactly those
  // legitimate uses — it is not a deny-list that grows, but the vocabulary in which
  // the token may appear; anything else is a hardcoded branch literal and fails.
  const cases: Record<string, {
    patch: Record<string, unknown>;
    sentinel: string;
    def: string;
    allow: string[];
  }> = {
    main_branch: {
      patch: { project: { main_branch: "zzbranch" } },
      sentinel: "zzbranch",
      def: "main",
      // `range.main` is the integrate payload's wire FIELD name (the incoming-tip
      // anchor) — a fixed schema key, not a branch literal.
      allow: ["main checkout", "main repo", '"main"', "range.main"],
    },
  };

  // SSOT coupling: the cases must name EXACTLY `mcpContext`'s variables — a newly
  // exposed var can't ship without a guard, and a removed one can't leave a dead
  // case behind (mirrors guidance_render_test's `Object.keys` coupling).
  assertEquals(
    Object.keys(cases).sort(),
    Object.keys(mcpContext(configWith({})).vars).sort(),
    "every mcpContext {{var}} needs a config-driven case here (and vice versa)",
  );

  const baseline = mcpSurface(configWith({}));
  for (const [name, c] of Object.entries(cases)) {
    const custom = mcpSurface(configWith(c.patch));

    // Config-driven: changing the value changes the rendered surface...
    assert(
      custom !== baseline,
      `${name}: changing its config must change the rendered surface`,
    );
    // ...the configured value actually reaches the surface (interpolation is real)...
    assert(
      custom.includes(c.sentinel),
      `${name}: the configured value "${c.sentinel}" must appear in the surface`,
    );
    // ...and the DEFAULT literal does not survive, outside its closed allow-list, so
    // nothing hardcodes it instead of interpolating `{{${name}}}`.
    let stripped = custom;
    for (const phrase of c.allow) {
      stripped = stripped.split(phrase).join(" ");
    }
    const escaped = c.def.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leak = new RegExp(`\\b${escaped}\\b`, "i");
    const offending = stripped.split("\n").filter((l) => leak.test(l));
    assert(
      offending.length === 0,
      `${name}: the default "${c.def}" still appears hardcoded in the MCP ` +
        `surface — interpolate {{${name}}} instead. Offending lines:\n${
          offending.join("\n")
        }`,
    );
  }
});

Deno.test("mcp server version imports KIT_VERSION instead of hardcoding semver", async () => {
  const source = await Deno.readTextFile(
    `${REPO}/src/engine/mcp/server.ts`,
  );
  assert(
    source.includes("KIT_VERSION"),
    "the MCP server should report the package version via KIT_VERSION",
  );
  assert(
    !/["'`]\d+\.\d+\.\d+["'`]/.test(source),
    "src/engine/mcp/server.ts must not contain a hardcoded semver literal; import KIT_VERSION instead",
  );
});
