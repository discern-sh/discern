/** Behavioral and repository-wide controls for explicit host-state boundaries. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  AMBIENT_MUTATION_BOUNDARIES,
  AMBIENT_READ_BOUNDARIES,
  type AmbientMutationBoundary,
  type AmbientReadBoundary,
  ambientStatePlugin,
  type AmbientStateRegistries,
} from "../scripts/ambient_state_lint.ts";
import { CLOCK_PRIMITIVE_BOUNDARIES } from "../src/shared/clock.ts";
import {
  JITTER_PRIMITIVE_BOUNDARIES,
  SCHEDULER_PRIMITIVE_BOUNDARIES,
} from "../src/shared/scheduler.ts";
import {
  SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
  type SecureEntropyPrimitiveBoundary,
} from "../src/shared/entropy.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const READ_RULE_ID = "discern-ambient-state/no-hidden-ambient-read";
const MUTATION_RULE_ID = "discern-ambient-state/no-unregistered-env-mutation";
const CLOCK_RULE_ID = "discern-ambient-state/no-unregistered-clock-read";
const SCHEDULER_RULE_ID =
  "discern-ambient-state/no-unregistered-scheduler-operation";
const JITTER_RULE_ID =
  "discern-ambient-state/no-unregistered-scheduling-jitter";
const SECURE_ENTROPY_RULE_ID =
  "discern-ambient-state/no-unregistered-secure-entropy";

const EMPTY_REGISTRIES: AmbientStateRegistries = {
  reads: {},
  mutations: {},
  clocks: {},
  schedulers: {},
  jitters: {},
  secureEntropy: {},
};

const LIVE_REGISTRIES: AmbientStateRegistries = {
  reads: AMBIENT_READ_BOUNDARIES,
  mutations: AMBIENT_MUTATION_BOUNDARIES,
  clocks: CLOCK_PRIMITIVE_BOUNDARIES,
  schedulers: SCHEDULER_PRIMITIVE_BOUNDARIES,
  jitters: JITTER_PRIMITIVE_BOUNDARIES,
  secureEntropy: SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
};

/**
 * Assemble inert mutation fixtures without spelling an executable call in this
 * parallel test module; the parallel-safety guard rejects that spelling here.
 */
const DENO_ENV_FIXTURE_OBJECT = "Deno.env";

/** Run the host-state plugin against one in-memory authored module. */
function diagnostics(
  source: string,
  filename = "synthetic.ts",
  registries: AmbientStateRegistries = EMPTY_REGISTRIES,
): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(
    ambientStatePlugin(registries),
    filename,
    source,
  );
}

Deno.test("ambient reads require a visible boundary", () => {
  const found = diagnostics([
    "export function hiddenState(): string {",
    '  return Deno.env.get("FUTURE_STATE") ?? Deno.cwd();',
    "}",
  ].join("\n"));
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    READ_RULE_ID,
    READ_RULE_ID,
  ]);
});

Deno.test("default-parameter ambient reads remain injectable", () => {
  assertEquals(
    diagnostics([
      "export function visibleState(",
      "  env = Deno.env,",
      "  cwd = Deno.cwd(),",
      '  { path = Deno.env.get("PATH") } = {},',
      "): string {",
      '  return env.get("HOME") ?? path ?? cwd;',
      "}",
    ].join("\n")),
    [],
  );
});

Deno.test("ambient registration is exact to path, function, and operation", () => {
  const reads: Readonly<Record<string, AmbientReadBoundary>> = {
    "future-host-state": {
      path: "src/future_host.ts",
      enclosingFunction: "hostState",
      primitive: "env.get",
      operation: "read the executable host marker",
      reason:
        "The synthetic executable boundary composes one process value for pure callers.",
    },
  };
  const found = diagnostics(
    [
      "export function hostState(): string {",
      '  return Deno.env.get("HOST") ?? Deno.cwd();',
      "}",
      "export function neighboringState(): string | undefined {",
      '  return Deno.env.get("NEIGHBOR");',
      "}",
    ].join("\n"),
    "src/future_host.ts",
    { ...EMPTY_REGISTRIES, reads },
  );
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    READ_RULE_ID,
    READ_RULE_ID,
  ]);
});

