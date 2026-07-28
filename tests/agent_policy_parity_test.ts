/**
 * Policy parity guard for the two authored operating-model surfaces: the
 * bundled guidance templates (compiled into every project's agent files) and
 * the MCP server's instructions block. The two are deliberately redundant —
 * MCP instructions reach clients that never read an agent file — but they
 * are authored independently, and independent authorship drifts: the same
 * policy was already worded three different ways across surfaces before this
 * guard existed.
 *
 * POLICIES is the declared canonical set (ADR 0181) of rules both surfaces
 * must carry. Each probe set must match BOTH surfaces; a policy reworded off
 * its probes fails here, which is the moment to re-align the wording — or,
 * deliberately, the probe. A generalization of the acceptance anti-pattern
 * scan in `agent_acceptance_instruction_test.ts`, which bans wrong phrasings;
 * this asserts the right ones exist.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildInstructions } from "../src/engine/mcp/server.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** One core operating policy and the probes every surface must satisfy. */
interface Policy {
  readonly id: string;
  readonly gist: string;
  readonly probes: readonly RegExp[];
}

/** The canonical operating-model policy set both surfaces carry. */
const POLICIES: readonly Policy[] = [
  {
    id: "worktree-first",
    gist: "work happens in your own worktree, started with discern_start",
    probes: [/(own|isolated) worktree/i, /discern_start/],
  },
  {
    id: "never-adopt",
    gist: "an existing worktree belongs to another effort — never adopt one",
    probes: [/never (adopt|start work in one)/i],
  },
  {
    id: "accept-on-handoff",
    gist: "discern_accept only on an explicit user handoff, never self-served",
    probes: [/explicit\w*[^.\n]{0,60}hand\s?-?off/i, /discern_accept/],
  },
  {
    id: "done-is-the-bar",
    gist: "discern_done on the final tree decides when a change is done",
    probes: [/discern_done/, /final tree/i],
  },
  {
    id: "iterate-fast-loop",
    gist: "iteration runs through discern_prepare, not repeated full gates",
    probes: [/discern_prepare/, /iterat/i],
  },
  {
    id: "never-loosen",
    gist: "a standard's limit may never loosen to pass the gate",
    probes: [/(never loosen|no limit loosened)/i],
  },
];

/** The bundled guidance templates as one searchable blob (source text, so
 * conditional sections are always present). */
async function guidanceBlob(): Promise<string> {
  const dir = join(REPO_ROOT, "templates", "guidance");
  const parts: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      parts.push(await Deno.readTextFile(join(dir, entry.name)));
    }
  }
  assert(parts.length > 0, "no guidance templates found — check the scan set");
  return parts.join("\n");
}

Deno.test("both operating-model surfaces carry every canonical policy", async () => {
  const surfaces: ReadonlyArray<{ label: string; text: string }> = [
    { label: "templates/guidance", text: await guidanceBlob() },
    { label: "mcp server instructions", text: buildInstructions() },
  ];
  const failures: string[] = [];
  for (const policy of POLICIES) {
    for (const surface of surfaces) {
      for (const probe of policy.probes) {
        if (!probe.test(surface.text)) {
          failures.push(
            `${policy.id} missing from ${surface.label} (probe ${probe}): ` +
              policy.gist,
          );
        }
      }
    }
  }
  assertEquals(
    failures,
    [],
    "every canonical policy must appear on both surfaces — restore the " +
      "wording, or update the probe if the rewording is deliberate:\n  " +
      failures.join("\n  "),
  );
});
