/**
 * Class guard for await tests that cross a watched transition after an
 * arbitrary sleep. Scheduler load can let the transition happen before the
 * await core captures its baseline, so elapsed time is never readiness
 * evidence. The sweep follows the Git-derived authored-test universe: a new
 * test module enters without being named here.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

interface PendingAwait {
  readonly name: string;
  readonly startLine: number;
  ready: boolean;
}

interface AwaitCliCandidate {
  readonly name: string;
  readonly startLine: number;
  command: string;
}

interface ReadinessViolation {
  readonly line: number;
  readonly pendingLine: number;
}

interface AwaitCall {
  readonly startLine: number;
  text: string;
  depth: number;
}

interface RunParallelTimerViolation {
  readonly callLine: number;
  readonly timerLine: number;
}

/** The nearest function owns a timer and the behavior whose runtime it judges. */
function enclosingFunction(node: Node): Node | undefined {
  return node.getFirstAncestor((ancestor) =>
    Node.isArrowFunction(ancestor) ||
    Node.isFunctionDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isMethodDeclaration(ancestor)
  );
}

/** Find job-runner clocks whose origin precedes the asynchronous run itself. */
function preReadinessRunParallelTimers(
  sourceFile: SourceFile,
): RunParallelTimerViolation[] {
  const violations: RunParallelTimerViolation[] = [];
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    if (call.getExpression().getText() !== "runParallel") continue;
    const scope = enclosingFunction(call);
    if (scope === undefined) continue;
    for (
      const declaration of scope.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration,
      )
    ) {
      if (
        declaration.getStart() >= call.getStart() ||
        enclosingFunction(declaration) !== scope
      ) {
        continue;
      }
      const initializer = declaration.getInitializer()?.getText();
      if (
        initializer !== "performance.now()" && initializer !== "Date.now()"
      ) {
        continue;
      }
      violations.push({
        callLine: sourceFile.getLineAndColumnAtPos(call.getStart()).line,
        timerLine:
          sourceFile.getLineAndColumnAtPos(declaration.getStart()).line,
      });
    }
  }
  return violations;
}

