/** Shared full-universe census for test waiting and real-delay enrollment. */

import { join } from "@std/path";
import {
  TEST_REAL_DELAY_BOUNDARIES,
  type TestRealDelayBoundary,
} from "./waiting.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

export interface WaitingSource {
  readonly path: string;
  readonly source: string;
}

const TIMER_CALL = /\b(?:setTimeout|setInterval)\s*\(/gu;
const REAL_DELAY_CALL = /\brealDelay\s*\(\s*([^,\n)]*)/gu;
const LITERAL_ID = /^(?:"([^"]+)"|'([^']+)')$/u;
const CAPABILITY_PATH = "tests/waiting.ts";

/** Convert a byte offset into a stable one-based source line. */
function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/** Return the Git-derived executable test and fixture text universe. */
export async function waitingSources(
  root: string = REPO_ROOT,
): Promise<WaitingSource[]> {
  const files = await structuralGuardScope({
    guard: "tests/test_waiting_guard.ts#test-waiting",
    universe: {
      kind: "specialized",
      name: "executable-test-text",
      text: true,
      reason:
        "Test waiting spans authored modules, executable fixtures, and child-program source embedded in either form.",
    },
    narrow: {
      reason:
        "Test directories and native test entry names enroll at any depth; production scheduling is outside test waiting.",
      include: (path) =>
        /(?:^|\/)tests\//u.test(path) ||
        /(?:^|\/)(?:[^/]+[._]test|test)\.[cm]?[jt]sx?$/u.test(path),
    },
  }, root);
  return await Promise.all(files.map(async (path) => ({
    path,
    source: await Deno.readTextFile(join(root, path)),
  })));
}

/** Inspect direct timer calls and the two-way registry/call-site contract. */
export function waitingFindings(
  sources: readonly WaitingSource[],
  boundaries: Readonly<Record<string, TestRealDelayBoundary>> =
    TEST_REAL_DELAY_BOUNDARIES,
): string[] {
  const findings: string[] = [];
  const calls = new Map<string, { path: string; line: number }[]>();
  for (const item of sources) {
    if (item.path !== CAPABILITY_PATH) {
      for (const match of item.source.matchAll(TIMER_CALL)) {
        findings.push(
          `${item.path}:${
            lineAt(item.source, match.index)
          } calls a raw test timer outside ${CAPABILITY_PATH}`,
        );
      }
    }
    if (item.path === CAPABILITY_PATH) continue;
    for (const match of item.source.matchAll(REAL_DELAY_CALL)) {
      const argument = match[1]?.trim() ?? "";
      const literal = argument.match(LITERAL_ID);
      const id = literal?.[1] ?? literal?.[2];
      const line = lineAt(item.source, match.index);
      if (id === undefined) {
        findings.push(
          `${item.path}:${line} realDelay boundary id must be a string literal`,
        );
        continue;
      }
      const boundary = boundaries[id];
      if (boundary === undefined) {
        findings.push(
          `${item.path}:${line} calls unknown realDelay boundary '${id}'`,
        );
        continue;
      }
      const enrolled = calls.get(id) ?? [];
      enrolled.push({ path: item.path, line });
      calls.set(id, enrolled);
      if (boundary.path !== item.path) {
        findings.push(
          `${item.path}:${line} realDelay boundary '${id}' is registered at ${boundary.path}`,
        );
      }
      if (!item.source.includes(boundary.enclosing)) {
        findings.push(
          `${item.path}:${line} realDelay boundary '${id}' cannot find enclosing '${boundary.enclosing}'`,
        );
      }
    }
  }
  for (const id of Object.keys(boundaries).sort()) {
    const enrolled = calls.get(id) ?? [];
    if (enrolled.length === 0) {
      findings.push(`realDelay boundary '${id}' has no call site`);
    } else if (enrolled.length > 1) {
      findings.push(
        `realDelay boundary '${id}' has ${enrolled.length} call sites; expected exactly one`,
      );
    }
  }
  return findings.sort();
}
