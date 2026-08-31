/** Repo-wide guard for declared ownership of temporary directories. */

import { assert, assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  TOOL_TEMP_DIR_KINDS,
  type ToolTempDirPolicy,
} from "../scripts/temp_dir.ts";
import { fileExists } from "../src/shared/fs_presence.ts";
import { FUTURE_TOOL_TEMP_DIR_KINDS } from "./fixtures/tool_temp_dir_future_member.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { TEMP_DIR_CREATOR_AUTHORITIES } from "./temp_dir_authorities.ts";

const RAW_CREATORS = new Set(["makeTempDir", "makeTempDirSync"]);

interface SourceModule {
  readonly path: string;
  readonly source: string;
}

interface ToolTempDirCallSite {
  readonly kind: string;
  readonly location: string;
}

/** Parse one TypeScript module without resolving its imports. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Return raw Deno temp-directory creation calls in one TypeScript module. */
function rawTempDirCalls(path: string, source: string): string[] {
  const sourceFile = parseModule(path, source);
  const findings: string[] = [];
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const callee = call.getExpression();
    if (
      Node.isPropertyAccessExpression(callee) &&
      callee.getExpression().getText() === "Deno" &&
      RAW_CREATORS.has(callee.getName())
    ) {
      findings.push(`${path}:${call.getStartLineNumber()} ${callee.getText()}`);
      continue;
    }
    if (
      Node.isElementAccessExpression(callee) &&
      callee.getExpression().getText() === "Deno"
    ) {
      const argument = callee.getArgumentExpression();
      if (
        argument !== undefined && Node.isStringLiteral(argument) &&
        RAW_CREATORS.has(argument.getLiteralValue())
      ) {
        findings.push(
          `${path}:${call.getStartLineNumber()} ${callee.getText()}`,
        );
      }
    }
  }
  return findings;
}

/** The Git-derived TypeScript universe, widened to executable fixture paths. */
async function repoTempDirSourceFiles(root: string): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/temp_dir_guard_test.ts#raw-temp-directory-creators",
    universe: {
      kind: "specialized",
      name: "authored TypeScript including executable fixtures",
      extensions: [".ts", ".tsx"],
      reason:
        "Executable TypeScript fixtures can create directories even though authored-ts omits their inert siblings.",
    },
  }, root);
}

/** Check that every reasoned creator authority still exists and creates. */
async function authorityRegistryFailures(
  root: string,
  files: readonly string[],
): Promise<string[]> {
  const failures: string[] = [];
  const live = new Set(files);
  for (const [path, reason] of TEMP_DIR_CREATOR_AUTHORITIES) {
    if (reason.trim().length < 40 || /[\r\n]/.test(reason)) {
      failures.push(`${path}: authority reason must be a specific line`);
    }
    if (!live.has(path) || !(await fileExists(join(root, path)))) {
      failures.push(`${path}: temp-directory authority entry is stale`);
      continue;
    }
    const calls = rawTempDirCalls(
      path,
      await Deno.readTextFile(join(root, path)),
    );
    if (calls.length === 0) {
      failures.push(
        `${path}: temp-directory authority no longer owns a raw creator`,
      );
    }
  }
  return failures;
}

/** Find every unregistered raw creator under one repository root. */
async function rawCreatorViolations(root: string): Promise<string[]> {
  const files = await repoTempDirSourceFiles(root);
  const offenders: string[] = [];
  for (const path of files) {
    if (TEMP_DIR_CREATOR_AUTHORITIES.has(path)) continue;
    offenders.push(...rawTempDirCalls(
      path,
      await Deno.readTextFile(join(root, path)),
    ));
  }
  return offenders;
}

/** Resolve one relative import from a repo-relative source module. */
function importedModule(path: string, specifier: string): string {
  return normalize(join(dirname(path), specifier));
}

/** Return registered tooling calls imported from the production capability. */
function toolTempDirCallSites(module: SourceModule): {
  readonly calls: ToolTempDirCallSite[];
  readonly failures: string[];
} {
  const sourceFile = parseModule(module.path, module.source);
  const directNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier.startsWith(".")) continue;
    if (importedModule(module.path, specifier) !== "scripts/temp_dir.ts") {
      continue;
    }
    for (const named of declaration.getNamedImports()) {
      if (named.getName() !== "withToolTempDir") continue;
      directNames.add(named.getAliasNode()?.getText() ?? named.getName());
    }
    const namespace = declaration.getNamespaceImport();
    if (namespace !== undefined) namespaceNames.add(namespace.getText());
  }

  const calls: ToolTempDirCallSite[] = [];
  const failures: string[] = [];
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const callee = call.getExpression();
    const direct = Node.isIdentifier(callee) &&
      directNames.has(callee.getText());
    const namespaced = Node.isPropertyAccessExpression(callee) &&
      namespaceNames.has(callee.getExpression().getText()) &&
      callee.getName() === "withToolTempDir";
    if (!direct && !namespaced) continue;
    const argument = call.getArguments()[0];
    if (
      argument === undefined ||
      (!Node.isStringLiteral(argument) &&
        !Node.isNoSubstitutionTemplateLiteral(argument))
    ) {
      failures.push(
        `${module.path}:${call.getStartLineNumber()} withToolTempDir kind must be a literal registry id`,
      );
      continue;
    }
    calls.push({
      kind: argument.getLiteralValue(),
      location: `${module.path}:${call.getStartLineNumber()}`,
    });
  }
  return { calls, failures };
}

