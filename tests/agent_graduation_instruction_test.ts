import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";

const AGENT_FACING_SURFACES = [
  "templates/guidance",
  "templates/skills",
  "src/main.ts",
  "src/engine/status/status.ts",
  "src/engine/mcp/server.ts",
] as const;

const MISLEADING_GRADUATION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
}> = [
  {
    name: "graduate when ready",
    pattern: /`discern graduate`\s+when ready/i,
  },
  {
    name: "ready to graduate",
    pattern: /ready to graduate/i,
  },
  {
    name: "green then graduate",
    pattern: /When green:[^\n]*graduate/i,
  },
  {
    name: "finish then graduate workflow",
    pattern: /discern done\s*→\s*discern graduate/i,
  },
  {
    name: "finished branch auto-graduates",
    pattern: /branch is finished[\s\S]{0,240}discern_graduate/i,
  },
  {
    name: "work done auto-graduates",
    pattern: /`discern_graduate`[\s\S]{0,120}work is\s+done/i,
  },
];

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

Deno.test("agent-facing instructions do not present graduation as the next autonomous step", async () => {
  const files = (await Promise.all(AGENT_FACING_SURFACES.map(filesUnder)))
    .flat()
    .sort();
  const violations: string[] = [];

  for (const file of files) {
    const text = await Deno.readTextFile(file);
    for (const { name, pattern } of MISLEADING_GRADUATION_PATTERNS) {
      const match = pattern.exec(text);
      if (match === null) {
        continue;
      }
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`${relative(".", file)}:${line}: ${name}`);
    }
  }

  assertEquals(violations, []);
});
