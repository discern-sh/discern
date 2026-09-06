/**
 * Class guard for tests that launch a pending operation before observing its
 * readiness boundary. A raw condition poll can expire under scheduler load
 * before the behavior under test begins, while an arbitrary delay can let the
 * transition precede its baseline. The sweep follows the Git-derived authored
 * test universe: a new test module enters without being named here.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const AWAIT_TEST_FILES = await structuralGuardScope({
  guard: "tests/await_readiness_guard_test.ts#await-test-readiness",
  universe: "authored-ts",
  narrow: {
    reason:
      "The invariant governs test synchronization around asynchronous probes; runtime await implementations follow a different contract.",
    include: (path) => path.startsWith("tests/"),
  },
});

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

interface PendingConditionViolation {
  readonly line: number;
  readonly pendingLine: number;
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

/** Whether this await directly settles the named pending operation. */
function directlyAwaits(awaited: Node, name: string): boolean {
  if (!Node.isAwaitExpression(awaited)) return false;
  const expression = awaited.getExpression();
  if (Node.isIdentifier(expression)) return expression.getText() === name;
  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getExpression().getText() === name;
  }
  if (!Node.isCallExpression(expression)) return false;
  const callee = expression.getExpression();
  if (
    callee.getText() === "settlePending" &&
    expression.getArguments()[0]?.getText() === name
  ) {
    return true;
  }
  if (
    Node.isPropertyAccessExpression(callee) &&
    callee.getExpression().getText() === name
  ) {
    return true;
  }
  if (
    !Node.isPropertyAccessExpression(callee) ||
    callee.getExpression().getText() !== "Promise" ||
    !["all", "allSettled", "any", "race"].includes(callee.getName())
  ) {
    return false;
  }
  return expression.getArguments().some((argument) =>
    argument.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) =>
      identifier.getText() === name
    ) || (Node.isIdentifier(argument) && argument.getText() === name)
  );
}

/** Resolve the callable declarations behind a local or imported expression. */
function callableDeclarations(expression: Node): Node[] {
  const symbol = expression.getSymbol();
  if (symbol === undefined) return [];
  return symbol.getAliasedSymbol()?.getDeclarations() ??
    symbol.getDeclarations();
}

/** The function-like node represented by one callable declaration. */
function callableNode(declaration: Node): Node | undefined {
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return declaration;
  }
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  return Node.isFunctionExpression(initializer) ||
      Node.isArrowFunction(initializer)
    ? initializer
    : undefined;
}

/** The named waiting authority represented by one declaration, when any. */
function waitingAuthorityName(declaration: Node): string | undefined {
  if (
    !declaration.getSourceFile().getFilePath().endsWith("/tests/waiting.ts")
  ) {
    return undefined;
  }
  if (Node.isFunctionDeclaration(declaration)) return declaration.getName();
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const name = declaration.getNameNode();
  return Node.isIdentifier(name) ? name.getText() : undefined;
}

