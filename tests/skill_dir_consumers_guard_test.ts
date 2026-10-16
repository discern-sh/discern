/**
 * Skills-directory consumers stay enrolled, and only the ownership module
 * decides what discern owns inside a shared skills directory (ADR 0425).
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { allSkillsDirs } from "../src/lib/providers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  SKILL_DIR_ACCESSORS,
  SKILL_DIR_CONSUMERS,
  SKILL_OWNERSHIP_IMPORTERS,
  SKILL_OWNERSHIP_MODULE,
} from "./skill_dir_consumers.ts";

const ACCESSORS = new Set(SKILL_DIR_ACCESSORS);
const PROJECT = new Project({
  compilerOptions: { noLib: true },
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
});

/** Parse one source into the shared in-memory project. */
function parse(path: string, text: string): SourceFile {
  return PROJECT.createSourceFile(path, text, { overwrite: true });
}

/** Whether an identifier names a declaration rather than reading the accessor. */
function isDeclarationName(id: Node): boolean {
  const parent = id.getParent();
  if (parent === undefined) return true;
  if (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent)) {
    return true;
  }
  if (Node.isBindingElement(parent) && parent.getNameNode() === id) {
    return true;
  }
  return (Node.isFunctionDeclaration(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isPropertySignature(parent) ||
    Node.isPropertyAssignment(parent) ||
    Node.isVariableDeclaration(parent)) &&
    parent.getNameNode() === id;
}

/** Name the function, or the top-level binding, a node sits in. */
function enclosingName(node: Node, file: SourceFile): string {
  for (let current = node.getParent(); current; current = current.getParent()) {
    if (
      Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)
    ) {
      return current.getName() ?? "<anonymous>";
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const holder = current.getParent();
      if (
        holder !== undefined &&
        (Node.isVariableDeclaration(holder) ||
          Node.isPropertyAssignment(holder))
      ) {
        return holder.getName();
      }
    }
    if (
      Node.isVariableDeclaration(current) &&
      current.getVariableStatement()?.getParent() === file
    ) {
      return current.getName();
    }
  }
  return "<module>";
}

/** The accessor names plus every local alias a source binds to one, through an
 * aliased import or an aliased destructuring pattern. */
function accessorNames(file: SourceFile): Set<string> {
  const names = new Set(ACCESSORS);
  for (const named of file.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    const alias = named.getAliasNode();
    if (alias !== undefined && ACCESSORS.has(named.getName())) {
      names.add(alias.getText());
    }
  }
  for (const binding of file.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    const property = binding.getPropertyNameNode();
    if (property !== undefined && ACCESSORS.has(property.getText())) {
      names.add(binding.getName());
    }
  }
  return names;
}

/** The `<module>#<function>` sites that read a skills-directory accessor. */
function accessorSites(path: string, text: string): string[] {
  const file = parse(path, text);
  const names = accessorNames(file);
  const sites = new Set<string>();
  for (const id of file.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (!names.has(id.getText()) || isDeclarationName(id)) continue;
    if (id.getFirstAncestor((node) => Node.isJSDoc(node)) !== undefined) {
      continue;
    }
    sites.add(`${path}#${enclosingName(id, file)}`);
  }
  return [...sites].sort();
}

/** The names a source imports from the ownership module, or `undefined`. */
function ownershipImports(path: string, text: string): string[] | undefined {
  const file = parse(path, text);
  let names: string[] | undefined;
  for (const declaration of file.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier.startsWith(".")) continue;
    if (normalize(join(dirname(path), specifier)) !== SKILL_OWNERSHIP_MODULE) {
      continue;
    }
    names = [
      ...(names ?? []),
      ...declaration.getNamedImports().map((named) => named.getName()),
    ];
  }
  return names?.sort();
}

/** String literals that spell a skills-directory path outside a hint example. */
function skillDirLiterals(
  path: string,
  text: string,
  dirs: readonly string[],
): string[] {
  const file = parse(path, text);
  const found: string[] = [];
  const literals = [
    ...file.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...file.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ...file.getDescendantsOfKind(SyntaxKind.TemplateHead),
    ...file.getDescendantsOfKind(SyntaxKind.TemplateMiddle),
    ...file.getDescendantsOfKind(SyntaxKind.TemplateTail),
  ];
  for (const literal of literals) {
    const value = literal.getText();
    if (!dirs.some((dir) => value.includes(dir))) continue;
    const inExample = literal.getFirstAncestor((node) =>
      Node.isPropertyAssignment(node) && node.getName() === "example"
    ) !== undefined;
    if (!inExample) {
      found.push(`${path}: ${value}`);
    }
  }
  return found;
}

/** Shipped TypeScript: the only code that acts in a user's project. */
const SHIPPED_ONLY = {
  reason:
    "Only shipped source can claim ownership inside a user's skills directory; tests and scripts read the registry to verify it.",
  include: (path: string): boolean => path.startsWith("src/"),
};

