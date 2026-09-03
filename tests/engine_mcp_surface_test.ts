/**
 * Class guard for "an MCP agent-facing string states a `discern.toml`-configurable
 * value as a fixed literal" — the MCP sibling of the instructions-render guard
 * (`instruction_render_test.ts`). The graduate_to / instructions.sources fixes templated
 * the INSTRUCTIONS surface against config; this holds the MCP surface (every tool
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

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { z } from "@zod/zod";
import {
  buildInstructions,
  mcpContext,
  mcpStartHint,
  renderMcpText,
  TOOLS,
  verbOf,
} from "../src/engine/mcp/server.ts";
import { CONSENT_GATED_VERBS } from "../src/shared/consent.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../src/shared/config_schema.ts";
import type { DiscernResult } from "../src/shared/result.ts";

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
      patch: { repository: { trunk: "zzbranch" } },
      sentinel: "zzbranch",
      def: "main",
      // `range.main` is the update payload's wire FIELD name (the incoming-tip
      // anchor) — a fixed schema key, not a branch literal.
      allow: ["main checkout", "main repo", '"main"', "range.main"],
    },
  };

  // SSOT coupling: the cases must name EXACTLY `mcpContext`'s variables — a newly
  // exposed var can't ship without a guard, and a removed one can't leave a dead
  // case behind (mirrors instruction_render_test's `Object.keys` coupling).
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

/**
 * Class guard for "the MCP prose names a tool argument no registered schema
 * declares". Every tool's input schema registers CLOSED (`strictInput` →
 * `z.strictObject`), so an argument the prose invents is not ignored — the call
 * is refused with an "Unrecognized key" validation error, and an agent following
 * the server's own instructions verbatim fails (or worse, retries stripped of the
 * argument and gets semantics the prose never promised). The accept `to:"…"`
 * text that outlived ADR 0110 was one member; this holds the whole surface.
 *
 * The detector extracts every ARGUMENT-SHAPED token — `key:"value"` (colon
 * immediately followed by a quote; prose colons carry a space) and `key=value`
 * flag examples — the exact shapes an agent copies into a tool call. Each must
 * resolve against a single source of truth: the tool's own declared input keys
 * (for its description/title/field-describe texts), the union of every tool's
 * input keys (for the shared instructions block and the start hint, which speak
 * about many tools), or a `DiscernResult` envelope field (prose legitimately
 * quotes result fields like `error:"precondition_failed"`).
 */

/** Every envelope field the prose may quote — compile-checked against
 * `DiscernResult` itself, so an entry that stops being a real field fails the
 * type-check rather than silently allowlisting a ghost. */
const ENVELOPE_KEYS = [
  "ok",
  "verb",
  "dry_run",
  "plan",
  "steps",
  "diagnostics",
  "data",
  "hints",
  "error",
  "message",
] as const satisfies readonly (keyof DiscernResult)[];

/** Argument-shaped tokens in agent-facing prose: `key:"value"` and
 * `key=value` (a quoted string, boolean, or number on the right). */
function argumentTokens(text: string): string[] {
  const names: string[] = [];
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)(?::"|=(?="|true\b|false\b|\d))/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** A tool's declared input keys — `[]` for a tool with no inputs. */
function inputKeys(tool: (typeof TOOLS)[number]): string[] {
  return tool.inputSchema === undefined ? [] : Object.keys(tool.inputSchema);
}

/** A tool's own agent-facing prose: description, title, and every input
 * field's `.describe()` text (NOT the JSON-Schema serialization, whose
 * structural `"key":"value"` pairs are not prose). */
function toolProse(tool: (typeof TOOLS)[number]): string {
  const parts = [tool.description];
  if (tool.title !== undefined) parts.push(tool.title);
  for (const field of Object.values(tool.inputSchema ?? {})) {
    const described = (field as z.ZodType).description;
    if (described !== undefined) parts.push(described);
  }
  return parts.join("\n\n");
}

Deno.test("mcp surface: confirmed belongs only to consent-gated tools", () => {
  const consentCommands = new Set(
    CONSENT_GATED_VERBS.filter((entry) =>
      new Set<string>(entry.surfaces).has("mcp")
    )
      .map((entry) => entry.command),
  );
  const carrying = TOOLS.filter((tool) => inputKeys(tool).includes("confirmed"))
    .map((tool) => verbOf(tool.name));
  assertEquals(new Set(carrying), consentCommands);
});

Deno.test("mcp surface: retired compatibility prose stays absent", () => {
  const residue = /\b(?:compatibility alias|deprecated|existing callers)\b/iu;
  const offenders = TOOLS.flatMap((tool) =>
    residue.test(toolProse(tool)) ? [tool.name] : []
  );
  assertEquals(offenders, []);
});

