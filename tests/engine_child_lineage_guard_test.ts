/**
 * Every runtime process boundary propagates the recording invocation, or
 * explicitly ends its lineage at an interactive handoff. Checking constructors
 * covers commands assembled at runtime and future shell/self-invocation callers.
 * Tooling and test harnesses do not mint recorder invocations. Fixed read-only
 * probes and the OS browser handoff cannot dispatch a recorded child verb.
 */
import { assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { Node, Project } from "ts-morph";
import {
  enclosingFunction,
  resolveSpawnExpression,
  subprocessConstructors,
} from "../scripts/subprocess_spawn_boundaries.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";

const EXEMPT = new Map([
  [
    "src/shared/subprocess.ts#commandExists",
    "command -v probes resolution without executing the command",
  ],
  [
    "src/shared/deno_metadata.ts#denoMetadata",
    "Deno info/types queries do not invoke discern",
  ],
  [
    "src/engine/mcp/version_check.ts#captureVersionCommand",
    "PATH resolution and --version do not dispatch a recorded verb",
  ],
  [
    "src/lib/open_browser.ts#runBrowserCommand",
    "the OS browser handoff starts an independent graphical session",
  ],
]);

/** Resolve the universe at the call site so a future runtime root joins. */
function lineageFiles(root: string): Promise<string[]> {
  return structuralGuardScope({
    guard: "tests/engine_child_lineage_guard_test.ts#runtime-child-lineage",
    universe: "authored-ts",
    narrow: {
      reason:
        "Runtime children carry recorder invocations; test harnesses, build scripts, and the separate site do not mint them.",
      include: (path) => !/^(tests|scripts|site)\//.test(path),
    },
  }, root);
}

/** Require the canonical helper as the final environment overlay. */
function hasLineageOverlay(
  options: Node | undefined,
  helpers: ReadonlySet<string>,
): boolean {
  const resolved = resolveSpawnExpression(options);
  if (resolved === undefined || !Node.isObjectLiteralExpression(resolved)) {
    return false;
  }
  const property = resolved.getProperty("env");
  if (property === undefined || !Node.isPropertyAssignment(property)) {
    return false;
  }
  if (
    resolved.getProperties().slice(
      resolved.getProperties().indexOf(property) + 1,
    )
      .some((entry) => Node.isSpreadAssignment(entry))
  ) return false;
  const environment = resolveSpawnExpression(property.getInitializer());
  if (
    environment === undefined || !Node.isObjectLiteralExpression(environment)
  ) return false;
  const last = environment.getProperties().at(-1);
  if (last === undefined || !Node.isSpreadAssignment(last)) return false;
  const call = last.getExpression();
  return Node.isCallExpression(call) &&
    helpers.has(call.getExpression().getText());
}

/** Inspect syntax; a local alias of the helper or constructor keeps its meaning. */
function lineageFindings(source: string, path: string): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile(path, source);
  const helpers = new Set(
    file.getImportDeclarations().flatMap((declaration) => {
      const target = normalize(
        join(dirname(path), declaration.getModuleSpecifierValue()),
      );
      if (target !== "src/shared/invocation_context.ts") return [];
      return declaration.getNamedImports().filter((name) =>
        name.getName() === "spawnedByEnv"
      )
        .map((name) => name.getAliasNode()?.getText() ?? name.getName());
    }),
  );
  return subprocessConstructors(file).flatMap((node) => {
    const key = `${path}#${enclosingFunction(node)}`;
    if (EXEMPT.has(key) || hasLineageOverlay(node.getArguments()[1], helpers)) {
      return [];
    }
    return [
      `${key}:${node.getStartLineNumber()}: finish the child env with ...spawnedByEnv(); use interactive lineage for a user handoff`,
    ];
  });
}

Deno.test("every runtime subprocess declares its child lineage at the spawn boundary", async () => {
  const findings = [];
  for (const path of await lineageFiles(REPO_ROOT)) {
    findings.push(
      ...lineageFindings(await Deno.readTextFile(join(REPO_ROOT, path)), path),
    );
  }
  assertEquals(findings, []);
});

Deno.test("lineage guard rejects unrelated future launchers and overwritten stamps", async () => {
  await withTempDir(async (root) => {
    const path = "another/container/relay.ts";
    await Deno.mkdir(join(root, dirname(path)), { recursive: true });
    const prefix =
      'import { spawnedByEnv as provenance } from "../../src/shared/invocation_context.ts";\nconst Launch = Deno.Command;\n';
    const bodies = [
      'new Launch("future-tool", { args: payload });',
      'new Launch("future-tool", { env: { ...provenance(), ...untrusted } });',
      'new Launch("future-tool", { env: { ...provenance() } });',
      'const inherited = { ...untrusted, ...provenance() }; new Launch("future-tool", { env: inherited });',
    ];
    await Deno.writeTextFile(join(root, path), prefix + bodies[0]);
    await gitInit(root);
    for (const [index, body] of bodies.entries()) {
      await Deno.writeTextFile(join(root, path), prefix + body);
      assertEquals(await lineageFiles(root), [path]);
      assertEquals(
        lineageFindings(prefix + body, path).length,
        index < 2 ? 1 : 0,
      );
    }
  });
});