Deno.test("every shipped skills-directory accessor use is an enrolled consumer, and every enrolment is live", async () => {
  const sites = new Set<string>();
  for (
    const path of await structuralGuardScope({
      guard: "tests/skill_dir_consumers_guard_test.ts#accessor-sites",
      universe: "authored-ts",
      narrow: SHIPPED_ONLY,
    })
  ) {
    for (
      const site of accessorSites(
        path,
        await Deno.readTextFile(join(REPO_ROOT, path)),
      )
    ) {
      sites.add(site);
    }
  }
  const declared = new Set(Object.keys(SKILL_DIR_CONSUMERS));
  assertEquals(
    [...sites].filter((site) => !declared.has(site)).sort(),
    [],
    "a new consumer reads a skills-directory path: declare it in tests/skill_dir_consumers.ts with its posture",
  );
  assertEquals(
    [...declared].filter((site) => !sites.has(site)).sort(),
    [],
    "a declared consumer no longer reads a skills-directory path: remove it",
  );
});

Deno.test("only the ownership module decides what discern owns inside a skills directory", () => {
  const deciders = Object.entries(SKILL_DIR_CONSUMERS)
    .filter(([, consumer]) => consumer.posture === "ownership")
    .map(([site]) => site);
  assert(deciders.length > 0, "the ownership module must stay enrolled");
  for (const site of deciders) {
    assert(
      site.startsWith(`${SKILL_OWNERSHIP_MODULE}#`),
      `${site} declares the ownership posture; route ownership through ${SKILL_OWNERSHIP_MODULE}`,
    );
  }
});

Deno.test("every shipped importer of the ownership module is enrolled, and each decider names its foreign-entry proof", async () => {
  const importers = new Map<string, string[]>();
  for (
    const path of await structuralGuardScope({
      guard: "tests/skill_dir_consumers_guard_test.ts#ownership-importers",
      universe: "authored-ts",
      narrow: SHIPPED_ONLY,
    })
  ) {
    if (path === SKILL_OWNERSHIP_MODULE) continue;
    const names = ownershipImports(
      path,
      await Deno.readTextFile(join(REPO_ROOT, path)),
    );
    if (names !== undefined) importers.set(path, names);
  }
  assertEquals(
    [...importers.keys()].sort(),
    Object.keys(SKILL_OWNERSHIP_IMPORTERS).sort(),
    "enroll every importer of the ownership module in tests/skill_dir_consumers.ts",
  );
  for (const [path, declaration] of Object.entries(SKILL_OWNERSHIP_IMPORTERS)) {
    if (declaration.role === "names") {
      const nonConstants = (importers.get(path) ?? []).filter((name) =>
        !/^[A-Z][A-Z0-9_]*$/.test(name)
      );
      assertEquals(
        nonConstants,
        [],
        `${path} is enrolled as naming files only, but imports behaviour; enroll it as a decider with a proof`,
      );
      continue;
    }
    const proof = await Deno.readTextFile(
      join(REPO_ROOT, declaration.proof.file),
    );
    assert(
      proof.includes(JSON.stringify(declaration.proof.test)),
      `${path}: ${declaration.proof.file} has no test named ${
        JSON.stringify(declaration.proof.test)
      }`,
    );
  }
});

Deno.test("no shipped string literal spells a skills directory outside the provider registry", async () => {
  const dirs = allSkillsDirs();
  const found: string[] = [];
  for (
    const path of await structuralGuardScope({
      guard: "tests/skill_dir_consumers_guard_test.ts#skills-dir-literals",
      universe: "authored-ts",
      narrow: SHIPPED_ONLY,
    })
  ) {
    if (path === "src/lib/providers.ts") continue;
    found.push(
      ...skillDirLiterals(
        path,
        await Deno.readTextFile(join(REPO_ROOT, path)),
        dirs,
      ),
    );
  }
  assertEquals(
    found,
    [],
    "derive skills-directory paths from the provider registry so the consumer guard sees every use",
  );
});

Deno.test("the consumer scanners find uses, importers, and literals and skip declarations", () => {
  const fixture = [
    'import { allSkillsDirs, skillsDirsForAgents as dirsFor } from "../lib/providers.ts";',
    'import { MATERIALIZED_MANIFEST, surveySkillsDirs } from "../lib/skill_ownership.ts";',
    "/** See {@link allSkillsDirs}. */",
    "export function sweep(): void {",
    "  for (const dir of allSkillsDirs()) Deno.removeSync(dir, { recursive: true });",
    "}",
    "const top = provider.skillsDir?.path;",
    "export const LIST = { list: () => posture.materializedDirs };",
    "interface Shape { skillsDir: string }",
    'const literal = ".claude/skills/x";',
    'const hint = { example: { dirs: ".claude/skills" } };',
    "export function aliased(): string[] { return dirsFor([]); }",
    "export async function lazy(): Promise<string[]> {",
    "  const { allSkillsDirs: every } = await import('../lib/providers.ts');",
    "  return every();",
    "}",
  ].join("\n");
  const path = "src/commands/fixture.ts";
  assertEquals(accessorSites(path, fixture), [
    `${path}#aliased`,
    `${path}#lazy`,
    `${path}#list`,
    `${path}#sweep`,
    `${path}#top`,
  ]);
  assertEquals(ownershipImports(path, fixture), [
    "MATERIALIZED_MANIFEST",
    "surveySkillsDirs",
  ]);
  assertEquals(skillDirLiterals(path, fixture, [".claude/skills"]), [
    `${path}: ".claude/skills/x"`,
  ]);
});