Deno.test("environment mutation needs an exact registered operation", () => {
  const source = [
    "export function mutate(",
    "  applied = " +
    DENO_ENV_FIXTURE_OBJECT +
    '.set("FUTURE_STATE", "ready"),',
    "): void {",
    "  " + DENO_ENV_FIXTURE_OBJECT + '.delete("FUTURE_STATE");',
    "  void applied;",
    "}",
  ].join("\n");
  assertEquals(
    diagnostics(source).map((diagnostic) => diagnostic.id),
    [MUTATION_RULE_ID, MUTATION_RULE_ID],
  );
  const mutations: Readonly<Record<string, AmbientMutationBoundary>> = {
    "future-host-delete": {
      path: "src/future_host.ts",
      enclosingFunction: "mutate",
      primitive: "env.delete",
      operation: "clear the owned child marker",
      reason:
        "The synthetic executable boundary clears the marker before returning control.",
    },
    "future-host-set": {
      path: "src/future_host.ts",
      enclosingFunction: "mutate",
      primitive: "env.set",
      operation: "publish the owned child marker",
      reason:
        "The synthetic executable boundary publishes one process marker for its owned child.",
    },
  };
  assertEquals(
    diagnostics(source, "src/future_host.ts", {
      ...EMPTY_REGISTRIES,
      mutations,
    }),
    [],
  );
});

Deno.test("clock primitives reject host spellings but allow conversion", () => {
  const found = diagnostics([
    "void Date.now();",
    "void globalThis.Date.now();",
    "void Deno.Date.now();",
    "void performance.now();",
    "void globalThis.performance.now();",
    "void Deno.performance.now();",
    "void Date();",
    "void globalThis.Date();",
    "void Deno.Date();",
    "void new Date();",
    "void new globalThis.Date();",
    "void new Deno.Date();",
    "void new Date(0);",
    "void new globalThis.Date(0);",
  ].join("\n"));
  assertEquals(
    found.map((diagnostic) => diagnostic.id),
    Array.from({ length: 12 }, () => CLOCK_RULE_ID),
  );
});

Deno.test("clock registration cannot authorize a neighboring operation", () => {
  const clocks = {
    "future-wall-clock": {
      path: "src/future_clock.ts",
      enclosingFunction: "wallNow",
      operation: "Date.now" as const,
      reason:
        "The synthetic system clock adapts one host wall-time source for its callers.",
    },
  };
  const found = diagnostics(
    [
      "export function wallNow(): number { return Date.now(); }",
      "export function monotonicNow(): number { return performance.now(); }",
      "export function otherWallNow(): number { return Date.now(); }",
    ].join("\n"),
    "src/future_clock.ts",
    { ...EMPTY_REGISTRIES, clocks },
  );
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    CLOCK_RULE_ID,
    CLOCK_RULE_ID,
  ]);
});

Deno.test("scheduler primitives reject bare, globalThis, and Deno forms", () => {
  const setTimeoutName = ["set", "Timeout"].join("");
  const clearTimeoutName = ["clear", "Timeout"].join("");
  const setIntervalName = ["set", "Interval"].join("");
  const clearIntervalName = ["clear", "Interval"].join("");
  const found = diagnostics([
    "const callback = (): void => {};",
    `const one = ${setTimeoutName}(callback, 1);`,
    `${clearTimeoutName}(one);`,
    `const two = globalThis.${setIntervalName}(callback, 1);`,
    `globalThis.${clearIntervalName}(two);`,
    `const three = Deno.${setTimeoutName}(callback, 1);`,
    `Deno.${clearTimeoutName}(three);`,
    `const four = Deno.${setIntervalName}(callback, 1);`,
    `Deno.${clearIntervalName}(four);`,
  ].join("\n"));
  assertEquals(
    found.map((diagnostic) => diagnostic.id),
    Array.from({ length: 8 }, () => SCHEDULER_RULE_ID),
  );
});

