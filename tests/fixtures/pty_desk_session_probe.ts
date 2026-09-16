/**
 * Executable probe: drive the canonical PTY driver from a process that itself
 * sits beneath a desk session, and report what each PTY child received.
 *
 * The suite cannot forge the marker in its own environment (process mutation
 * is a registered boundary), so the test launches this probe with the marker
 * set and reads the two lines it prints.
 */

import { fromFileUrl, join } from "@std/path";
import { deskSessionEnv } from "../../src/engine/desk/session.ts";
import { withRealPtyBoundary } from "../real_pty.ts";
import { runPtyProcess } from "./pty_process.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const CHILD_PROGRAM = join(REPO_ROOT, "tests/fixtures/pty_child_program.ts");

/** Run the reporting child once and return its `desk-session:[…]` line. */
async function reportedMarker(env: Record<string, string>): Promise<string> {
  const result = await runPtyProcess({
    command: Deno.execPath(),
    args: ["run", "--quiet", "-A", CHILD_PROGRAM, "desk-session-reporting"],
    cwd: REPO_ROOT,
    env,
  });
  const line = result.transcript.match(/desk-session:\[[^\]]*\]/u)?.[0];
  if (result.code !== 0 || line === undefined) {
    throw new Error(`PTY child gave no marker report:\n${result.transcript}`);
  }
  return line;
}

await withRealPtyBoundary({
  name: "PTY children beneath a desk-owned driver",
  contracts: ["process-lifecycle"],
  canary: false,
}, async () => {
  console.log(`inherited:${await reportedMarker({})}`);
  console.log(`explicit:${await reportedMarker(deskSessionEnv())}`);
});
