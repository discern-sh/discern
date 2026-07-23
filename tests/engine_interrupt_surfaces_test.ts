/**
 * Interrupt-propagation E2Es — one per spawn surface declared in the
 * spawn-surface registry (tests/spawn_surfaces.ts).
 *
 * The invariant under test: for every engine surface that spawns a
 * potentially long-running child, a signal delivered to the engine's PID
 * stops and reaps the child's WHOLE process tree — the leader and the
 * descendants it forked — instead of orphaning it. The engine itself dies by
 * the interrupt (or, for the desk, survives to render its next menu while the
 * child tree still dies).
 *
 * The scenario table is a `Record` over the registry's declared surface
 * union, so a spawn home that declares a new surface fails `deno check` here
 * until the scenario exists — and the registry's own guard
 * (engine_subprocess_ssot_test.ts) fails until a new spawner declares one (or
 * a reviewed exemption). A fourth spawner therefore auto-enrols in both.
 *
 * Every scenario is parameterized over the watcher's own INTERRUPT_SIGNALS,
 * so a newly watched signal auto-enrols too. Each black-box child records its
 * own PID and a forked descendant's, and the harness proves both die; the
 * project-script scenario additionally holds a server port and proves it
 * closes — the observable a user would notice an orphan by.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  INTERRUPT_SIGNALS,
  SIGNAL_EXIT_CODES,
} from "../src/engine/process_signals.ts";
import type { InterruptSurface } from "./spawn_surfaces.ts";
import {
  addWorktree,
  DENO_JSON,
  engineEnv,
  gitInit,
  MAIN_TS,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

const DESK_DRIVER = fromFileUrl(
  new URL("fixtures/desk_interactive_driver.ts", import.meta.url),
);

const DECODER = new TextDecoder();

/** Poll until `check` resolves true, failing the test after the deadline. */
async function pollFor(
  check: () => boolean,
  what: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Whether a PID is still alive (signal 0 semantics via a harmless SIGCONT). */
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

/** A POSIX child tree that records its leader and one forked descendant, then
 * blocks — the shape every black-box scenario plants behind its surface. */
function recordingTree(leaderFile: string, descendantFile: string): string {
  return `echo $$ > ${leaderFile}; sleep 60 & echo $! > ${descendantFile}; wait`;
}

/** One prepared black-box run: the engine argv to interrupt, where it runs,
 * and the PID files its planted child tree records. */
interface BlackBoxRun {
  readonly args: string[];
  readonly cwd: string;
  /** Written by the spawned child: its own PID (the tree's leader). */
  readonly leaderPidFile: string;
  /** Written by the child: a forked descendant's PID (group-reap proof;
   * asserted on POSIX, where process groups exist). */
  readonly descendantPidFile: string;
  /** Optional: a port the child tree holds; must be closed after the kill. */
  readonly portFile?: string;
}

/**
 * The shared skeleton: prepare a project, run the real engine, wait until the
 * surface's child tree is demonstrably up, deliver `signal` to the ENGINE's
 * PID, and prove (a) the engine died by the interrupt — re-raised BY the
 * signal, or with that signal's conventional 128+n code when the self-signal
 * doesn't terminate (the documented fallback; observed under load once the
 * listener is torn down) — and (b) the whole child tree died with it.
 */
async function assertInterruptStopsTree(
  signal: Deno.Signal,
  prepare: (root: string) => Promise<BlackBoxRun>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "discern-interrupt-" });
  let enginePid: number | undefined;
  let leaderPid: number | undefined;
  let descendantPid: number | undefined;
  let serverPort: number | undefined;
  try {
    const run = await prepare(root);
    const engine = new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--config",
        DENO_JSON,
        "-A",
        MAIN_TS,
        ...run.args,
      ],
      cwd: run.cwd,
      env: await engineEnv(),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      detached: Deno.build.os !== "windows",
    }).spawn();
    enginePid = engine.pid;
    // Drain both streams so a full pipe can never wedge the engine.
    const drained = Promise.all([
      new Response(engine.stdout).text(),
      new Response(engine.stderr).text(),
    ]);

    await pollFor(
      () => {
        try {
          leaderPid = Number(
            Deno.readTextFileSync(run.leaderPidFile).trim(),
          );
          descendantPid = Number(
            Deno.readTextFileSync(run.descendantPidFile).trim(),
          );
          if (run.portFile !== undefined) {
            serverPort = Number(Deno.readTextFileSync(run.portFile).trim());
          }
          return Number.isFinite(leaderPid) && leaderPid > 0 &&
            Number.isFinite(descendantPid) && descendantPid > 0 &&
            (run.portFile === undefined ||
              (Number.isFinite(serverPort) && (serverPort ?? 0) > 0 &&
                portIsOpen(serverPort as number)));
        } catch {
          return false;
        }
      },
      "the surface's child tree to start",
      30_000,
    );

    Deno.kill(engine.pid, signal);
    const status = await engine.status;
    const [outText, errText] = await drained;
    const interrupted = status.signal === signal ||
      (status.signal === null && status.code === SIGNAL_EXIT_CODES[signal]);
    assert(
      interrupted,
      `expected death by ${signal} or exit ${SIGNAL_EXIT_CODES[signal]}, got ${
        JSON.stringify(status)
      }\n${outText}${errText}`,
    );

    await pollFor(
      () => !alive(leaderPid as number),
      `child ${leaderPid} to die`,
      10_000,
    );
    if (Deno.build.os !== "windows") {
      await pollFor(
        () => !alive(descendantPid as number),
        `descendant ${descendantPid} to die`,
        10_000,
      );
      if (serverPort !== undefined) {
        await pollFor(
          () => !portIsOpen(serverPort as number),
          `server port ${serverPort} to close`,
          10_000,
        );
      }
    }
  } finally {
    if (descendantPid !== undefined) killForCleanup(descendantPid);
    if (leaderPid !== undefined) killForCleanup(leaderPid);
    if (enginePid !== undefined) killForCleanup(enginePid);
    await Deno.remove(root, { recursive: true });
  }
}

