/**
 * Every place the engine starts a configured command either asks the
 * concurrent-commands limit for a place or is registered here with the reason
 * it need not.
 *
 * The limit bounds a gate run only if no path starts commands around it. A
 * command starts through `spawnJob`, or through `runCapturedCommands`, which
 * wraps it. A call to either that sits inside the function passed to
 * `underCommandLimit` is admitted. Any other call must be a registered launch
 * point, so a new one fails here until its admission is decided.
 */

import { assert, assertEquals } from "@std/assert";
import { type Node, Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";

const LAUNCHERS = ["spawnJob", "runCapturedCommands"];
const ADMISSION = "underCommandLimit";
const LAUNCHER_MENTION = new RegExp(`\\b(?:${LAUNCHERS.join("|")})\\(`, "u");

/** Launch calls outside an admission, keyed `path#function`, with their reason. */
const UNADMITTED_LAUNCH_POINTS: Readonly<Record<string, string>> = {
  "src/engine/jobs/runner.ts#runSerial":
    "a serial stage starts each job after the previous one settles",
  "src/engine/jobs/captured.ts#runCapturedCommands":
    "wraps one spawn for its caller, and every call to it is itself checked here",
  "src/engine/checkpoints/when.ts#runWhenCommand":
    "a checkpoint's trigger probe runs before the gate's commands and is not one of them",
};

interface LaunchCall {
  readonly launcher: string;
  readonly within: string;
  readonly line: number;
  readonly admitted: boolean;
}

/** The nearest enclosing function's name, or `<module>` at the top level. */
function enclosingFunction(node: Node): string {
  for (const ancestor of node.getAncestors()) {
    const declaration = ancestor.asKind(SyntaxKind.FunctionDeclaration) ??
      ancestor.asKind(SyntaxKind.MethodDeclaration);
    const name = declaration?.getName();
    if (name !== undefined) return name;
  }
  return "<module>";
}

/** Every call that starts a command, and whether an admission encloses it. */
function launchCalls(source: string): LaunchCall[] {
  const file = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
  }).createSourceFile("subject.ts", source);
  return file.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => LAUNCHERS.includes(call.getExpression().getText()))
    .map((call) => ({
      launcher: call.getExpression().getText(),
      within: enclosingFunction(call),
      line: call.getStartLineNumber(),
      admitted: call.getAncestors().some((ancestor) =>
        ancestor.asKind(SyntaxKind.CallExpression)?.getExpression()
          .getText() === ADMISSION
      ),
    }));
}

Deno.test("every command launch asks the limit for a place or is a registered exception", async () => {
  const sources = await readScopedSources(
    REPO_ROOT,
    await structuralGuardScope({
      guard: "tests/command_launch_limit_guard_test.ts#launches-ask-the-limit",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only src/ holds the engine that starts a project's configured commands.",
        include: (path) => path.startsWith("src/"),
      },
    }),
  );
  const calls = sources
    .filter(({ source }) => LAUNCHER_MENTION.test(source))
    .flatMap(({ path, source }) =>
      launchCalls(source).map((call) => ({
        ...call,
        key: `${path}#${call.within}`,
        path,
      }))
    );
  const unadmitted = calls.filter((call) => !call.admitted);
  assertEquals(
    unadmitted.filter((call) => !(call.key in UNADMITTED_LAUNCH_POINTS)).map((
      call,
    ) =>
      `${call.path}:${call.line}: ${call.launcher}(…) in ${call.within} starts a command without ${ADMISSION}(…). Start it inside the function passed to ${ADMISSION}, or register ${call.key} with its reason in UNADMITTED_LAUNCH_POINTS.`
    ),
    [],
  );
  // A registered exception that no longer exists must leave the registry.
  assertEquals(
    Object.keys(UNADMITTED_LAUNCH_POINTS).filter((key) =>
      !unadmitted.some((call) => call.key === key)
    ),
    [],
  );
  // Both paths the gate launches commands through are admitted.
  assertEquals(
    calls.filter((call) => call.admitted).map((call) => call.key).sort(),
    [
      "src/engine/jobs/runner.ts#runParallel",
      "src/engine/validation/runtime.ts#runtime",
    ],
  );
});

Deno.test("the launch detector separates admitted calls from bare ones", () => {
  const calls = launchCalls([
    "async function admitted(limit) {",
    "  return await underCommandLimit(limit, turn, async () => {",
    "    started();",
    "    return await spawnJob(job, options);",
    "  });",
    "}",
    "async function bare() {",
    "  return await runCapturedCommands(input);",
    "}",
    "class Runner {",
    "  async launch() { return await spawnJob(job, options); }",
    "}",
    "const later = () => spawnJob(job, options);",
    "function unrelated() { return spawnJobs(job); }",
  ].join("\n"));
  assertEquals(
    calls.map((call) => [call.launcher, call.within, call.admitted]),
    [
      ["spawnJob", "admitted", true],
      ["runCapturedCommands", "bare", false],
      ["spawnJob", "launch", false],
      ["spawnJob", "<module>", false],
    ],
  );
  assert(!LAUNCHER_MENTION.test("spawnJobs(job)"));
});
