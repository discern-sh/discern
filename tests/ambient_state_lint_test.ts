/** Behavioral and repository-wide controls for the ambient-state lint rules. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  AMBIENT_MUTATION_BOUNDARIES,
  AMBIENT_READ_BOUNDARIES,
  type AmbientMutationBoundary,
  type AmbientReadBoundary,
  ambientStatePlugin,
} from "../scripts/ambient_state_lint.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const READ_RULE_ID = "discern-ambient-state/no-hidden-ambient-read";
const MUTATION_RULE_ID = "discern-ambient-state/no-unregistered-env-mutation";

/**
 * Assemble inert mutation fixtures without spelling an executable call in this
 * parallel test module; the parallel-safety guard deliberately rejects that
 * spelling anywhere in a top-level test source file.
 */
const DENO_ENV_FIXTURE_OBJECT = "Deno.env";

/** Run the ambient-state plugin against an in-memory authored module. */
function diagnostics(
  source: string,
  filename = "synthetic.ts",
  reads: readonly AmbientReadBoundary[] = AMBIENT_READ_BOUNDARIES,
  mutations: readonly AmbientMutationBoundary[] = AMBIENT_MUTATION_BOUNDARIES,
): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(
    ambientStatePlugin({ reads, mutations }),
    filename,
    source,
  );
}

Deno.test("ambient reads require a visible boundary", () => {
  const found = diagnostics(`
export function hiddenState(): string {
  return Deno.env.get("FUTURE_STATE") ?? Deno.cwd();
}
`);
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    READ_RULE_ID,
    READ_RULE_ID,
  ]);
});

Deno.test("default-parameter reads remain injectable", () => {
  assertEquals(
    diagnostics(`
export function visibleState(
  env = Deno.env,
  cwd = Deno.cwd(),
  { path = Deno.env.get("PATH") } = {},
): string {
  return env.get("HOME") ?? path ?? cwd;
}
`),
    [],
  );
});

Deno.test("registered host modules may compose ambient values", () => {
  const reads: readonly AmbientReadBoundary[] = [{
    path: "src/future_host.ts",
    reason: "This executable module composes process values for pure callers.",
  }];
  assertEquals(
    diagnostics(
      `export const host = Deno.env.get("HOST") ?? Deno.cwd();\n`,
      "src/future_host.ts",
      reads,
    ),
    [],
  );
});

Deno.test("environment mutation needs an exact registration even in defaults", () => {
  const source = `
export function mutate(
  applied = ${DENO_ENV_FIXTURE_OBJECT}.set("FUTURE_STATE", "ready"),
): void {
  ${DENO_ENV_FIXTURE_OBJECT}.delete("FUTURE_STATE");
  void applied;
}
`;
  assertEquals(
    diagnostics(source).map((diagnostic) => diagnostic.id),
    [MUTATION_RULE_ID, MUTATION_RULE_ID],
  );
  const mutations: readonly AmbientMutationBoundary[] = [
    {
      path: "src/future_host.ts",
      enclosingFunction: "mutate",
      operation: "set",
      reason:
        "The executable boundary publishes one process marker for its owned child.",
    },
    {
      path: "src/future_host.ts",
      enclosingFunction: "mutate",
      operation: "delete",
      reason:
        "The executable boundary clears the same marker before returning control.",
    },
  ];
  assertEquals(diagnostics(source, "src/future_host.ts", [], mutations), []);
});

