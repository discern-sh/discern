/**
 * CLI entry contracts for Desk and a minimal real application journey.
 * Piped, CI and nested sessions retain their non-interactive entry contracts;
 * the PTY case exercises package region navigation and terminal restoration.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  runAgentPtyJourney,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { applicationFrameReady } from "./fixtures/terminal_application_capture.ts";
import {
  DESK_SESSION_ENV,
  deskSessionEnv,
} from "../src/engine/desk/session.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";

const DESK_SESSION = deskSessionEnv();

Deno.test("desk --json: refuses — the desk has no JSON form", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk", "--json"]);
    assertEquals(r.code, 1, r.output);
    const envelope = decodeCliResult(r.stdout, "desk");
    assertEquals(envelope.ok, false);
    assertEquals(envelope.verb, "desk");
    assertEquals(envelope.error, "invalid_arguments");
    assert(
      Array.isArray(envelope.hints) && envelope.hints.length > 0,
      "the machine refusal should carry a registered next action",
    );
    assertExists(envelope.message);
    assertStringIncludes(envelope.message, "status --json");
  });
});

Deno.test("desk --json: a desk-owned child reports the active desk", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk", "--json"], {
      env: DESK_SESSION,
    });
    assertEquals(r.code, 1, r.output);
    const envelope = decodeCliResult(r.stdout, "desk");
    assertEquals(envelope.ok, false);
    assertEquals(envelope.verb, "desk");
    assertEquals(envelope.error, "desk_already_active");
    assertExists(envelope.message);
    assertStringIncludes(envelope.message, "exit");
  });
});

Deno.test("bare discern refuses inside a desk-owned child before interaction policy", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, [], { env: DESK_SESSION });
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "already active");
    assertStringIncludes(r.output, "exit");
    assert(!r.output.includes("Pick an effort"));
    assert(!r.output.includes("Commands:"));
  });
});

Deno.test("gate jobs beneath a desk-owned child run outside the desk session", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        // `[]` proves the marker arrived blank rather than unset or leaked.
        `test = "printf '[%s]' \\"\${${DESK_SESSION_ENV}-unset}\\" > desk-session.txt"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["test"], { env: DESK_SESSION });
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await Deno.readTextFile(`${dir}/desk-session.txt`),
      "[]",
      "a project's own checks may run discern; the gate must not let the launching desk reach them",
    );
  });
});

Deno.test("desk without a TTY: refuses with a pointer at status", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "interactive terminal");
    assertTerminalTextIncludes(r.stderr, "discern status");
  });
});

realPtyTest({
  name: "discern desk opens its production application on a real PTY",
  contracts: ["line-discipline", "terminal-modes", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const geometry = { columns: 80, rows: 24 };
      const r = await runAgentPtyJourney(dir, ["desk"], {
        geometry,
        input: [{
          waitFor: applicationFrameReady(geometry, "No tasks yet"),
          steps: [{ bytes: "\t" }],
        }, {
          waitFor: applicationFrameReady(geometry, "Desk commands"),
          steps: [{ bytes: "\x1b[F\r" }],
        }],
      });
      assertEquals(r.code, 0, r.transcript);
      assertTerminalTextIncludes(r.transcript, "No tasks yet");
      assertTerminalTextIncludes(r.transcript, "Desk commands");
      assertTerminalTextIncludes(r.transcript, "Quit");
      assertStringIncludes(r.transcript, "\x1b[?1049h");
      assertStringIncludes(r.transcript, "\x1b[?1049l");
      assertStringIncludes(r.transcript, "\x1b[?25h");
    });
  },
});

Deno.test("desk pre-setup: the setup redirect fires before the surface", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["desk", "--json"]);
    assertEquals(r.code, 1, r.output);
    const envelope = decodeCliResult(r.stdout, "desk");
    assertEquals(envelope.error, "not_set_up");
  });
});

Deno.test("bare discern without a TTY: help, exactly as before the desk existed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, []);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Commands:");
    // The desk is advertised in the help map (its group leads), but piped
    // output must never BE the desk — no interaction, no picker, a clean exit.
    assertTerminalTextIncludes(r.stdout, "YOUR DESK");
    assert(
      !r.stdout.includes("Pick an effort"),
      "piped bare discern must never open the interactive picker",
    );
  });
});
