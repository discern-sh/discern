/**
 * Canon Editor's command line. `serve` (the default) opens the browser editor;
 * `open <entry>` resolves any canon id, slug, or
 * title across the five prose registries and jumps the IDE to its exact
 * source line.
 */

import { locateEntries, openInIde } from "./locate.ts";

const USAGE = `Canon Editor: edit the canon through its generated pages.

Usage:
  discern scripts canon-editor [serve]
  discern scripts canon-editor open <entry> [--print] [--json]

Commands:
  serve          Start the editor on this worktree's derived port (or PORT)
                 and keep it live against registry changes. The default.
                 Serves only from a worktree. Write-back never lands on
                 the main checkout through this command.
  open <entry>   Resolve a canon entry (id, slug, or title, such as proof,
                 file-ownership, "Only better") and open its registry source
                 in the IDE at the exact line. --print writes the position
                 instead of launching the IDE; --json emits it structured.
`;

/** Render one match as a clickable position line. */
function positionLine(entry: {
  file: string;
  line: number;
  registry: string;
  kind: string;
  id: string;
}): string {
  return `${entry.file}:${entry.line} · ${entry.registry} ${entry.kind} ${entry.id}`;
}

/** Run `open`: resolve the query, then jump, print, or list matches. */
async function runOpen(args: readonly string[]): Promise<number> {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const query = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (query === "") {
    console.error("open needs an entry id, slug, or title.");
    return 2;
  }
  const matches = locateEntries(query);
  if (matches.length === 0) {
    console.error(`No canon entry matches "${query}".`);
    return 1;
  }
  if (matches.length > 1) {
    console.error(`"${query}" is ambiguous: ${matches.length} entries match:`);
    for (const match of matches) console.error(`  ${positionLine(match)}`);
    return 1;
  }
  const entry = matches[0];
  if (entry === undefined) return 1;
  if (flags.has("--json")) {
    console.log(JSON.stringify(entry));
    return 0;
  }
  console.log(positionLine(entry));
  if (!flags.has("--print") && !(await openInIde(entry.file, entry.line))) {
    console.error(
      "PhpStorm couldn't be reached. The source position is printed above.",
    );
  }
  return 0;
}

/** Run the editor server until interrupted; write-back stays in worktrees. */
async function runServe(): Promise<number> {
  const { mainCheckoutIssue } = await import("./root.ts");
  const issue = await mainCheckoutIssue();
  if (issue !== undefined) {
    console.error(issue);
    return 2;
  }
  const { startCanonEditor } = await import("./server.ts");
  await startCanonEditor();
  await new Promise<never>(() => {
    // The server owns the process until a signal ends it.
  });
  return 0;
}

/** Dispatch Canon Editor subcommands. */
export async function runCanonEditor(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === "open") return await runOpen(rest);
  if (command === "serve" || command === undefined) return await runServe();
  console.error(USAGE.trimEnd());
  return command === "--help" || command === "help" ? 0 : 2;
}

if (import.meta.main) {
  Deno.exit(await runCanonEditor(Deno.args));
}
