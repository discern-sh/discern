/**
 * The MCP version handshake (version_check.ts): a long-lived server whose on-disk
 * binary was replaced mid-session must flag itself stale on every tool result, so
 * an agent restarts rather than letting the old engine fight the new CLI. Covers
 * the three seams with stubbed versions — the pure mismatch hint, the discern-only
 * version parse, and the stat-cached resolver — plus the live wiring through
 * runTool.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  createInstalledVersionResolver,
  parseDiscernVersion,
  versionMismatchHint,
} from "../src/engine/mcp/version_check.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";

Deno.test("versionMismatchHint: fires only on a real, resolvable disagreement", () => {
  // Matching versions and an unresolvable on-disk version both stay silent — the
  // check never invents an alarm from a can't-tell.
  assertEquals(versionMismatchHint("1.0.0", "1.0.0"), undefined);
  assertEquals(versionMismatchHint("1.0.0", undefined), undefined);

  const hint = versionMismatchHint("1.0.0", "1.1.0");
  assert(hint !== undefined, "a genuine mismatch must produce a hint");
  assertStringIncludes(hint, "v1.0.0"); // what this server runs
  assertStringIncludes(hint, "v1.1.0"); // what a restart would load
  assertStringIncludes(hint, "Restart your agent session");
});

Deno.test("parseDiscernVersion: accepts discern's own shape, rejects everything else", () => {
  assertEquals(parseDiscernVersion("discern 1.0.0"), "1.0.0");
  assertEquals(parseDiscernVersion("discern 1.2.3-rc.4\n"), "1.2.3-rc.4");
  // Colourised `discern --version` output (cliffy wraps name + version in ANSI).
  assertEquals(
    parseDiscernVersion("\x1b[1mdiscern\x1b[22m \x1b[94m2.0.1\x1b[39m"),
    "2.0.1",
  );
  // A different executable at the same path never parses — the discriminator that
  // keeps the handshake silent under `deno run`, where execPath is `deno`.
  assertEquals(parseDiscernVersion("deno 2.9.1 (stable, release)"), undefined);
  assertEquals(parseDiscernVersion(""), undefined);
  assertEquals(parseDiscernVersion("garbage"), undefined);
});

Deno.test("createInstalledVersionResolver: seeds from the running binary and re-probes only on replace", async () => {
  // Drive the resolver with a mutable stat-key and a counted probe, so a real
  // process is never spawned. The seed maps the running binary's stat → the
  // version we ARE, spawn-free; a probe fires only when that key changes.
  let key: string | undefined = "inode-A";
  let probes = 0;
  const resolve = createInstalledVersionResolver({
    serverVersion: "1.0.0",
    execPath: "/fake/discern",
    statKey: () => key,
    probeVersion: () => {
      probes += 1;
      return Promise.resolve("2.0.0");
    },
  });

  // Steady state: the binary is unchanged, so the resolver returns the seeded
  // server version without ever probing.
  assertEquals(await resolve(), "1.0.0");
  assertEquals(await resolve(), "1.0.0");
  assertEquals(probes, 0, "an unchanged binary must never spawn a probe");

  // The binary is replaced (new inode) → one probe resolves the new version…
  key = "inode-B";
  assertEquals(await resolve(), "2.0.0");
  assertEquals(probes, 1);
  // …and the result is cached against the new key: no re-probe while it holds.
  assertEquals(await resolve(), "2.0.0");
  assertEquals(probes, 1, "the resolved version is cached against the new key");

  // A second replace probes again.
  key = "inode-C";
  assertEquals(await resolve(), "2.0.0");
  assertEquals(probes, 2);
});

Deno.test("createInstalledVersionResolver: an unreadable binary resolves to undefined (no hint)", async () => {
  // If the executable can't be statted, we can't compare — so the resolver returns
  // undefined and the mismatch hint stays silent, never probing.
  let probes = 0;
  const resolve = createInstalledVersionResolver({
    serverVersion: "1.0.0",
    execPath: "/gone/discern",
    statKey: () => undefined,
    probeVersion: () => {
      probes += 1;
      return Promise.resolve("2.0.0");
    },
  });
  assertEquals(await resolve(), undefined);
  assertEquals(probes, 0);
});

Deno.test("runTool: a stale on-disk version appends the restart hint to every result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const finish = TOOLS.find((t) => t.name === "discern_finish");
    assert(finish !== undefined, "discern_finish must exist");

    // A resolver reporting a newer on-disk version than this build → the rendered
    // result carries the restart hint alongside whatever the verb returned.
    const staleVersion = `${KIT_VERSION}-newer`;
    const stale = await runTool(
      finish,
      new WorkingRoot(dir),
      { dry_run: true },
      undefined,
      () => Promise.resolve(staleVersion),
    );
    const hints = stale.structuredContent.hints as string[];
    assert(
      Array.isArray(hints) &&
        hints.some((h) => h.includes("Restart your agent session")),
      `a stale server must append the restart hint: ${JSON.stringify(hints)}`,
    );
    assert(
      hints.some((h) => h.includes(staleVersion)),
      "the hint names the installed version a restart would load",
    );
    // The verb still ran: its own result is intact under the appended hint.
    assertEquals(stale.structuredContent.verb, "finish");
    assertEquals(stale.structuredContent.dry_run, true);
  });
});

Deno.test("runTool: a matching on-disk version appends no hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const finish = TOOLS.find((t) => t.name === "discern_finish");
    assert(finish !== undefined, "discern_finish must exist");

    const fresh = await runTool(
      finish,
      new WorkingRoot(dir),
      { dry_run: true },
      undefined,
      () => Promise.resolve(KIT_VERSION),
    );
    const hints = (fresh.structuredContent.hints as string[]) ?? [];
    assert(
      !hints.some((h) => h.includes("Restart your agent session")),
      `a current server must not append the restart hint: ${
        JSON.stringify(hints)
      }`,
    );
  });
});