/** Gate jobs (engine/jobs/command.ts): a `done` run's in-flight check job. */
async function prepareGateJob(root: string): Promise<BlackBoxRun> {
  await scaffoldEngine(root);
  await writeConfig(
    root,
    [
      "[project]",
      'slug = "engine-test"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[jobs]",
      `lint = "${recordingTree("gate.pid", "gate_descendant.pid")}"`,
    ].join("\n"),
  );
  await gitInit(root);
  return {
    args: ["done"],
    cwd: root,
    leaderPidFile: join(root, "gate.pid"),
    descendantPidFile: join(root, "gate_descendant.pid"),
  };
}

/** Project Scripts (owned_child.ts via project_scripts.ts): `discern script`.
 * Keeps a listening server in the tree, closing the port a user could observe
 * the orphan by. */
async function prepareProjectScript(root: string): Promise<BlackBoxRun> {
  await scaffoldEngine(root);
  await Deno.writeTextFile(
    join(root, "server.ts"),
    [
      'const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });',
      "const address = listener.addr as Deno.NetAddr;",
      'await Deno.writeTextFile("server.port", String(address.port));',
      "for await (const connection of listener) connection.close();",
      "",
    ].join("\n"),
  );
  await writeExecutable(
    join(root, "discern/scripts/wait-for-interrupt"),
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$$\" > script.pid",
      "deno run --allow-net=127.0.0.1 --allow-write=server.port server.ts &",
      "printf '%s\\n' \"$!\" > descendant.pid",
      "wait",
      "",
    ].join("\n"),
  );
  return {
    args: ["script", "wait-for-interrupt"],
    cwd: root,
    leaderPidFile: join(root, "script.pid"),
    descendantPidFile: join(root, "descendant.pid"),
    portFile: join(root, "server.port"),
  };
}