Deno.test("mcp surface: every argument-shaped token names a declared tool input", () => {
  const envelope = new Set<string>(ENVELOPE_KEYS);
  const offenders: string[] = [];
  const check = (
    source: string,
    text: string,
    allowed: ReadonlySet<string>,
  ): void => {
    for (const name of argumentTokens(text)) {
      if (!allowed.has(name) && !envelope.has(name)) {
        offenders.push(
          `${source} names "${name}" — no registered tool declares it, so a ` +
            `strict-schema call carrying it is refused`,
        );
      }
    }
  };

  // Per-tool prose is held to the tool's OWN schema — quoting another tool's
  // argument inside this tool's description would mislead just the same.
  const union = new Set<string>();
  for (const tool of TOOLS) {
    const own = new Set(inputKeys(tool));
    for (const key of own) union.add(key);
    check(tool.name, toolProse(tool), own);
  }

  // The instructions block and the start hint speak about the whole tool set.
  check("instructions", buildInstructions(), union);
  check("start hint", mcpStartHint("/project"), union);

  assert(
    offenders.length === 0,
    `MCP prose invents arguments the strict input schemas reject:\n` +
      offenders.join("\n"),
  );
});

Deno.test("mcp surface: every project-selecting path explains cross-project resolution", () => {
  const pathTools = TOOLS.filter((tool) => inputKeys(tool).includes("path"));
  assert(pathTools.length > 0, "expected project-operating tools with `path`");
  for (const tool of pathTools) {
    const field = tool.inputSchema?.path as z.ZodType | undefined;
    const description = field?.description?.toLowerCase() ?? "";
    assertStringIncludes(description, "absolute", tool.name);
    assertStringIncludes(description, "project", tool.name);
    assertStringIncludes(description, "omit", tool.name);
    assert(
      description.includes("worktree") || description.includes("repository"),
      `${tool.name} must explain that path can select another checkout`,
    );
    const prose = toolProse(tool).toLowerCase();
    assert(
      !prose.includes("server runs in") &&
        !prose.includes("cannot reach another"),
      `${tool.name} contradicts its cross-project path input`,
    );
  }
});

Deno.test("mcp surface: map and docs expose the same search funnel", () => {
  for (const name of ["discern_map", "discern_docs"]) {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert(tool !== undefined, `${name} is not registered`);
    assertEquals(inputKeys(tool).includes("search"), true, name);
    assertEquals(inputKeys(tool).includes("target"), true, name);
    const prose = toolProse(tool);
    assertStringIncludes(prose, "canonical target", name);
    assertStringIncludes(prose, "not recorded", name);
  }

  const docs = TOOLS.find((candidate) => candidate.name === "discern_docs");
  const map = TOOLS.find((candidate) => candidate.name === "discern_map");
  assert(docs !== undefined);
  assert(map !== undefined);
  for (
    const phrase of [
      "complete published product manual",
      "full match count",
      "reader-visible Markdown",
      "protected Map tiers",
    ]
  ) {
    assertStringIncludes(docs.description, phrase);
  }
  for (
    const phrase of [
      "configured project Map",
      "full index",
      "distinct from discern_docs",
    ]
  ) {
    assertStringIncludes(map.description, phrase);
  }
});

Deno.test("mcp surface: done exposes the explicit CI report mode", () => {
  const tool = TOOLS.find((candidate) => candidate.name === "discern_done");
  assert(tool !== undefined, "discern_done is not registered");
  assertEquals(inputKeys(tool).includes("ci"), true);
  const schema = JSON.stringify(z.toJSONSchema(z.object(tool.inputSchema)));
  assertStringIncludes(schema, "report checkpoint questions");
  assertStringIncludes(schema, "cannot be accepted");
});

Deno.test("renamed MCP tools retain the routing vocabulary agents need", () => {
  const anchors: Record<string, readonly string[]> = {
    discern_done: [
      "format",
      "lint",
      "type-check",
      "tests",
      "may rewrite files",
    ],
    discern_update: ["trunk's latest", "discern_accept", "discern_refresh"],
    discern_impact: ["scopes", "named regions of the repository"],
    discern_map: ["regions digest", "freshness facts"],
    discern_standards: [
      "numbers that can never get worse",
      "limits may only improve",
    ],
    discern_improvement: [
      "ranked next action",
      "health audit",
      "open qualitative reviews",
    ],
  };
  for (const [name, expected] of Object.entries(anchors)) {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert(tool !== undefined, `${name} is not registered`);
    for (const phrase of expected) {
      assertStringIncludes(tool.description, phrase);
    }
  }

  const standards = TOOLS.find((tool) => tool.name === "discern_standards");
  assert(standards !== undefined);
  assert(
    !/ratchet/i.test(standards.description),
    "standards description must route without the retired noun",
  );
});

Deno.test("mcp server version imports DISCERN_VERSION instead of hardcoding semver", async () => {
  const source = await Deno.readTextFile(
    `${REPO}/src/engine/mcp/server.ts`,
  );
  assert(
    source.includes("DISCERN_VERSION"),
    "the MCP server should report the package version via DISCERN_VERSION",
  );
  assert(
    !/["'`]\d+\.\d+\.\d+["'`]/.test(source),
    "src/engine/mcp/server.ts must not contain a hardcoded semver literal; import DISCERN_VERSION instead",
  );
});
