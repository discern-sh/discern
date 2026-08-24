/** Architectural enrollment guard for authored Deno rename operations. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

interface RenameSite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: "rename" | "renameSync";
}

interface RenameRegistration {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly reason: string;
}

const ATOMIC_WRITE_MODULE = "src/shared/atomic_write.ts";

/** Non-replacement renames whose move, claim, probe, or fixture semantics are intentional. */
const REGISTERED_RENAMES = [
  {
    path: "scripts/cli_install.ts",
    enclosingFunction: "writeExecutableSync",
    reason:
      "The signal handler must restore the executable synchronously before process exit.",
  },
  {
    path: "src/engine/logbook/store.ts",
    enclosingFunction: "detachLogbook",
    reason:
      "Reset and archive move the complete active directory into recovery before cleanup.",
  },
  {
    path: "src/engine/worktree/effort_grant_cleanup.ts",
    enclosingFunction: "claimEffortGrant",
    reason:
      "Acceptance claims exclusive grant ownership by moving the standing marker to its claim path.",
  },
  {
    path: "src/lib/migrations.ts",
    enclosingFunction: "rename",
    reason:
      "Installation migration relocates an existing path rather than replacing durable file bytes.",
  },
  {
    path: "src/shared/self_shim.ts",
    enclosingFunction: "writeShimAside",
    reason:
      "Content-addressed shim convergence tolerates a same-content rename race across processes.",
  },
  {
    path: "src/shared/write_preflight.ts",
    enclosingFunction: "probeDirectoryEntry",
    reason:
      "The preflight deliberately exercises rename authority with a disposable probe entry.",
  },
  {
    path: "tests/engine_done_json_surfaces_test.ts",
    enclosingFunction:
      'Deno.test("done --json: two ADR records claiming one number fail the adr_numbers check; renumbering fixes it")',
    reason:
      "The fixture renumbers one ADR file to prove the duplicate-number diagnostic clears.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("orphan sweep apply keeps a dir that gained work after the scan")',
    reason:
      "The fixture moves a checkout to construct an orphan that changes after the scan.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("remove-worktree-safely refuses a symlink substituted for the registered path")',
    reason:
      "The fixture parks and restores a checkout around a symlink-substitution safety check.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("worktree prune does not let an orphan env file assert destructive ownership")',
    reason:
      "The fixture relocates a checkout whose environment file carries forged ownership evidence.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("worktree prune keeps a dirty orphaned dir at the configured worktree root")',
    reason:
      "The fixture relocates a dirty checkout to model an orphan that prune must preserve.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("worktree prune reclaims a clean fully-orphaned dir at the configured worktree root")',
    reason:
      "The fixture relocates a merged checkout to model an orphan that prune may reclaim.",
  },
  {
    path: "tests/fixtures/desk_tty_harness.ts",
    enclosingFunction: "effect",
    reason:
      "The executable fixture publishes a complete terminal-resize request to its child process.",
  },
  {
    path: "tests/fixtures/flagship_terminal_captures.ts",
    enclosingFunction: "lengthNormalizedRoot",
    reason:
      "The executable fixture relocates its temporary root to a platform-neutral path width.",
  },
] as const satisfies readonly RenameRegistration[];

/** Parse one module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
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
  value: Pick<RenameRegistration, "path" | "enclosingFunction">,
): string {
  return `${value.path}#${value.enclosingFunction}`;
}

/** Report unregistered calls plus malformed, duplicate, and stale registrations. */
function enrolmentFindings(
  sites: readonly RenameSite[],
  registrations: readonly RenameRegistration[],
): string[] {
  const findings: string[] = [];
  const registered = new Map<string, RenameRegistration>();
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
  const stale: RenameRegistration = {
    path: "src/retired_writer.ts",
    enclosingFunction: "moveOldState",
    reason: "This obsolete move once served a different filesystem operation.",
  };
  assertEquals(enrolmentFindings([], [stale]), [
    "src/retired_writer.ts#moveOldState: stale rename registration",
  ]);
});
