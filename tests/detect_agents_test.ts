/**
 * PATH auto-detection of the known coding agents (Phase A, deliverable 1).
 *
 * Detection resolves a fresh install's default `[guidance].agents` from what is
 * actually installed — registry-driven (`PROVIDERS[*].binaries`), match-any, and
 * falling back to `DEFAULT_AGENTS` when nothing is found. These drive it with an
 * injected `PATH` over temp "bin" dirs holding fake executables, so the assertions
 * are deterministic and parallel-safe (no process-env mutation; ADR 0068).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { fakeEnv, withTempDir } from "./helpers.ts";
import {
  detectAgentsOnPath,
  resolveDefaultAgents,
} from "../src/lib/detect_agents.ts";
import { AGENT_NAMES, DEFAULT_AGENTS } from "../src/shared/config_schema.ts";
import { PROVIDERS } from "../src/lib/providers.ts";

/** The PATH-list delimiter for the host (mirrors the helper). */
const DELIM = Deno.build.os === "windows" ? ";" : ":";

/** Write a fake, executable binary named `name` into `dir`. */
async function fakeBinary(dir: string, name: string): Promise<void> {
  const path = join(dir, name);
  await Deno.writeTextFile(path, "#!/bin/sh\n");
  await Deno.chmod(path, 0o755);
}

Deno.test("detectAgentsOnPath: finds exactly the agents whose binary is on PATH", async () => {
  await withTempDir(async (bin) => {
    // Only Claude's binary is present.
    await fakeBinary(bin, "claude");
    const env = fakeEnv({ PATH: bin });
    assertEquals(await detectAgentsOnPath(env), ["claude_code"]);
  });
});

Deno.test("detectAgentsOnPath: reports nothing when no known binary is present", async () => {
  await withTempDir(async (bin) => {
    await fakeBinary(bin, "some-other-tool");
    assertEquals(await detectAgentsOnPath(fakeEnv({ PATH: bin })), []);
    // An absent/empty PATH is handled the same way (no crash, no detection).
    assertEquals(await detectAgentsOnPath(fakeEnv({})), []);
  });
});

Deno.test("detectAgentsOnPath: returns the present agents in AGENT_NAMES order across dirs", async () => {
  await withTempDir(async (a) => {
    await withTempDir(async (b) => {
      // gemini in the first dir, claude in the second — order must follow the
      // registry (AGENT_NAMES), not PATH order.
      await fakeBinary(a, "gemini");
      await fakeBinary(b, "claude");
      const env = fakeEnv({ PATH: [a, b].join(DELIM) });
      const detected = await detectAgentsOnPath(env);
      assertEquals(detected, ["claude_code", "gemini"]);
    });
  });
});

Deno.test("detectAgentsOnPath: a non-executable file does not count (POSIX)", async () => {
  if (Deno.build.os === "windows") {
    return; // executability is not a PATH gate on Windows
  }
  await withTempDir(async (bin) => {
    const path = join(bin, "codex");
    await Deno.writeTextFile(path, "not executable\n");
    await Deno.chmod(path, 0o644);
    assertEquals(await detectAgentsOnPath(fakeEnv({ PATH: bin })), []);
  });
});

Deno.test("detectAgentsOnPath: match-any — any one of a provider's binaries suffices", async () => {
  // Drive the match-any semantics off the registry: for each agent, dropping ANY
  // ONE of its declared binaries on PATH must detect it. Guards the future
  // multi-binary vendors without naming one here.
  for (const name of AGENT_NAMES) {
    for (const binary of PROVIDERS[name].binaries) {
      await withTempDir(async (bin) => {
        await fakeBinary(bin, binary);
        const detected = await detectAgentsOnPath(fakeEnv({ PATH: bin }));
        assertEquals(
          detected,
          [name],
          `${name}: binary "${binary}" alone should detect it`,
        );
      });
    }
  }
});

Deno.test("detectAgentsOnPath: generic `agent` binary does not detect Cursor", async () => {
  await withTempDir(async (bin) => {
    await fakeBinary(bin, "agent");
    assertEquals(
      await detectAgentsOnPath(fakeEnv({ PATH: bin })),
      [],
      "a project may have an unrelated `agent` executable on PATH; Cursor detection must require Cursor's own CLI name",
    );
  });
});

Deno.test("resolveDefaultAgents: detected set when non-empty, else DEFAULT_AGENTS", async () => {
  await withTempDir(async (bin) => {
    await fakeBinary(bin, "codex");
    assertEquals(await resolveDefaultAgents(fakeEnv({ PATH: bin })), ["codex"]);
  });
  // Nothing detected → the static fallback (never an empty agent set).
  await withTempDir(async (empty) => {
    assertEquals(
      await resolveDefaultAgents(fakeEnv({ PATH: empty })),
      [...DEFAULT_AGENTS],
    );
  });
});
