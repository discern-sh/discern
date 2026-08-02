/**
 * Class guard for await tests that cross a watched transition after an
 * arbitrary sleep. Scheduler load can let the transition happen before the
 * await core captures its baseline, so elapsed time is never readiness
 * evidence. The sweep follows the Git-derived authored-test universe: a new
 * test module enters without being named here.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

interface PendingAwait {
  readonly name: string;
  readonly startLine: number;
}

interface AwaitCliCandidate extends PendingAwait {
  command: string;
}

export interface ReadinessDelay {
  readonly line: number;
  readonly pendingLine: number;
}

const PENDING_CORE =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*awaitResult\s*\(/u;
const CLI_START =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Deno\.Command\s*\(/u;
const ELAPSED_WAIT =
  /\bawait\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*\d[\d_]*(?:\.\d+)?\s*\)\s*;/u;

/** Escape an identifier before using it in a pending-operation terminator. */
function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Find sleeps used between starting an await operation and observing its
 * result. Both in-process `awaitResult` calls and CLI processes whose command
 * contains the await verb belong to the same readiness boundary.
 */
export function preReadinessDelays(source: string): ReadinessDelay[] {
  const offenders: ReadinessDelay[] = [];
  const pending: PendingAwait[] = [];
  let cliCandidate: AwaitCliCandidate | undefined;
  for (const [index, line] of source.split("\n").entries()) {
    const lineNumber = index + 1;
    const coreMatch = line.match(PENDING_CORE);
    const coreName = coreMatch?.[1];
    if (coreName !== undefined) {
      pending.push({ name: coreName, startLine: lineNumber });
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
        });
      }
      cliCandidate = undefined;
    }

    if (ELAPSED_WAIT.test(line)) {
      for (const operation of pending) {
        offenders.push({ line: lineNumber, pendingLine: operation.startLine });
      }
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
  }
  return offenders;
}

Deno.test("await harness: elapsed time cannot stand in for readiness", async () => {
  const syntheticCore = [
    "const pendingObservation = " + "awaitResult(root, { trunkMoved: true });",
    "await " + "letClockPass(37);",
    "const outcome = await pendingObservation;",
  ].join("\n");
  const syntheticCli = [
    "const backgroundProbe = new Deno.Command(Deno.execPath(), {",
    "  args: [MAIN_TS, " + '"await"' + ", " + '"--trunk-moved"' + "],",
    "}).spawn();",
    "await " + "burnTicks(91);",
    "const outcome = await backgroundProbe.output();",
  ].join("\n");
  assertEquals(preReadinessDelays(syntheticCore), [
    { line: 2, pendingLine: 1 },
  ]);
  assertEquals(preReadinessDelays(syntheticCli), [
    { line: 4, pendingLine: 1 },
  ]);

  const offenders: string[] = [];
  for (
    const rel of AUTHORED_TS_FILES.filter((path) => path.startsWith("tests/"))
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const delay of preReadinessDelays(source)) {
      offenders.push(
        `${rel}:${delay.line} starts from pending await at line ${delay.pendingLine}`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    "await tests must synchronize on an observable readiness boundary",
  );
});
