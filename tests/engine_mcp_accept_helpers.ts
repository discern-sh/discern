/** Shared complete-evidence setup and logbook readings for MCP acceptance tests. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type LogbookEvent,
  parseLogbookLine,
} from "../src/engine/logbook/schema.ts";
import { git, runAgent } from "./engine_helpers.ts";

/** Read the valid verb events written by a spawned MCP server. */
export async function readMcpVerbEvents(
  dir: string,
): Promise<Extract<LogbookEvent, { kind: "verb" }>[]> {
  const events: Extract<LogbookEvent, { kind: "verb" }>[] = [];
  const logDir = join(dir, ".git", "discern", "logbook");
  for await (const entry of Deno.readDir(logDir)) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const text = await Deno.readTextFile(join(logDir, entry.name));
    for (
      const line of text.split("\n").filter((candidate) => candidate !== "")
    ) {
      const parsed = parseLogbookLine(line);
      assert(parsed.kind === "event", `unparseable MCP logbook line: ${line}`);
      if (parsed.event.kind === "verb") {
        events.push(parsed.event);
      }
    }
  }
  return events;
}

/** Commit the intended source and establish real complete evidence before acceptance. */
export async function completeWorktreeForAcceptance(
  dir: string,
  message = "prepare acceptance",
): Promise<void> {
  await git(dir, "add", "-A");
  await git(
    dir,
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
    "--no-gpg-sign",
  );
  const done = await runAgent(dir, ["done", "--json"]);
  assertEquals(done.code, 0, done.output);
}
