import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { HINTS } from "../src/shared/hints.ts";
import {
  renderCommandRefsCli,
  renderCommandRefsMcp,
} from "../src/shared/command_reference.ts";
import { mcpToolNameForVerb } from "../src/engine/mcp/server.ts";

const AGENT_FACING_SURFACES = [
  "templates/guidance",
  "templates/skills",
  "src/main.ts",
  "src/engine/status/status.ts",
  "src/engine/mcp/server.ts",
] as const;

const MISLEADING_ACCEPTANCE_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
}> = [
  {
    name: "accept when ready",
    pattern: /`discern accept`\s+when ready/i,
  },
  {
    name: "ready to accept",
    pattern: /ready to accept/i,
  },
  {
    name: "green then accept",
    pattern: /When green:[^\n]*accept/i,
  },
  {
    name: "finish then accept workflow",
    pattern: /discern done\s*→\s*discern accept/i,
  },
  {
    name: "finished branch auto-accepts",
    pattern: /branch is finished[\s\S]{0,240}discern_accept/i,
  },
  {
    name: "work done auto-accepts",
    pattern: /`discern_accept`[\s\S]{0,120}work is\s+done/i,
  },
  {
    name: "run accept now",
    pattern: /run `discern[ _]accept` now/i,
  },
];

/**
 * Exact runtime hint ids whose emission sites first prove machine-verified
 * landing authority. Static prose never joins this set. A new authority-aware
 * hint must name itself here and prove its gated emission separately.
 */
const VERIFIED_AUTHORITY_HINT_IDS = new Set([
  "gate-land-under-verified-authority",
  "status-land-under-verified-authority",
  "status-fleet-authorized-landings",
]);

/** Flatten either a file or a directory tree into the concrete surfaces the guard scans. */
async function filesUnder(path: string): Promise<string[]> {
  const stat = await Deno.stat(path);
  if (stat.isFile) {
    return [path];
  }

  const files: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    files.push(...await filesUnder(join(path, entry.name)));
  }
  return files;
}

/** Locate the first line matching each instruction pattern that overstates landing authority. */
function acceptanceViolations(label: string, text: string): string[] {
  const violations: string[] = [];
  for (const { name, pattern } of MISLEADING_ACCEPTANCE_PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) {
      continue;
    }
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`${label}:${line}: ${name}`);
  }
  return violations;
}

Deno.test("agent-facing instructions do not present acceptance as the next autonomous step", async () => {
  const files = (await Promise.all(AGENT_FACING_SURFACES.map(filesUnder)))
    .flat()
    .sort();
  const violations: string[] = [];

  for (const file of files) {
    const text = await Deno.readTextFile(file);
    violations.push(...acceptanceViolations(relative(".", file), text));
  }

  assertEquals(violations, []);
});

Deno.test("only exact machine-verified runtime hints may instruct landing", () => {
  const violations: string[] = [];
  const exercised = new Set<string>();
  for (const [id, def] of Object.entries(HINTS)) {
    // A hint's command references render per delivery surface, so probe BOTH
    // renderings — an acceptance instruction may only spell itself in either
    // form from an exempted, authority-gated hint.
    const authored = def.template(def.example as never);
    const found = [
      renderCommandRefsCli(authored),
      renderCommandRefsMcp(authored, mcpToolNameForVerb),
    ].flatMap((rendered) => acceptanceViolations(`hint:${id}`, rendered));
    if (found.length > 0) {
      if (VERIFIED_AUTHORITY_HINT_IDS.has(id)) {
        exercised.add(id);
      } else {
        violations.push(...found);
      }
    }
  }
  assertEquals(violations, []);
  assertEquals(
    [...VERIFIED_AUTHORITY_HINT_IDS].filter((id) => !exercised.has(id)),
    [],
    "every exemption must name a live runtime hint that instructs acceptance",
  );
});

Deno.test("the acceptance guard still catches an unconditional finish-to-land instruction", () => {
  assertEquals(
    acceptanceViolations(
      "synthetic-static-guidance",
      "Finish with discern done → discern accept.",
    ),
    [
      "synthetic-static-guidance:1: finish then accept workflow",
    ],
  );
});