/** Whether a helper's call graph reaches raw waiting instead of the authority. */
function declarationUsesRawWait(
  declaration: Node,
  seen: Set<string>,
): boolean {
  const authority = waitingAuthorityName(declaration);
  if (authority === "waitUntil") return true;
  if (
    authority === "waitForPendingCondition" || authority === "settlePending"
  ) {
    return false;
  }
  const callable = callableNode(declaration);
  if (callable === undefined) return false;
  const key =
    `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return callable.getDescendantsOfKind(SyntaxKind.CallExpression).some(
    (nested) => {
      if (enclosingFunction(nested) !== callable) return false;
      const callee = nested.getExpression();
      if (callee.getText() === "waitUntil") return true;
      return callableDeclarations(callee).some((candidate) =>
        declarationUsesRawWait(candidate, seen)
      );
    },
  );
}

/** Whether an awaited helper ultimately delegates to raw condition waiting. */
function helperWaitsUntil(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (callee.getText() === "waitUntil") return true;
  return callableDeclarations(callee).some((declaration) =>
    declarationUsesRawWait(declaration, new Set())
  );
}

/**
 * Find a pending operation whose positive condition is polled without also
 * observing that operation. Its wall-clock poll can expire under scheduler
 * load before the behavior being tested has even begun.
 */
function preReadinessConditionWaits(
  sourceFile: SourceFile,
): PendingConditionViolation[] {
  const violations: PendingConditionViolation[] = [];
  for (
    const declaration of sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )
  ) {
    const nameNode = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (
      !Node.isIdentifier(nameNode) || initializer === undefined ||
      Node.isAwaitExpression(initializer)
    ) {
      continue;
    }
    const scope = enclosingFunction(declaration);
    if (scope === undefined) continue;
    const name = nameNode.getText();
    const awaits = scope.getDescendantsOfKind(SyntaxKind.AwaitExpression)
      .filter((awaited) =>
        awaited.getStart() > declaration.getEnd() &&
        enclosingFunction(awaited) === scope
      );
    const settlementIndex = awaits.findIndex((awaited) =>
      directlyAwaits(awaited, name)
    );
    if (settlementIndex < 0) continue;
    for (const awaited of awaits.slice(0, settlementIndex)) {
      const expression = awaited.getExpression();
      if (!helperWaitsUntil(expression)) continue;
      violations.push({
        line: sourceFile.getLineAndColumnAtPos(awaited.getStart()).line,
        pendingLine:
          sourceFile.getLineAndColumnAtPos(declaration.getStart()).line,
      });
      break;
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

Deno.test("test harness: pending operations participate in readiness", async () => {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
  });
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

  const futureSibling = project.createSourceFile(
    "future-sibling.ts",
    [
      "async function waitForBeacon() {",
      "  await waitUntil(() => beaconExists(), 'unrelated beacon');",
      "}",
      "async function observe() {",
      "  const expedition = hydrateSatellite();",
      "  await waitForBeacon();",
      "  return await expedition;",
      "}",
      "export {};",
    ].join("\n"),
  );
  assertEquals(preReadinessConditionWaits(futureSibling), [{
    line: 6,
    pendingLine: 5,
  }]);

  const synchronizedSibling = project.createSourceFile(
    "synchronized-sibling.ts",
    [
      "async function waitForBeacon(pending: Promise<unknown>) {",
      "  await waitForPendingCondition(pending, () => beaconExists(), 'unrelated beacon');",
      "}",
      "async function observe() {",
      "  const expedition = hydrateSatellite();",
      "  await waitForBeacon(expedition);",
      "  return await expedition;",
      "}",
      "export {};",
    ].join("\n"),
  );
  assertEquals(preReadinessConditionWaits(synchronizedSibling), []);

  const deceptiveSibling = project.createSourceFile(
    "deceptive-sibling.ts",
    [
      "async function waitForBeacon(_pending: Promise<unknown>) {",
      "  await waitUntil(() => beaconExists(), 'unrelated beacon');",
      "}",
      "async function observe() {",
      "  const expedition = hydrateSatellite();",
      "  await waitForBeacon(expedition);",
      "  return await expedition;",
      "}",
      "export {};",
    ].join("\n"),
  );
  assertEquals(preReadinessConditionWaits(deceptiveSibling), [{
    line: 6,
    pendingLine: 5,
  }]);

  project.createSourceFile(
    "readiness/raw-beacon.ts",
    [
      "export async function waitForBeacon() {",
      "  await waitUntil(() => beaconExists(), 'unrelated beacon');",
      "}",
    ].join("\n"),
  );
  const importedSibling = project.createSourceFile(
    "readiness/imported-sibling.ts",
    [
      "import { waitForBeacon } from './raw-beacon.ts';",
      "async function observe() {",
      "  const expedition = hydrateSatellite();",
      "  await waitForBeacon();",
      "  return await expedition;",
      "}",
    ].join("\n"),
  );
  assertEquals(preReadinessConditionWaits(importedSibling), [{
    line: 4,
    pendingLine: 3,
  }]);

  const combinedSibling = project.createSourceFile(
    "combined-sibling.ts",
    [
      "async function observe() {",
      "  const firstExpedition = hydrateSatellite();",
      "  const secondExpedition = hydrateSatellite();",
      "  await waitUntil(() => beaconExists(), 'unrelated beacon');",
      "  return await Promise.all([firstExpedition, secondExpedition]);",
      "}",
    ].join("\n"),
  );
  assertEquals(preReadinessConditionWaits(combinedSibling), [
    { line: 4, pendingLine: 2 },
    { line: 4, pendingLine: 3 },
  ]);

  const authoredSources = await Promise.all(
    AWAIT_TEST_FILES.map(async (rel) => ({
      rel,
      source: await Deno.readTextFile(join(REPO_ROOT, rel)),
    })),
  );
  for (const { rel, source } of authoredSources) {
    project.createSourceFile(rel, source, { overwrite: true });
  }

  const offenders: string[] = [];
  for (const { rel, source } of authoredSources) {
    for (const violation of preReadinessAwaits(source)) {
      offenders.push(
        `${rel}:${violation.line} starts from pending await at line ${violation.pendingLine}`,
      );
    }
    const sourceFile = project.getSourceFileOrThrow(rel);
    for (const violation of preReadinessConditionWaits(sourceFile)) {
      offenders.push(
        `${rel}:${violation.line} polls a condition without pending operation from line ${violation.pendingLine}`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    "pending-operation readiness must use waitForPendingCondition with the pending promise; raw waitUntil turns parallel scheduler load into a false timeout — see project/map/80-development/testing.md#waiting-and-time-boundaries",
  );
});

Deno.test("job-runner behavior clocks start after observable readiness", async () => {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
  });
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
    const rel of AWAIT_TEST_FILES
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