const PENDING_CORE =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*awaitResult\s*\(/u;
const CLI_START =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Deno\.Command\s*\(/u;
const AWAIT_CALL_START =
  /\bawait\s+(?:new\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/u;

/** Escape an identifier before using it in a pending-operation terminator. */
function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Count call parentheses while an awaited readiness expression spans lines. */
function parenthesisDelta(value: string): number {
  return [...value].reduce(
    (depth, character) =>
      depth + (character === "(" ? 1 : character === ")" ? -1 : 0),
    0,
  );
}

/**
 * Find pending await operations whose first async boundary does not receive
 * that operation. Passing the promise (or CLI status) makes readiness
 * observable and lets the probe fail on early settlement; an unrelated wait
 * leaves startup timing as an assumption.
 */
function preReadinessAwaits(source: string): ReadinessViolation[] {
  const offenders: ReadinessViolation[] = [];
  const pending: PendingAwait[] = [];
  let cliCandidate: AwaitCliCandidate | undefined;
  let awaitCall: AwaitCall | undefined;
  for (const [index, line] of source.split("\n").entries()) {
    const lineNumber = index + 1;
    const coreMatch = line.match(PENDING_CORE);
    const coreName = coreMatch?.[1];
    if (coreName !== undefined) {
      pending.push({ name: coreName, startLine: lineNumber, ready: false });
    }

    const cliMatch = line.match(CLI_START);
    const cliName = cliMatch?.[1];
    if (cliName !== undefined) {
      cliCandidate = {
        name: cliName,
        startLine: lineNumber,
        command: line,
      };
    } else if (cliCandidate !== undefined) {
      cliCandidate.command += `\n${line}`;
    }
    if (cliCandidate !== undefined && line.includes(".spawn()")) {
      if (
        cliCandidate.command.includes("MAIN_TS") &&
        cliCandidate.command.includes('"await"')
      ) {
        pending.push({
          name: cliCandidate.name,
          startLine: cliCandidate.startLine,
          ready: false,
        });
      }
      cliCandidate = undefined;
    }

    for (
      let pendingIndex = pending.length - 1;
      pendingIndex >= 0;
      pendingIndex--
    ) {
      const operation = pending[pendingIndex];
      if (operation === undefined || lineNumber === operation.startLine) {
        continue;
      }
      const escaped = regexEscape(operation.name);
      if (
        new RegExp(`\\bawait\\s+${escaped}\\b`, "u").test(line) ||
        new RegExp(`\\bawait\\s+${escaped}\\.output\\s*\\(`, "u").test(line)
      ) {
        pending.splice(pendingIndex, 1);
      }
    }

    if (awaitCall === undefined && AWAIT_CALL_START.test(line)) {
      awaitCall = {
        startLine: lineNumber,
        text: line,
        depth: parenthesisDelta(line),
      };
    } else if (awaitCall !== undefined && awaitCall.startLine !== lineNumber) {
      awaitCall.text += `\n${line}`;
      awaitCall.depth += parenthesisDelta(line);
    }
    if (awaitCall !== undefined && awaitCall.depth <= 0) {
      for (const operation of pending.filter((item) => !item.ready)) {
        const escaped = regexEscape(operation.name);
        if (
          new RegExp(`\\b${escaped}(?:\\.status)?\\b`, "u").test(awaitCall.text)
        ) {
          operation.ready = true;
        } else {
          offenders.push({
            line: awaitCall.startLine,
            pendingLine: operation.startLine,
          });
        }
      }
      awaitCall = undefined;
    }
  }
  return offenders;
}

Deno.test("await harness: elapsed time cannot stand in for readiness", async () => {
  const syntheticCore = [
    "const pendingObservation = " + "awaitResult(root, { trunkMoved: true });",
    "await " + "letClockPass(WAIT_WINDOW);",
    "const outcome = await pendingObservation;",
  ].join("\n");
  const syntheticCli = [
    "const backgroundProbe = new Deno.Command(Deno.execPath(), {",
    "  args: [MAIN_TS, " + '"await"' + ", " + '"--trunk-moved"' + "],",
    "}).spawn();",
    "await " + "burnTicks(RETRY_BUDGET);",
    "const outcome = await backgroundProbe.output();",
  ].join("\n");
  const synchronized = [
    "const pendingSignal = " + "awaitResult(root, { trunkMoved: true });",
    "await " + 'ready(pendingSignal, "trunk watch")' + ";",
    "const outcome = await pendingSignal;",
  ].join("\n");
  assertEquals(preReadinessAwaits(syntheticCore), [
    { line: 2, pendingLine: 1 },
  ]);
  assertEquals(preReadinessAwaits(syntheticCli), [
    { line: 4, pendingLine: 1 },
  ]);
  assertEquals(preReadinessAwaits(synchronized), []);

  const offenders: string[] = [];
  for (
    const rel of AUTHORED_TS_FILES.filter((path) => path.startsWith("tests/"))
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const violation of preReadinessAwaits(source)) {
      offenders.push(
        `${rel}:${violation.line} starts from pending await at line ${violation.pendingLine}`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    "await tests must synchronize on an observable readiness boundary",
  );
});

Deno.test("job-runner behavior clocks start after observable readiness", async () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const early = project.createSourceFile(
    "early.ts",
    [
      "async function probe() {",
      "  const started = performance.now();",
      "  const pending = runParallel([]);",
      "  return { result: await pending, elapsed: performance.now() - started };",
      "}",
    ].join("\n"),
  );
  const ready = project.createSourceFile(
    "ready.ts",
    [
      "async function probe() {",
      "  const pending = runParallel([]);",
      "  await waitForMarker();",
      "  const started = performance.now();",
      "  return { result: await pending, elapsed: performance.now() - started };",
      "}",
    ].join("\n"),
  );
  assertEquals(preReadinessRunParallelTimers(early), [{
    callLine: 3,
    timerLine: 2,
  }]);
  assertEquals(preReadinessRunParallelTimers(ready), []);

  const offenders: string[] = [];
  for (
    const rel of AUTHORED_TS_FILES.filter((path) => path.startsWith("tests/"))
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    const sourceFile = project.createSourceFile(rel, source, {
      overwrite: true,
    });
    for (const violation of preReadinessRunParallelTimers(sourceFile)) {
      offenders.push(
        `${rel}:${violation.callLine} starts after a clock at line ${violation.timerLine}`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    "a correctness test may bound cancellation after a marker or observer transition, but must not count scheduler-delayed process startup",
  );
});
