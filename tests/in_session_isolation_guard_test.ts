/**
 * Work that runs beside a live screen answers only to its operation.
 *
 * A Desk effect runs while a foreground child can own the terminal, and a
 * Ctrl+C typed into that child reaches the terminal's whole foreground
 * process group. So inside an operation-sourced scope no child may inherit
 * a standard stream or stay in that group, and no interrupt boundary may
 * install a process-signal listener: the operation's own signal is the only
 * interrupt. These guards hold both rules for every spawn home and every
 * signal listener the spawn-surface registry declares, so a new home or
 * listener must declare its session contract before it can ship.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  enclosingFunction,
  subprocessConstructors,
} from "../scripts/subprocess_spawn_boundaries.ts";
import {
  SIGNAL_LISTENER_CONTRACTS,
  SPAWN_SESSION_CONTRACTS,
  type SpawnSessionContract,
  SUBPROCESS_SPAWN_BOUNDARIES,
} from "./spawn_surfaces.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  currentInterruptSource,
  runWithInterruptSource,
} from "../src/shared/interrupt_source.ts";
import { runOwnedChild, superviseSpawn } from "../src/engine/owned_child.ts";
import { runParallel } from "../src/engine/jobs/runner.ts";
import { withTrackedRun } from "../src/engine/jobs/interrupt.ts";
import { runShellRouted } from "../src/engine/worktree/shell.ts";
import { commandExists, runGit, runShell } from "../src/shared/subprocess.ts";
import { denoMetadata } from "../src/shared/deno_metadata.ts";
import { pageThrough } from "../src/lib/pager.ts";
import { Logger } from "../src/lib/log.ts";
import { withTempDir } from "./helpers.ts";

/** The registry key of one spawn or listener site. */
function siteKey(path: string, enclosing: string): string {
  return `${path}#${enclosing}`;
}

const SPAWN_CONTRACTS: Readonly<Record<string, SpawnSessionContract>> =
  SPAWN_SESSION_CONTRACTS;

/** An expression that makes a POSIX child lead its own process group. */
function isolates(node: Node | undefined, depth = 0): boolean {
  if (node === undefined || depth > 4) return false;
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  const text = node.getText().replaceAll(/\s+/g, " ");
  if (text === 'Deno.build.os !== "windows"') return true;
  if (Node.isCallExpression(node)) {
    return node.getExpression().getText() === "childLeadsOwnGroup";
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    return declaration !== undefined &&
      Node.isVariableDeclaration(declaration) &&
      isolates(declaration.getInitializer(), depth + 1);
  }
  return false;
}

/** The string literals an option's value can take, or undefined if unknown. */
function streamValues(node: Node | undefined): string[] | undefined {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node)) return [node.getLiteralValue()];
  if (Node.isConditionalExpression(node)) {
    const whenTrue = streamValues(node.getWhenTrue());
    const whenFalse = streamValues(node.getWhenFalse());
    return whenTrue === undefined || whenFalse === undefined
      ? undefined
      : [...whenTrue, ...whenFalse];
  }
  return undefined;
}

/** Why one captured constructor could still reach the terminal, if it can. */
function capturedConstructorFindings(
  options: Node | undefined,
): string[] {
  if (options === undefined || !Node.isObjectLiteralExpression(options)) {
    return ["its options are not one object literal the guard can read"];
  }
  const property = (name: string): Node | undefined => {
    const found = options.getProperty(name);
    return found !== undefined && Node.isPropertyAssignment(found)
      ? found.getInitializer()
      : undefined;
  };
  const findings: string[] = [];
  for (const stream of ["stdin", "stdout", "stderr"]) {
    const values = streamValues(property(stream));
    if (values === undefined) {
      findings.push(`${stream} is not spelled as a literal`);
    } else if (values.includes("inherit")) {
      findings.push(`${stream} inherits the terminal`);
    }
  }
  if (!isolates(property("detached"))) {
    findings.push("its child does not lead its own process group");
  }
  return findings;
}

/** Parse one repository source for syntax-level inspection. */
function parsed(path: string, text: string): SourceFile {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
  }).createSourceFile(path, text);
}

Deno.test("every src spawn boundary declares what it does inside an operation", () => {
  const homes = SUBPROCESS_SPAWN_BOUNDARIES
    .filter((boundary) => boundary.path.startsWith("src/"))
    .map((boundary) => siteKey(boundary.path, boundary.enclosingFunction));
  assertEquals(
    [...new Set(homes)].sort(),
    Object.keys(SPAWN_CONTRACTS).sort(),
  );
});

Deno.test("captured spawn homes never inherit a stream and always lead a group", async () => {
  const findings: string[] = [];
  for (const [key, contract] of Object.entries(SPAWN_CONTRACTS)) {
    const [path = "", home = ""] = key.split("#");
    const source = parsed(
      path,
      await Deno.readTextFile(join(REPO_ROOT, path)),
    );
    const constructors = subprocessConstructors(source).filter((node) =>
      enclosingFunction(node) === home
    );
    assert(constructors.length > 0, `${key} constructs no subprocess`);
    if ("terminalOwner" in contract) {
      const owner = constructors[0]?.getFirstAncestor((ancestor) =>
        Node.isFunctionDeclaration(ancestor) &&
        ancestor.getName() === home
      );
      if (
        !(owner?.getText().includes("assertTerminalOwnerAllowed(") ?? false)
      ) {
        findings.push(`${key} hands over the terminal without refusing first`);
      }
      continue;
    }
    for (const constructor of constructors) {
      for (
        const finding of capturedConstructorFindings(
          constructor.getArguments()[1],
        )
      ) {
        findings.push(`${key}: ${finding}`);
      }
    }
  }
  assertEquals(findings, []);
});

