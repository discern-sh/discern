import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";

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

Deno.test("agent-facing instructions do not present acceptance as the next autonomous step", async () => {
  const files = (await Promise.all(AGENT_FACING_SURFACES.map(filesUnder)))
    .flat()
    .sort();
  const violations: string[] = [];

  for (const file of files) {
    const text = await Deno.readTextFile(file);
    for (const { name, pattern } of MISLEADING_ACCEPTANCE_PATTERNS) {
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