Deno.test("Math.random is reserved for registered scheduling jitter", () => {
  assertEquals(
    diagnostics([
      "void Math.random();",
      "void globalThis.Math.random();",
      "void Deno.Math.random();",
    ].join("\n")).map((diagnostic) => diagnostic.id),
    [JITTER_RULE_ID, JITTER_RULE_ID, JITTER_RULE_ID],
  );
});

Deno.test("secure entropy primitives reject bare, globalThis, and Deno forms", () => {
  const found = diagnostics([
    "void crypto.randomUUID();",
    "void globalThis.crypto.randomUUID();",
    "void Deno.crypto.randomUUID();",
    "void crypto.getRandomValues(new Uint8Array(1));",
    "void globalThis.crypto.getRandomValues(new Uint8Array(1));",
    "void Deno.crypto.getRandomValues(new Uint8Array(1));",
    "void crypto.subtle.generateKey({}, true, []);",
    "void globalThis.crypto.subtle.generateKey({}, true, []);",
    "void Deno.crypto.subtle.generateKey({}, true, []);",
  ].join("\n"));
  assertEquals(
    found.map((diagnostic) => diagnostic.id),
    Array.from({ length: 9 }, () => SECURE_ENTROPY_RULE_ID),
  );
});

Deno.test("a helper wrapping WebCrypto does not evade secure entropy enrollment", () => {
  const found = diagnostics(
    [
      "export function adHocSecureUuid(): string {",
      "  return crypto.randomUUID();",
      "}",
      "export function consumer(): string { return adHocSecureUuid(); }",
    ].join("\n"),
    "src/future_entropy_wrapper.ts",
  );
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    SECURE_ENTROPY_RULE_ID,
  ]);
});

Deno.test("a planted Math.random entropy downgrade remains illegal", () => {
  const found = diagnostics(
    [
      "export function fillSystemSecureBytes(bytes: Uint8Array): void {",
      "  bytes.fill(Math.floor(Math.random() * 256));",
      "}",
    ].join("\n"),
    "src/shared/entropy.ts",
  );
  assertEquals(found.map((diagnostic) => diagnostic.id), [JITTER_RULE_ID]);
});

Deno.test("secure entropy registration is exact to operation and owner", () => {
  const secureEntropy: Readonly<
    Record<string, SecureEntropyPrimitiveBoundary>
  > = {
    "future-secure-uuid": {
      path: "src/future_entropy.ts",
      enclosingFunction: "secureUuid",
      operation: "crypto.randomUUID",
      requiredSecurityProperty:
        "cryptographic unpredictability and collision resistance",
      reason:
        "The synthetic system adapter exposes one secure UUID source to callers.",
    },
  };
  const found = diagnostics(
    [
      "export function secureUuid(): string { return crypto.randomUUID(); }",
      "export function otherUuid(): string { return crypto.randomUUID(); }",
      "export function secureBytes(): void {",
      "  crypto.getRandomValues(new Uint8Array(1));",
      "}",
    ].join("\n"),
    "src/future_entropy.ts",
    { ...EMPTY_REGISTRIES, secureEntropy },
  );
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    SECURE_ENTROPY_RULE_ID,
    SECURE_ENTROPY_RULE_ID,
  ]);
});

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
    ) continue;
    if (
      call.getArguments()[0]?.getText() !==
        "DISCERN_ENVIRONMENT_VARIABLES.trunk"
    ) continue;
    sites.push(path + "#" + enclosingFunction(call));
  }
  return sites;
}

