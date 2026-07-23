/**
 * Launch the MCP Inspector (https://github.com/modelcontextprotocol/inspector)
 * against discern's OWN MCP server, run from source so live edits to the tool
 * surface (`src/engine/mcp/server.ts`) take effect on the next connect — the
 * maintainer's way to eyeball that surface (tool annotations, input/output
 * schemas, resources) while working on the MCP layer.
 *
 * It is a MAINTAINER helper, not a shipped feature: it lives in `scripts/`
 * (outside `templates/`), so it is never bundled into the binary or laid into a
 * project, and it is NOT part of the gate. The Inspector is a Node tool, invoked
 * here via `npx` (Node/npx must be on PATH); it never enters discern's Deno
 * dependency graph.
 *
 * Usage (via the `inspect-mcp` task):
 *   deno task inspect-mcp
 *       → open the Inspector UI at its printed (pre-authenticated) localhost URL.
 *   deno task inspect-mcp --cli --method tools/list
 *   deno task inspect-mcp --cli --method resources/list
 *   deno task inspect-mcp --cli --method tools/call \
 *       --tool-name discern_status --tool-arg local=true
 *       → one-shot CLI calls, printed as JSON, no browser.
 *
 * discern's server command comes first (right after the package name); anything
 * you pass follows it and is parsed by the Inspector as its own flags. That is
 * the Inspector's documented order — `inspector <server-cmd> --cli --method …
 * --tool-arg …` — and it keeps a variadic operation flag like `--tool-arg` last,
 * where it cannot swallow the trailing server command. (A `--` separator is
 * deliberately NOT used: `npx` strips the first `--` before the Inspector sees
 * it, which would drop the separator and let `--tool-arg` eat the command.)
 */

import { fromFileUrl } from "@std/path";
import { runOwnedChild } from "../src/engine/owned_child.ts";

/** The least-privilege permissions discern's MCP server runs under — the same set
 * the `dev` task and the compiled binary carry: read (config/git/docs), write
 * (the gate's fixers mutate), env, and run (git + the configured commands). */
const SERVER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
];

/** Absolute path to the CLI entrypoint, resolved from this script's own location
 * so the launch does not depend on the working directory. */
const MAIN_TS = fromFileUrl(new URL("../src/main.ts", import.meta.url));

/** Run the Inspector over `npx`, wired to discern's MCP server, and return its
 * exit code. The server command leads; the user's args trail it and are parsed
 * as the Inspector's own options (UI by default, `--cli ...` for a one-shot
 * call). The Inspector owns the terminal, so it launches through the
 * owned-child boundary for the interruption and reap lifecycle. */
async function main(): Promise<number> {
  const args = [
    "-y",
    "@modelcontextprotocol/inspector",
    Deno.execPath(),
    "run",
    ...SERVER_PERMISSIONS,
    MAIN_TS,
    "mcp",
    ...Deno.args,
  ];

  try {
    const { status } = await runOwnedChild("npx", { args });
    return status.code;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.error(
        "inspect-mcp: `npx` was not found on PATH. The MCP Inspector is a Node tool — install Node.js to use it.",
      );
      return 127;
    }
    throw e;
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
