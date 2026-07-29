/**
 * The both-surfaces render pass over the hint registry: every entry renders
 * for the CLI and for MCP, and the renderings honor the per-surface contract —
 * the MCP text never spells a tool-backed verb in its bare CLI form (owner
 * relays excepted), every tool-less reference ties back to the shell-only
 * declaration beside TOOLS, every rendered MCP parameter exists on the target
 * tool's input schema, and the CLI text never names a `discern_*` tool unless
 * the entry declares MCP-only delivery.
 *
 * The checks run through one pure checker so the synthetic negatives can
 * prove each rule fails on a seeded defect (the config-codegen guard's
 * pattern), while the live pass drives the checker with the REAL renderer,
 * TOOLS lookup, and shell-only declaration the server ships.
 */

import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { HINTS } from "../src/shared/hints.ts";
import {
  type CommandReference,
  extractCommandRefs,
  type McpToolLookup,
  renderCliReference,
  renderCommandRefsCli,
  renderCommandRefsMcp,
} from "../src/shared/command_reference.ts";
import {
  MCP_SHELL_ONLY_VERBS,
  mcpToolNameForVerb,
  TOOLS,
} from "../src/engine/mcp/server.ts";
import { quotedDiscernCommands } from "./command_span_scan.ts";

/** The surface facts the checker judges against — injected so the negatives
 * can seed a defective world while the live pass uses the real one. */
interface SurfaceContract {
  toolFor: McpToolLookup;
  shellOnlyVerbs: ReadonlySet<string>;
  /** Advertised input-parameter names for one tool, or undefined if unknown. */
  toolParams: (toolName: string) => ReadonlySet<string> | undefined;
}

/** The MCP parameter names one reference renders (mirrors the renderer). */
function renderedParamNames(ref: CommandReference): string[] {
  const names: string[] = [];
  for (const arg of ref.args) {
    if ("flag" in arg) {
      if (arg.flag === "json") continue;
      names.push(arg.flag.replaceAll("-", "_"));
    } else if ("positional" in arg) {
      names.push(arg.positional.replaceAll("-", "_"));
    }
  }
  return names;
}

/** Judge one authored hint text against the per-surface rendering contract. */
function surfaceRenderingFindings(
  id: string,
  authored: string,
  delivery: "mcp" | undefined,
  contract: SurfaceContract,
): string[] {
  const findings: string[] = [];
  const refs = extractCommandRefs(authored);
  const cliText = renderCommandRefsCli(authored);
  const mcpText = renderCommandRefsMcp(authored, contract.toolFor);

  // The CLI rendering may not name an MCP tool — an agent on the CLI cannot
  // call one. MCP-only entries are the declared exception.
  if (delivery !== "mcp" && /discern_[a-z_]+/.test(cliText)) {
    findings.push(`${id}: CLI rendering names an MCP tool`);
  }

  // CLI spellings allowed to appear in the MCP text: owner-relayed commands
  // and shell-only fallbacks (their word paths are not tool-backed).
  const ownerSpans: string[] = [];
  for (const ref of refs) {
    if (ref.executor === "owner") {
      ownerSpans.push(renderCliReference(ref).slice(1, -1));
      continue;
    }
    const tool = ref.words === "" ? undefined : contract.toolFor(ref.words);
    if (tool === undefined) {
      const [first] = ref.words.split(" ");
      if (ref.words !== "" && !contract.shellOnlyVerbs.has(first ?? "")) {
        findings.push(
          `${id}: references \`discern ${ref.words}\`, whose verb is neither ` +
            "tool-backed nor declared shell-only",
        );
      }
      continue;
    }
    const params = contract.toolParams(tool);
    for (const name of renderedParamNames(ref)) {
      if (params !== undefined && !params.has(name)) {
        findings.push(
          `${id}: renders parameter "${name}" that \`${tool}\` does not advertise`,
        );
      }
    }
  }

  // No tool-backed verb may survive in bare CLI spelling on the MCP surface;
  // every such span must be one an owner reference produced.
  const unclaimed = [...ownerSpans];
  for (const span of quotedDiscernCommands(mcpText)) {
    const word = span.replace(/^discern\s*/, "").split(" ")[0] ?? "";
    if (word === "" || word.startsWith("-")) continue;
    if (contract.toolFor(word) === undefined) continue;
    const at = unclaimed.indexOf(span);
    if (at === -1) {
      findings.push(
        `${id}: MCP rendering carries the bare CLI spelling \`${span}\` for a tool-backed verb`,
      );
    } else {
      unclaimed.splice(at, 1);
    }
  }

  return findings;
}