Deno.test("integrationBranch is the only DISCERN_TRUNK environment reader", async () => {
  assertEquals(
    trunkReaderSites(
      "src/future_trunk.ts",
      [
        "export function futureTrunk(",
        "  env: { get(key: string): string | undefined },",
        "): string | undefined {",
        "  return env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk);",
        "}",
      ].join("\n"),
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
  assertEquals(sites, ["src/engine/worktree/trunk.ts#integrationBranch"]);
});

/** Convert one diagnostic byte offset into a one-based source line. */
function diagnosticLine(
  source: string,
  diagnostic: Deno.lint.Diagnostic,
): number {
  return source.slice(0, diagnostic.range[0]).split("\n").length;
}

interface ExactBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: string;
  readonly reason: string;
}

/** One registry's plugin projection, with its native boundary type intact. */
type RegistryDiagnostics<Boundary extends ExactBoundary> = (
  source: string,
  path: string,
  boundaries: Readonly<Record<string, Boundary>>,
) => Deno.lint.Diagnostic[];

/**
 * Bind rows and calls both ways. A group authorizes one exact
 * path/function/primitive tuple, and its row count must equal the live calls.
 */
async function exactRegistryFindings<Boundary extends ExactBoundary>(
  label: string,
  ruleId: string,
  boundaries: Readonly<Record<string, Boundary>>,
  machineOperation: (boundary: Boundary) => string,
  run: RegistryDiagnostics<Boundary>,
): Promise<string[]> {
  const findings: string[] = [];
  const ids = Object.keys(boundaries);
  if (ids.join("\n") !== [...ids].sort().join("\n")) {
    findings.push(label + ": stable ids must be sorted");
  }

  const groups = new Map<string, Array<readonly [string, Boundary]>>();
  for (const [id, boundary] of Object.entries(boundaries)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
      findings.push(label + ":" + id + ": invalid stable id");
    }
    if (
      boundary.reason.trim().length < 30 || /[\r\n]/u.test(boundary.reason)
    ) {
      findings.push(
        label + ":" + id +
          ": reason must be a specific one-line explanation",
      );
    }
    if (
      boundary.operation.trim().length === 0 ||
      /[\r\n]/u.test(boundary.operation)
    ) {
      findings.push(
        label + ":" + id + ": operation must be a stable one-line value",
      );
    }
    const key = [
      boundary.path,
      boundary.enclosingFunction,
      machineOperation(boundary),
    ].join("#");
    const group = groups.get(key) ?? [];
    group.push([id, boundary]);
    groups.set(key, group);
  }

  for (const [key, rows] of groups) {
    const first = rows[0];
    if (first === undefined) continue;
    const path = first[1].path;
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    const selected: Record<string, Boundary> = {};
    for (const [id, boundary] of rows) selected[id] = boundary;
    const before = run(source, path, {}).filter((item) => item.id === ruleId)
      .length;
    const after = run(source, path, selected).filter((item) =>
      item.id === ruleId
    ).length;
    const enrolledCalls = before - after;
    if (enrolledCalls !== rows.length) {
      findings.push(
        label + ":" + key + ": " + rows.length + " row(s) enroll " +
          enrolledCalls + " call(s)",
      );
    }
  }
  return findings;
}

/** Validate security claims that must accompany every entropy exception. */
function secureEntropyMetadataFindings(
  boundaries: Readonly<Record<string, SecureEntropyPrimitiveBoundary>>,
): string[] {
  const findings: string[] = [];
  for (const [id, boundary] of Object.entries(boundaries)) {
    if (
      boundary.requiredSecurityProperty.trim().length < 30 ||
      /[\r\n]/u.test(boundary.requiredSecurityProperty)
    ) {
      findings.push(
        `secure entropy:${id}: required security property must be a specific one-line claim`,
      );
    }
  }
  return findings;
}

Deno.test("secure entropy rows require a stated security property", () => {
  const incomplete: Readonly<
    Record<string, SecureEntropyPrimitiveBoundary>
  > = {
    "future-secure-uuid": {
      path: "src/future_entropy.ts",
      enclosingFunction: "secureUuid",
      operation: "crypto.randomUUID",
      requiredSecurityProperty: "secure",
      reason:
        "The synthetic system adapter exposes one secure UUID source to callers.",
    },
  };
  assertEquals(secureEntropyMetadataFindings(incomplete), [
    "secure entropy:future-secure-uuid: required security property must be a specific one-line claim",
  ]);
});