Deno.test("every process-signal listener under src declares whom it serves", async () => {
  const files = await structuralGuardScope({
    guard: "tests/in_session_isolation_guard_test.ts#signal-listeners",
    universe: "authored-ts",
    narrow: {
      reason:
        "The interrupt contract governs the shipped process; tests and tooling own their own signals.",
      include: (path) => path.startsWith("src/"),
    },
  });
  const sites: string[] = [];
  for (const path of files) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    if (!text.includes("addSignalListener")) continue;
    for (
      const call of parsed(path, text).getDescendantsOfKind(
        SyntaxKind.CallExpression,
      )
    ) {
      if (call.getExpression().getText() !== "Deno.addSignalListener") {
        continue;
      }
      sites.push(siteKey(path, enclosingFunction(call)));
    }
  }
  assertEquals(
    [...new Set(sites)].sort(),
    Object.keys(SIGNAL_LISTENER_CONTRACTS).sort(),
  );
  for (const [key, contract] of Object.entries(SIGNAL_LISTENER_CONTRACTS)) {
    if (contract.serves !== "process") continue;
    const [path = ""] = key.split("#");
    assert(
      (await Deno.readTextFile(join(REPO_ROOT, path))).includes(
        "currentInterruptSource()",
      ),
      `${key} must consult the interrupt source before it listens`,
    );
  }
});

/** What the instrumented process reported while one scenario ran. */
interface Recorded {
  readonly listeners: Deno.Signal[];
  readonly commands: Deno.CommandOptions[];
}

/** Run `work` recording signal listeners and every command it constructs. */
async function recording(work: () => Promise<void>): Promise<Recorded> {
  const listeners: Deno.Signal[] = [];
  const commands: Deno.CommandOptions[] = [];
  const add = Deno.addSignalListener;
  const Command = Deno.Command;
  Deno.addSignalListener = (signal, handler) => {
    listeners.push(signal);
    add(signal, handler);
  };
  Deno.Command = class extends Command {
    constructor(command: string | URL, options: Deno.CommandOptions = {}) {
      commands.push(options);
      super(command, options);
    }
  };
  try {
    await work();
  } finally {
    Deno.addSignalListener = add;
    Deno.Command = Command;
  }
  return { listeners, commands };
}

/** Every boundary the Desk's in-session effects reach, run once. */
async function everyCapturedBoundary(root: string): Promise<void> {
  const log = new Logger({ json: true, noColor: true });
  await superviseSpawn(
    () =>
      new Deno.Command("true", {
        stdin: "null",
        stdout: "null",
        stderr: "null",
        detached: Deno.build.os !== "windows",
      }).spawn(),
    (child) => child.status,
    { isolatedGroup: Deno.build.os !== "windows" },
  );
  await withTrackedRun(undefined, async () => {
    await runParallel([{ label: "job", command: "true" }], {
      cwd: root,
      stream: false,
      failFast: false,
      color: false,
      quiet: true,
    });
  });
  assertEquals(await runShellRouted("true", { cwd: root, log }), 0);
  assert((await runGit(["--version"], { cwd: root })).success);
  assert((await runShell("true", { cwd: root })).success);
  assert(await commandExists("sh", { cwd: root }));
  await denoMetadata(root, ["--version"]);
}

Deno.test("inside an operation nothing listens for process signals and every child leads its group", async () => {
  await withTempDir(async (root) => {
    const inside = await recording(() =>
      runWithInterruptSource("operation", async () => {
        assertEquals(currentInterruptSource(), "operation");
        await everyCapturedBoundary(root);
      })
    );
    assertEquals(inside.listeners, [], "no process-signal listener");
    assert(inside.commands.length >= 7, "every boundary spawned");
    for (const options of inside.commands) {
      assert(options.stdin !== "inherit", "no child reads the terminal");
      assert(options.stdout !== "inherit" && options.stderr !== "inherit");
      if (Deno.build.os !== "windows") {
        assertEquals(options.detached, true, "every child leads its group");
      }
    }
    const outside = await recording(() => everyCapturedBoundary(root));
    assert(
      outside.listeners.length > 0,
      "outside an operation the same boundaries answer the process",
    );
  });
});

Deno.test("inside an operation a terminal owner refuses before it spawns", async () => {
  const refused = await recording(() =>
    runWithInterruptSource("operation", async () => {
      await assertRejects(() => runOwnedChild("true"), TypeError, "terminal");
      await assertRejects(() => pageThrough("text", "cat"), TypeError);
    })
  );
  assertEquals(refused.commands, [], "nothing was spawned");
});