/** The live contract: the server's renderer inputs, verbatim. */
function liveContract(): SurfaceContract {
  const paramsByTool = new Map<string, ReadonlySet<string>>(
    TOOLS.map((tool) => [
      tool.name,
      new Set(Object.keys(z.object(tool.inputSchema).shape)),
    ]),
  );
  return {
    toolFor: mcpToolNameForVerb,
    shellOnlyVerbs: new Set(MCP_SHELL_ONLY_VERBS.keys()),
    toolParams: (toolName) => paramsByTool.get(toolName),
  };
}

Deno.test("every hint renders surface-faithfully on both surfaces", () => {
  const contract = liveContract();
  const failures: string[] = [];
  let referenced = 0;
  for (const [key, value] of Object.entries(HINTS)) {
    const def = value as {
      example: unknown;
      delivery?: "mcp";
      template: (params: unknown) => string;
    };
    const authored = def.template(def.example);
    referenced += extractCommandRefs(authored).length;
    failures.push(
      ...surfaceRenderingFindings(key, authored, def.delivery, contract),
    );
  }
  assert(referenced > 0, "the render pass found no references — broken scan");
  assertEquals(
    failures,
    [],
    `hints must render surface-faithfully:\n  ${failures.join("\n  ")}`,
  );
});

// ── the synthetic negatives: each rule provably fails on a seeded defect ────

const SEEDED: SurfaceContract = {
  toolFor: (words) => words === "start" ? "discern_start" : undefined,
  shellOnlyVerbs: new Set(["setup"]),
  toolParams: (tool) =>
    tool === "discern_start"
      ? new Set(["name", "from", "dry_run", "path"])
      : undefined,
};

Deno.test("a reference to a verb that is neither tool-backed nor declared shell-only is rejected", () => {
  const authored =
    '⟦discern-cmd:{"words":"status","args":[],"executor":"caller"}⟧';
  const findings = surfaceRenderingFindings(
    "seeded",
    authored,
    undefined,
    SEEDED,
  );
  assertEquals(findings.length, 1);
  assert(findings[0]?.includes("neither tool-backed nor declared shell-only"));
});

Deno.test("a rendered parameter missing from the tool schema is rejected", () => {
  const authored =
    '⟦discern-cmd:{"words":"start","args":[{"flag":"verbose"}],"executor":"caller"}⟧';
  const findings = surfaceRenderingFindings(
    "seeded",
    authored,
    undefined,
    SEEDED,
  );
  assertEquals(findings.length, 1);
  assert(findings[0]?.includes('parameter "verbose"'));
});

Deno.test("a bare CLI spelling for a tool-backed verb in the MCP rendering is rejected", () => {
  // Prose-spelled (no reference) — the completeness guard also rejects it,
  // and this pass proves the MCP rendering itself cannot smuggle it through.
  const findings = surfaceRenderingFindings(
    "seeded",
    "run `discern start` now",
    undefined,
    SEEDED,
  );
  assertEquals(findings.length, 1);
  assert(findings[0]?.includes("bare CLI spelling"));
});

Deno.test("an owner-relayed command keeps its CLI spelling without a finding", () => {
  const authored =
    '⟦discern-cmd:{"words":"start","args":[],"executor":"owner"}⟧';
  assertEquals(
    surfaceRenderingFindings("seeded", authored, undefined, SEEDED),
    [],
  );
});

Deno.test("a CLI rendering that names an MCP tool is rejected unless delivery is mcp", () => {
  const authored = "call `discern_start` yourself";
  assertEquals(
    surfaceRenderingFindings("seeded", authored, undefined, SEEDED).length,
    1,
  );
  assertEquals(
    surfaceRenderingFindings("seeded", authored, "mcp", SEEDED),
    [],
  );
});
