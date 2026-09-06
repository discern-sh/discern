/** Architectural enrollment guard for authored Deno rename operations. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  REGISTERED_RENAMES,
  type RegisteredRename,
} from "./atomic_write_renames.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

interface RenameSite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: "rename" | "renameSync";
}

const ATOMIC_WRITE_MODULE = "src/shared/atomic_write.ts";

/** Parse one module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Read a Deno.test callback's stable authored name. */
function denoTestName(node: Node): string | undefined {
  const parent = node.getParent();
  if (
    parent === undefined || !Node.isCallExpression(parent) ||
    parent.getExpression().getText() !== "Deno.test"
  ) {
    return undefined;
  }
  const name = parent.getArguments()[0];
  return Node.isStringLiteral(name)
    ? `Deno.test(${JSON.stringify(name.getLiteralValue())})`
    : undefined;
}

/** Name the nearest stable function boundary around one rename call. */
function enclosingFunction(node: Node): string {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      return ancestor.getName() ?? "<anonymous function>";
    }
    if (
      Node.isMethodDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor) ||
      Node.isSetAccessorDeclaration(ancestor)
    ) {
      return ancestor.getName();
    }
    if (
      Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)
    ) {
      const parent = ancestor.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (Node.isPropertyAssignment(parent)) {
        return parent.getName();
      }
      const testName = denoTestName(ancestor);
      if (testName !== undefined) return testName;
    }
  }
  return "<module>";
}

/** Find direct Deno rename calls by syntax rather than source spelling. */
function renameSites(path: string, source: string): RenameSite[] {
  const parsed = parseModule(path, source);
  const sites: RenameSite[] = [];
  for (
    const call of parsed.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getExpression().getText() !== "Deno") continue;
    const operation = callee.getName();
    if (operation !== "rename" && operation !== "renameSync") continue;
    sites.push({ path, enclosingFunction: enclosingFunction(call), operation });
  }
  return sites;
}

/** Join the stable path and function fields that enroll one intentional rename. */
function registrationKey(
  value: Pick<RegisteredRename, "path" | "enclosingFunction">,
): string {
  return `${value.path}#${value.enclosingFunction}`;
}

/** Report unregistered calls plus malformed, duplicate, and stale registrations. */
function enrolmentFindings(
  sites: readonly RenameSite[],
  registrations: readonly RegisteredRename[],
): string[] {
  const findings: string[] = [];
  const registered = new Map<string, RegisteredRename>();
  for (const entry of registrations) {
    const key = registrationKey(entry);
    if (entry.reason.trim().length < 20 || /[\r\n]/u.test(entry.reason)) {
      findings.push(`${key}: reason must be a specific one-line explanation`);
    }
    if (registered.has(key)) {
      findings.push(`${key}: duplicate rename registration`);
    } else {
      registered.set(key, entry);
    }
  }

  const liveKeys = new Set(
    sites
      .filter((site) => site.path !== ATOMIC_WRITE_MODULE)
      .map(registrationKey),
  );
  for (const key of registered.keys()) {
    if (!liveKeys.has(key)) {
      findings.push(`${key}: stale rename registration`);
    }
  }
  for (const site of sites) {
    if (
      site.path !== ATOMIC_WRITE_MODULE &&
      !registered.has(registrationKey(site))
    ) {
      findings.push(
        `${registrationKey(site)}: unregistered Deno.${site.operation}`,
      );
    }
  }
  return findings.sort();
}

Deno.test("every authored Deno rename is atomic replacement or explicitly enrolled", async () => {
  const files = await structuralGuardScope({
    guard: "tests/atomic_write_enrolment_test.ts#deno-rename-enrollment",
    universe: {
      kind: "specialized",
      name: "repository Deno source including executable test fixtures",
      extensions: [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
      ],
      reason:
        "Executable fixture modules perform filesystem operations despite the canonical fixture exclusion.",
    },
  });
  const sites = (
    await Promise.all(
      files.map(async (path) =>
        renameSites(path, await Deno.readTextFile(join(REPO_ROOT, path)))
      ),
    )
  ).flat();
  const capabilitySites = sites.filter((site) =>
    site.path === ATOMIC_WRITE_MODULE
  );
  const findings = enrolmentFindings(sites, REGISTERED_RENAMES);
  if (
    capabilitySites.length !== 1 ||
    capabilitySites[0]?.operation !== "rename"
  ) {
    findings.push(
      `${ATOMIC_WRITE_MODULE}: expected exactly one asynchronous Deno.rename`,
    );
  }
  assertEquals(
    findings.sort(),
    [],
    "a rename bypassed the atomic writer without an exact path + function reason",
  );
});

Deno.test("rename enrollment rejects an unrelated future sibling", () => {
  const planted = renameSites(
    "unrelated_tools/future_writer.ts",
    `async function transplantArtifact(): Promise<void> {
  await Deno.rename("half-written", "durable-state");
}\n`,
  );
  assertEquals(enrolmentFindings(planted, []), [
    "unrelated_tools/future_writer.ts#transplantArtifact: unregistered Deno.rename",
  ]);
});

Deno.test("rename enrollment rejects a stale reason", () => {
  const stale: RegisteredRename = {
    path: "src/retired_writer.ts",
    enclosingFunction: "moveOldState",
    reason: "This obsolete move once served a different filesystem operation.",
  };
  assertEquals(enrolmentFindings([], [stale]), [
    "src/retired_writer.ts#moveOldState: stale rename registration",
  ]);
});