/** Hold registry membership equal to the imported production call sites. */
function toolTempDirParityFailures(
  kinds: Readonly<Record<string, ToolTempDirPolicy>>,
  modules: readonly SourceModule[],
): string[] {
  const failures: string[] = [];
  const used = new Set<string>();
  for (const module of modules) {
    const inspected = toolTempDirCallSites(module);
    failures.push(...inspected.failures);
    for (const call of inspected.calls) {
      used.add(call.kind);
      if (!(call.kind in kinds)) {
        failures.push(
          `${call.location} uses unknown TOOL_TEMP_DIR_KINDS member '${call.kind}'`,
        );
      }
    }
  }
  for (const kind of Object.keys(kinds)) {
    if (!used.has(kind)) {
      failures.push(
        `TOOL_TEMP_DIR_KINDS member '${kind}' has no withToolTempDir call site`,
      );
    }
  }
  return failures.sort();
}

/** Read every production tooling module from the declared authored universe. */
async function productionToolModules(): Promise<SourceModule[]> {
  const paths = await structuralGuardScope({
    guard: "tests/temp_dir_guard_test.ts#tool-kind-call-sites",
    universe: "authored-ts",
    narrow: {
      reason:
        "TOOL_TEMP_DIR_KINDS governs repository tool implementations under scripts; raw creation remains guarded repo-wide.",
      include: (path) => path.startsWith("scripts/"),
    },
  });
  return await Promise.all(paths.map(async (path) => ({
    path,
    source: await Deno.readTextFile(join(REPO_ROOT, path)),
  })));
}

Deno.test("raw temp-directory detection covers every authored tree and executable fixtures", () => {
  const plants = [
    "src/future.ts",
    "scripts/future.ts",
    "project/future.ts",
    "tests/future_test.ts",
    "tests/fixtures/future_runner.ts",
    "future_tools/new_root.ts",
  ];
  for (const path of plants) {
    assertEquals(
      rawTempDirCalls(path, "await Deno.makeTempDir();\n"),
      [`${path}:1 Deno.makeTempDir`],
    );
  }
  assertEquals(
    rawTempDirCalls(
      "future_tools/sync.ts",
      "Deno['makeTempDirSync']();\n",
    ),
    ["future_tools/sync.ts:1 Deno['makeTempDirSync']"],
  );
  for (const path of TEMP_DIR_CREATOR_AUTHORITIES.keys()) {
    assert(
      rawTempDirCalls(path, "Deno.makeTempDir();\n").length > 0,
      `${path} remains syntactically detectable before authority classification`,
    );
  }
});

Deno.test("the Git-derived guard enrolls planted roots and only exempts live authorities", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, ".gitignore"), "generated/\n");
    await gitInit(root);
    const plants = [
      "src/future.ts",
      "scripts/future.ts",
      "project/future.ts",
      "tests/future_test.ts",
      "tests/fixtures/future_runner.ts",
      "future_tools/new_root.ts",
    ];
    for (const path of [...TEMP_DIR_CREATOR_AUTHORITIES.keys(), ...plants]) {
      await Deno.mkdir(dirname(join(root, path)), { recursive: true });
      await Deno.writeTextFile(
        join(root, path),
        "export const dir = await Deno.makeTempDir();\n",
      );
    }
    assertEquals(
      await authorityRegistryFailures(
        root,
        await repoTempDirSourceFiles(root),
      ),
      [],
    );
    assertEquals(
      await rawCreatorViolations(root),
      plants.map((path) => `${path}:1 Deno.makeTempDir`).sort(),
    );
  });
});

Deno.test("the three raw-creator authority entries are specific and live", async () => {
  assertEquals(
    await authorityRegistryFailures(
      REPO_ROOT,
      await repoTempDirSourceFiles(REPO_ROOT),
    ),
    [],
  );
});

Deno.test("temp directories come only from their three ownership capabilities", async () => {
  assertEquals(
    await rawCreatorViolations(REPO_ROOT),
    [],
    "raw Deno temp-directory creation has no declared lifetime; use tests/temp_dir.ts, scripts/temp_dir.ts, or src/shared/temp_artifacts.ts",
  );
});

Deno.test("every tooling kind has an imported production call site", async () => {
  assertEquals(
    toolTempDirParityFailures(
      TOOL_TEMP_DIR_KINDS,
      await productionToolModules(),
    ),
    [],
  );
});

Deno.test("a future tooling kind enrolls in call-site parity without guard edits", async () => {
  const live = await productionToolModules();
  assertEquals(
    toolTempDirParityFailures(FUTURE_TOOL_TEMP_DIR_KINDS, [
      ...live,
      {
        path: "scripts/future_evidence.ts",
        source:
          'import { withToolTempDir } from "./temp_dir.ts";\nawait withToolTempDir("future-evidence", async () => {});\n',
      },
    ]),
    [],
  );
  assertEquals(
    toolTempDirParityFailures(FUTURE_TOOL_TEMP_DIR_KINDS, live).filter((line) =>
      line.includes("future-evidence")
    ),
    [
      "TOOL_TEMP_DIR_KINDS member 'future-evidence' has no withToolTempDir call site",
    ],
  );
});