Deno.test("stale secure entropy boundary rows fail reverse parity", async () => {
  const stale: Readonly<Record<string, SecureEntropyPrimitiveBoundary>> = {
    "stale-secure-uuid": {
      path: "src/shared/entropy.ts",
      enclosingFunction: "removedSystemUuid",
      operation: "crypto.randomUUID",
      requiredSecurityProperty:
        "cryptographic unpredictability and collision resistance",
      reason:
        "The deliberately stale fixture names an operation that no longer exists.",
    },
  };
  const findings = await exactRegistryFindings(
    "secure entropy",
    SECURE_ENTROPY_RULE_ID,
    stale,
    (boundary) => boundary.operation,
    (source, path, secureEntropy) =>
      diagnostics(source, path, { ...EMPTY_REGISTRIES, secureEntropy }),
  );
  assertEquals(findings.length, 1);
});

/** Exact registry and whole-repository findings for all host primitives. */
async function repositoryBoundaryFindings(): Promise<string[]> {
  const findings: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/ambient_state_lint_test.ts#ambient-boundaries",
    universe: "authored-deno",
  });
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const diagnostic of diagnostics(source, rel, LIVE_REGISTRIES)) {
      findings.push(
        rel + ":" + diagnosticLine(source, diagnostic) + " " +
          diagnostic.message,
      );
    }
  }

  findings.push(
    ...await exactRegistryFindings<AmbientReadBoundary>(
      "ambient reads",
      READ_RULE_ID,
      AMBIENT_READ_BOUNDARIES,
      (boundary) => boundary.primitive,
      (source, path, reads) =>
        diagnostics(source, path, { ...EMPTY_REGISTRIES, reads }),
    ),
  );
  findings.push(
    ...await exactRegistryFindings<AmbientMutationBoundary>(
      "ambient mutations",
      MUTATION_RULE_ID,
      AMBIENT_MUTATION_BOUNDARIES,
      (boundary) => boundary.primitive,
      (source, path, mutations) =>
        diagnostics(source, path, { ...EMPTY_REGISTRIES, mutations }),
    ),
  );
  findings.push(
    ...await exactRegistryFindings(
      "clock primitives",
      CLOCK_RULE_ID,
      CLOCK_PRIMITIVE_BOUNDARIES,
      (boundary) => boundary.operation,
      (source, path, clocks) =>
        diagnostics(source, path, { ...EMPTY_REGISTRIES, clocks }),
    ),
  );
  findings.push(
    ...await exactRegistryFindings(
      "scheduler primitives",
      SCHEDULER_RULE_ID,
      SCHEDULER_PRIMITIVE_BOUNDARIES,
      (boundary) => boundary.operation,
      (source, path, schedulers) =>
        diagnostics(source, path, { ...EMPTY_REGISTRIES, schedulers }),
    ),
  );
  findings.push(
    ...await exactRegistryFindings(
      "jitter primitives",
      JITTER_RULE_ID,
      JITTER_PRIMITIVE_BOUNDARIES,
      (boundary) => boundary.operation,
      (source, path, jitters) =>
        diagnostics(source, path, { ...EMPTY_REGISTRIES, jitters }),
    ),
  );
  findings.push(
    ...secureEntropyMetadataFindings(
      SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
    ),
    ...await exactRegistryFindings(
      "secure entropy",
      SECURE_ENTROPY_RULE_ID,
      SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
      (boundary) => boundary.operation,
      (source, path, secureEntropy) =>
        diagnostics(source, path, { ...EMPTY_REGISTRIES, secureEntropy }),
    ),
  );
  return findings;
}

Deno.test("authored code keeps host state at exact declared boundaries", async () => {
  assertEquals(await repositoryBoundaryFindings(), []);
});
