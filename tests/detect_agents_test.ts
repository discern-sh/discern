/**
 * Installed-agent auto-detection for fresh setup.
 *
 * Detection resolves a fresh install's default `[project].agents` from what is
 * actually installed. Terminal launch availability remains PATH-only, while setup
 * also reads each provider's declared editor binaries and filesystem markers. These
 * drive both paths through injected environment and host probes, so the assertions
 * are deterministic and parallel-safe (no process-env mutation; ADR 0068).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { fakeEnv, withTempDir } from "./helpers.ts";
import {
  detectAgentBinariesOnPath,
  detectAgentsOnPath,
  detectInstalledAgents,
  providerInstalledForSetup,
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

Deno.test("detectAgentBinariesOnPath: preserves the concrete executable selected for launch", async () => {
  await withTempDir(async (bin) => {
    await fakeBinary(bin, "codex");
    assertEquals(
      await detectAgentBinariesOnPath(fakeEnv({ PATH: bin })),
      [{ name: "codex", binary: "codex" }],
    );
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

Deno.test("detectInstalledAgents: Cursor's editor binary detects the IDE without cursor-agent", async () => {
  await withTempDir(async (bin) => {
    await fakeBinary(bin, "cursor");
    assertEquals(
      await detectInstalledAgents(fakeEnv({ PATH: bin }), {
        os: Deno.build.os,
        pathExists: () => Promise.resolve(false),
      }),
      ["cursor"],
    );
    assertEquals(
      await detectAgentBinariesOnPath(fakeEnv({ PATH: bin })),
      [],
      "the editor shell command proves installation but is not a terminal-agent launcher",
    );
  });
});

Deno.test("detectInstalledAgents: every setup-only PATH binary auto-enrols", async () => {
  for (const name of AGENT_NAMES) {
    for (const binary of PROVIDERS[name].setupPresence.additionalPathBinaries) {
      await withTempDir(async (bin) => {
        await fakeBinary(bin, binary);
        assertEquals(
          await detectInstalledAgents(fakeEnv({ PATH: bin }), {
            os: Deno.build.os,
            pathExists: () => Promise.resolve(false),
          }),
          [name],
          `${name}: setup-only binary "${binary}" alone should detect it`,
        );
      });
    }
  }
});

Deno.test("detectInstalledAgents: every provider filesystem marker auto-enrols", async () => {
  for (const name of AGENT_NAMES) {
    for (const marker of PROVIDERS[name].setupPresence.filesystemMarkers) {
      const base = marker.os === "windows" ? "C:\\machine" : "/machine";
      const expectedPath = marker.path ??
        [base, ...marker.segments].join(
          marker.os === "windows" ? "\\" : "/",
        );
      const envValues: Record<string, string> = {
        PATH: "",
      };
      if (marker.path === undefined) {
        envValues[marker.baseEnv] = base;
      }
      assertEquals(
        await detectInstalledAgents(fakeEnv(envValues), {
          os: marker.os,
          pathExists: (path) => Promise.resolve(path === expectedPath),
        }),
        [name],
        `${name}: filesystem marker ${expectedPath} alone should detect it`,
      );
    }
  }
});

Deno.test("providerInstalledForSetup: an unrelated future editor marker is detected without a name special-case", async () => {
  const futureProvider = {
    ...PROVIDERS.gemini,
    binaries: [],
    setupPresence: {
      additionalPathBinaries: [],
      filesystemMarkers: [{
        os: "linux",
        baseEnv: "HOME",
        segments: [".config", "Orbit"],
      }],
    },
  } satisfies typeof PROVIDERS.gemini;
  assertEquals(
    await providerInstalledForSetup(
      futureProvider,
      fakeEnv({ PATH: "", HOME: "/users/ada" }),
      {
        os: "linux",
        pathExists: (path) =>
          Promise.resolve(path === "/users/ada/.config/Orbit"),
      },
    ),
    true,
  );
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