/** Return malformed, duplicate, or stale boundary registrations. */
function registryFindings(
  liveReadPaths: ReadonlySet<string>,
  liveMutationPaths: ReadonlySet<string>,
): string[] {
  const findings: string[] = [];
  const readPaths = AMBIENT_READ_BOUNDARIES.map((entry) => entry.path);
  assertEquals(
    readPaths,
    [...readPaths].sort(),
    "read boundaries must be sorted",
  );
  const seenReads = new Set<string>();
  for (const entry of AMBIENT_READ_BOUNDARIES) {
    if (seenReads.has(entry.path)) {
      findings.push(`${entry.path}: duplicate read boundary`);
    }
    seenReads.add(entry.path);
    if (entry.reason.trim().length < 30 || /[\r\n]/u.test(entry.reason)) {
      findings.push(
        `${entry.path}: read reason must be a specific one-line explanation`,
      );
    }
    if (!liveReadPaths.has(entry.path)) {
      findings.push(`${entry.path}: stale read boundary`);
    }
  }

  const mutationKeys = AMBIENT_MUTATION_BOUNDARIES.map((entry) =>
    `${entry.path}#${entry.enclosingFunction}#${entry.operation}`
  );
  assertEquals(
    mutationKeys,
    [...mutationKeys].sort(),
    "mutation boundaries must be sorted",
  );
  const seenMutations = new Set<string>();
  for (const [index, entry] of AMBIENT_MUTATION_BOUNDARIES.entries()) {
    const key = mutationKeys[index] ?? entry.path;
    if (seenMutations.has(key)) {
      findings.push(`${key}: duplicate mutation boundary`);
    }
    seenMutations.add(key);
    if (entry.reason.trim().length < 30 || /[\r\n]/u.test(entry.reason)) {
      findings.push(
        `${key}: mutation reason must be a specific one-line explanation`,
      );
    }
    if (!liveMutationPaths.has(entry.path)) {
      findings.push(`${key}: stale mutation boundary`);
    }
  }
  return findings;
}

/** Parse one module without resolving its dependency graph. */
function parseModule(
  path: string,
  source: string,
): import("ts-morph").SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Stable function name around one focused trunk-reader finding. */
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
    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const parent = ancestor.getParent();
      if (Node.isVariableDeclaration(parent)) return parent.getName();
      if (Node.isPropertyAssignment(parent)) return parent.getName();
    }
  }
  return "<module>";
}

/** Find calls that read the registered trunk environment variable directly. */
function trunkReaderSites(path: string, source: string): string[] {
  if (!source.includes("DISCERN_ENVIRONMENT_VARIABLES.trunk")) return [];
  const sites: string[] = [];
  for (
    const call of parseModule(path, source).getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )
  ) {
    const callee = call.getExpression();
    if (
      !Node.isPropertyAccessExpression(callee) || callee.getName() !== "get"
    ) {
      continue;
    }
    if (
      call.getArguments()[0]?.getText() !==
        "DISCERN_ENVIRONMENT_VARIABLES.trunk"
    ) continue;
    sites.push(`${path}#${enclosingFunction(call)}`);
  }
  return sites;
}

Deno.test("integrationBranch is the only DISCERN_TRUNK environment reader", async () => {
  assertEquals(
    trunkReaderSites(
      "src/future_trunk.ts",
      `export function futureTrunk(env: { get(key: string): string | undefined }): string | undefined {
  return env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk);
}\n`,
    ),
    ["src/future_trunk.ts#futureTrunk"],
  );

  const sites: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/ambient_state_lint_test.ts#trunk-reader-authority",
      universe: "authored-deno",
    })
  ) {
    sites.push(...trunkReaderSites(
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ));
  }
  assertEquals(sites, ["src/engine/worktree/git.ts#integrationBranch"]);
});

/** Convert one diagnostic byte offset into a one-based source line. */
function diagnosticLine(
  source: string,
  diagnostic: Deno.lint.Diagnostic,
): number {
  return source.slice(0, diagnostic.range[0]).split("\n").length;
}

Deno.test("authored Deno code keeps ambient state at declared boundaries", async () => {
  const findings: string[] = [];
  const liveReadPaths = new Set<string>();
  const liveMutationPaths = new Set<string>();
  for (
    const rel of await structuralGuardScope({
      guard: "tests/ambient_state_lint_test.ts#ambient-boundaries",
      universe: "authored-deno",
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const diagnostic of diagnostics(source, rel, [], [])) {
      if (diagnostic.id === READ_RULE_ID) liveReadPaths.add(rel);
      if (diagnostic.id === MUTATION_RULE_ID) liveMutationPaths.add(rel);
    }
    for (const diagnostic of diagnostics(source, rel)) {
      findings.push(
        `${rel}:${diagnosticLine(source, diagnostic)} ${diagnostic.message}`,
      );
    }
  }
  findings.push(...registryFindings(liveReadPaths, liveMutationPaths));
  assertEquals(findings, []);
});
