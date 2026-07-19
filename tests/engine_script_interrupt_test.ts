/**
 * Project Script interruption E2E.
 *
 * The CLI wrapper can receive a signal on its PID rather than through the
 * terminal's foreground process group. The owned-child boundary must still
 * stop and reap the script process and every descendant in its process group,
 * closing the server port by which a user could observe the orphan.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import {
  INTERRUPT_SIGNALS,
  SIGNAL_EXIT_CODES,
} from "../src/engine/jobs/interrupt.ts";
import {
  DENO_JSON,
  engineEnv,
  MAIN_TS,
  scaffoldEngine,
  writeExecutable,
} from "./engine_helpers.ts";

async function pollFor(
  check: () => boolean,
  what: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function alive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

function killForCleanup(pid: number): void {
  if (Deno.build.os !== "windows") {
    try {
      Deno.kill(-pid, "SIGKILL");
      return;
    } catch {
      // The process may not lead a group, or may already be gone.
    }
  }
  try {
    Deno.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

function portIsOpen(port: number): boolean {
  const source = [
    "try {",
    `  const connection = await Deno.connect({ hostname: "127.0.0.1", port: ${port} });`,
    "  connection.close();",
    "} catch {",
    "  Deno.exit(1);",
    "}",
  ].join("\n");
  return new Deno.Command(Deno.execPath(), {
    args: ["eval", source],
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
}

for (const signal of INTERRUPT_SIGNALS) {
  Deno.test(`interrupting a Project Script with ${signal} stops its process tree`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "discern-script-interrupt-" });
    let enginePid: number | undefined;
    let scriptPid: number | undefined;
    let descendantPid: number | undefined;
    let serverPort: number | undefined;
    try {
      await scaffoldEngine(dir);
      await Deno.writeTextFile(
        join(dir, "server.ts"),
        [
          'const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });',
          "const address = listener.addr as Deno.NetAddr;",
          'await Deno.writeTextFile("server.port", String(address.port));',
          "for await (const connection of listener) connection.close();",
          "",
        ].join("\n"),
      );
      await writeExecutable(
        join(dir, "discern/scripts/wait-for-interrupt"),
        [
          "#!/bin/sh",
          "printf '%s\\n' \"$$\" > script.pid",
          "deno run --allow-net=127.0.0.1 --allow-write=server.port server.ts &",
          "printf '%s\\n' \"$!\" > descendant.pid",
          "wait",
          "",
        ].join("\n"),
      );

      const engine = new Deno.Command("deno", {
        args: [
          "run",
          "--no-check",
          "--config",
          DENO_JSON,
          "-A",
          MAIN_TS,
          "script",
          "wait-for-interrupt",
        ],
        cwd: dir,
        env: await engineEnv(),
        stdin: "null",
        stdout: "null",
        stderr: "null",
        detached: Deno.build.os !== "windows",
      }).spawn();
      enginePid = engine.pid;

      const scriptFile = join(dir, "script.pid");
      const descendantFile = join(dir, "descendant.pid");
      const portFile = join(dir, "server.port");
      await pollFor(
        () => {
          try {
            scriptPid = Number(Deno.readTextFileSync(scriptFile).trim());
            descendantPid = Number(
              Deno.readTextFileSync(descendantFile).trim(),
            );
            serverPort = Number(Deno.readTextFileSync(portFile).trim());
            return Number.isFinite(scriptPid) &&
              Number.isFinite(descendantPid) &&
              Number.isFinite(serverPort) &&
              portIsOpen(serverPort);
          } catch {
            return false;
          }
        },
        "the Project Script process tree to start",
        30_000,
      );
      assert(scriptPid !== undefined && scriptPid > 0);
      assert(descendantPid !== undefined && descendantPid > 0);
      assert(serverPort !== undefined && serverPort > 0);

      Deno.kill(engine.pid, signal);
      const status = await engine.status;
      const interrupted = status.signal === signal ||
        (status.signal === null && status.code === SIGNAL_EXIT_CODES[signal]);
      assert(
        interrupted,
        `expected ${signal} or exit ${SIGNAL_EXIT_CODES[signal]}, got ${
          JSON.stringify(status)
        }`,
      );

      await pollFor(
        () => !alive(scriptPid as number),
        `script ${scriptPid} to die`,
      );
      if (Deno.build.os !== "windows") {
        await pollFor(
          () => !alive(descendantPid as number),
          `script descendant ${descendantPid} to die`,
        );
        await pollFor(
          () => !portIsOpen(serverPort as number),
          `server port ${serverPort} to close`,
        );
      }
    } finally {
      if (descendantPid !== undefined) killForCleanup(descendantPid);
      if (scriptPid !== undefined) killForCleanup(scriptPid);
      if (enginePid !== undefined) killForCleanup(enginePid);
      await Deno.remove(dir, { recursive: true });
    }
  });
}
