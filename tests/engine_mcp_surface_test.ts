/**
 * MCP surface contract guards, driven from the live tool registry.
 *
 * Guards: claim:agent-as-operator
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { z } from "@zod/zod";
import {
  buildInstructions,
  CODEX_INSTRUCTIONS_PREFIX_CHARS,
  MCP_INSTRUCTIONS_BYTE_LIMIT,
  MCP_TOOL_DESCRIPTION_BYTE_LIMIT,
  mcpStartHint,
  toolDescriptionForProfile,
  TOOLS,
  verbOf,
} from "../src/engine/mcp/server.ts";
import { CONSENT_GATED_VERBS } from "../src/shared/consent.ts";
import type { DiscernResult } from "../src/shared/result.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** Every static agent-facing string advertised by the server. */
function mcpSurface(): string {
  const parts: string[] = [];
  for (const tool of TOOLS) {
    parts.push(tool.description);
    if (tool.title !== undefined) {
      parts.push(tool.title);
    }
    if (tool.inputSchema !== undefined) {
      // The advertised input JSON Schema carries every `.describe()` string.
      parts.push(JSON.stringify(z.toJSONSchema(z.object(tool.inputSchema))));
    }
  }
  parts.push(buildInstructions());
  return parts.join("\n\n");
}

Deno.test("mcp surface: descriptions are target-generic and carry no startup interpolation", () => {
  const surface = mcpSurface();
  assert(!surface.includes("{{"), surface);
  for (const name of ["discern_start", "discern_update", "discern_accept"]) {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert(tool !== undefined, `${name} is not registered`);
    assertStringIncludes(
      tool.description,
      "selected project's configured trunk",
    );
  }
});

Deno.test("mcp surface: instructions lead with a complete Codex routing paragraph", () => {
  const instructions = buildInstructions();
  assert(
    new TextEncoder().encode(instructions).length < MCP_INSTRUCTIONS_BYTE_LIMIT,
    instructions,
  );
  const paragraphEnd = instructions.indexOf("\n\n");
  assert(paragraphEnd > 0 && paragraphEnd <= CODEX_INSTRUCTIONS_PREFIX_CHARS);
  const paragraph = instructions.slice(0, paragraphEnd);
  for (
    const name of [
      "discern_status",
      "discern_start",
      "discern_done",
      "discern_accept",
    ]
  ) {
    assertStringIncludes(paragraph, name);
  }
  assert(/[.!?]$/.test(paragraph), paragraph);

  const tokens = new Set(instructions.match(/\bdiscern_[a-z_]+\b/g) ?? []);
  assertEquals(tokens, new Set(TOOLS.map((tool) => tool.name)));
});

Deno.test("mcp surface: every advertised tool description stays within its byte budget", () => {
  for (const profile of ["long-client", "strict-client"] as const) {
    for (const tool of TOOLS) {
      const description = toolDescriptionForProfile(tool, profile);
      const bytes = new TextEncoder().encode(description).length;
      assert(
        bytes <= MCP_TOOL_DESCRIPTION_BYTE_LIMIT,
        `${profile} ${tool.name}: ${bytes} bytes exceeds ${MCP_TOOL_DESCRIPTION_BYTE_LIMIT}`,
      );
      if (
        profile === "strict-client" && tool.annotations?.readOnlyHint !== true
      ) {
        assertStringIncludes(description, "60 seconds", tool.name);
        assertStringIncludes(description, "discern done --markdown", tool.name);
      }
    }
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

type JsonObject = Record<string, unknown>;

/** Narrow an unknown JSON Schema fragment to its object representation. */
function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

/** Direct property names offered by every object branch of one JSON Schema. */
function schemaObjectProperties(schema: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    const object = asObject(value);
    if (object === undefined) return;
    const properties = asObject(object.properties);
    if (properties !== undefined) {
      for (const name of Object.keys(properties)) found.add(name);
    }
    for (const key of ["anyOf", "oneOf", "allOf"] as const) {
      const branches = object[key];
      if (Array.isArray(branches)) branches.forEach(visit);
    }
  };
  visit(schema);
  return found;
}

Deno.test("mcp surface: every described data field exists in that tool's output schema", () => {
  const failures: string[] = [];
  for (const tool of TOOLS) {
    assert(
      tool.outputSchema !== undefined,
      `${tool.name} needs an output schema`,
    );
    const schema = asObject(z.toJSONSchema(tool.outputSchema));
    const properties = asObject(schema?.properties);
    const dataFields = schemaObjectProperties(properties?.data);
    const described = new Set(
      [...toolProse(tool).matchAll(/\bdata\.([a-z][a-z0-9_]*)\b/g)]
        .flatMap((match) => match[1] === undefined ? [] : [match[1]]),
    );
    for (const field of described) {
      if (!dataFields.has(field)) failures.push(`${tool.name}: data.${field}`);
    }
  }
  assertEquals(failures, []);
});

Deno.test("mcp surface: done declarations preserve their deliberate asymmetry", () => {
  const done = TOOLS.find((tool) => tool.name === "discern_done");
  assert(done !== undefined);
  const schema = asObject(z.toJSONSchema(z.strictObject(done.inputSchema)));
  const properties = asObject(schema?.properties);
  assertEquals(asObject(properties?.met)?.type, "array");
  const unmet = asObject(properties?.unmet);
  assertEquals(unmet?.type, "object");
  assertEquals(unmet?.additionalProperties, false);
  assertEquals(unmet?.required, ["id", "why"]);
});

Deno.test("mcp surface: confirmed belongs only to consent-gated tools", () => {
  const consentCommands = new Set(
    CONSENT_GATED_VERBS.filter((entry) =>
      new Set<string>(entry.surfaces).has("mcp")
    )
      // MCP actions share the tool for their owning top-level verb.
      .map((entry) => entry.command.split(" ")[0]),
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
      "protected map tiers",
    ]
  ) {
    assertStringIncludes(docs.description, phrase);
  }
  for (
    const phrase of [
      "configured project map",
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
    discern_update: [
      "selected project's configured trunk",
      "discern_accept",
      "discern_refresh",
    ],
    discern_impact: ["scopes", "named regions of the repository"],
    discern_map: ["regions digest", "freshness facts"],
    discern_standards: [
      "Select action: measure",
      "every simultaneous breach",
      "technical justification only",
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
  assertEquals(inputKeys(standards).includes("names"), true);
  assertEquals(inputKeys(standards).includes("pin_names"), false);
  assert(
    !/ratchet/i.test(standards.description),
    "standards description must route without the retired noun",
  );
  const coupling = TOOLS.find((tool) => tool.name === "discern_coupling");
  assertEquals(coupling?.title, "Show co-change coupling");
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

Deno.test("acceptance describes verified grants without requiring a new conversation request", () => {
  const accept = TOOLS.find((tool) => tool.name === "discern_accept");
  assert(accept !== undefined);
  assertStringIncludes(
    accept.description,
    "explicit owner consent or machine-verified authority",
  );
  assert(
    !/only when the (?:user|owner) explicitly asks/i.test(accept.description),
  );
  assertStringIncludes(
    accept.description,
    "the call records the submission",
  );
  assertStringIncludes(
    accept.description,
    "A trunk that moved after the Proof is composed and re-proven in a " +
      "disposable integration worktree",
  );
  assertStringIncludes(
    accept.description,
    "Recorded grants never cover a checkpoint variance or standard proposal",
  );
});