/** Worktree lifecycle commands (worktree/shell.ts): a `[worktree.setup].steps`
 * entry mid-`worktree setup` — the same runner carries the ensure buckets and
 * resource create/destroy/ensure. */
async function prepareWorktreeSetup(root: string): Promise<BlackBoxRun> {
  const main = join(root, "main");
  await Deno.mkdir(main);
  await scaffoldEngine(main);
  await writeConfig(
    main,
    [
      "[project]",
      'slug = "engine-test"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[worktree.setup]",
      `steps = ["${recordingTree("setup.pid", "setup_descendant.pid")}"]`,
    ].join("\n"),
  );
  await gitInit(main);
  const worktree = await addWorktree(main, "interrupt-probe");
  return {
    args: ["worktree", "setup"],
    cwd: worktree,
    leaderPidFile: join(worktree, "setup.pid"),
    descendantPidFile: join(worktree, "setup_descendant.pid"),
  };
}

/** The `with-gotchas` wrapper (owned_child.ts via dispatch.ts): it execs an
 * arbitrary user command and must not orphan it. */
async function prepareWithGotchas(root: string): Promise<BlackBoxRun> {
  await scaffoldEngine(root);
  const runner = join(root, "hold-open.sh");
  await writeExecutable(
    runner,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$$\" > gotchas.pid",
      "sleep 60 &",
      "printf '%s\\n' \"$!\" > gotchas_descendant.pid",
      "wait",
      "",
    ].join("\n"),
  );
  return {
    args: ["with-gotchas", runner],
    cwd: root,
    leaderPidFile: join(root, "gotchas.pid"),
    descendantPidFile: join(root, "gotchas_descendant.pid"),
  };
}

/** The desk's launch wiring (owned_child.ts via desk/desk.ts): the inverse
 * contract — the child tree dies, the desk session survives. Driven through
 * the real DEFAULT_DESK_RUNTIME.interactive by a fixture that self-signals
 * its own PID and reports back. */
async function assertDeskInterruptReapsAndResumes(
  signal: Deno.Signal,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "discern-interrupt-desk-" });
  try {
    const pidFile = join(root, "desk_child.pid");
    const output = await new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--config",
        DENO_JSON,
        "-A",
        DESK_DRIVER,
        signal,
        pidFile,
      ],
      cwd: root,
      env: await engineEnv(),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(
      output.success,
      `the desk driver must SURVIVE the interrupt, got code ${output.code}:\n${
        DECODER.decode(output.stderr)
      }`,
    );
    const result = JSON.parse(DECODER.decode(output.stdout)) as {
      resumed: boolean;
      code: number;
      childAlive: boolean;
    };
    assertEquals(result.resumed, true);
    assertEquals(
      result.childAlive,
      false,
      "the desk resumed but left its interrupted child running",
    );
    assert(
      result.code !== 0,
      "an interrupted launch must not report a clean exit to the desk",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/**
 * One scenario per surface the registry declares — `Record` over the declared
 * union, so registry and suite can only move together.
 */
const SCENARIOS: Record<
  InterruptSurface,
  (signal: Deno.Signal) => Promise<void>
> = {
  "gate-job": (signal) => assertInterruptStopsTree(signal, prepareGateJob),
  "project-script": (signal) =>
    assertInterruptStopsTree(signal, prepareProjectScript),
  "worktree-setup": (signal) =>
    assertInterruptStopsTree(signal, prepareWorktreeSetup),
  "with-gotchas": (signal) =>
    assertInterruptStopsTree(signal, prepareWithGotchas),
  "desk-interactive": assertDeskInterruptReapsAndResumes,
};

for (
  const [surface, scenario] of Object.entries(SCENARIOS) as Array<
    [InterruptSurface, (signal: Deno.Signal) => Promise<void>]
  >
) {
  for (const signal of INTERRUPT_SIGNALS) {
    Deno.test(
      `interrupting the ${surface} surface with ${signal} stops and reaps its child tree`,
      () => scenario(signal),
    );
  }
}
