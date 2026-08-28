/**
 * Conservative census of declarations kept alive only by a direct `export`.
 *
 * This closes the gap in TypeScript's unused-local check: an exported
 * declaration is considered reachable even when no authored module imports or
 * uses it. Re-exports, default exports, configured public modules, declaration
 * files, namespace imports, and dynamic imports are treated as live. That
 * deliberately favors false negatives over deleting a dynamic or public API.
 */

import { dirname, join, normalize } from "@std/path/posix";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const DENO_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/**
 * Authored modules consumed only after a whole-module generated projection.
 * Each row is a reachability root, not debt: the generated-artifact tests bind
 * the named source and consumer copy byte-for-byte.
 */
export const DEAD_EXPORT_EXTERNAL_ROOTS = {
  "src/lib/docs_search.js":
    "codegen copies this complete module to site/pages/assets/search.js, whose named exports are imported by the browser client",
} as const satisfies Readonly<Record<string, string>>;

/** One authored source supplied to the in-memory module census. */
export interface DeadExportSource {
  readonly path: string;
  readonly source: string;
}

/** One direct named export with no local or authored-module consumer. */
export interface DeadExportFinding {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly kind: "type" | "value";
}

/** Module-graph facts that are not present in source syntax itself. */
export interface DeadExportOptions {
  /** Deno import-map entries; only repository-local targets are resolved. */
  readonly imports?: Readonly<Record<string, string>>;
  /** Modules whose named exports are consumed outside this repository. */
  readonly publicModules?: ReadonlySet<string>;
}

interface DirectExportDeclaration {
  readonly name: string;
  readonly kind: DeadExportFinding["kind"];
  readonly nameStart: number;
  readonly line: number;
}

/** Normalize a repository-relative module path into one comparison form. */
function normalizedPath(path: string): string {
  const normalized = normalize(path.replaceAll("\\", "/"));
  return normalized.replace(/^\.\//, "").replace(/^\//, "");
}

/** Remove URL-like query and fragment suffixes from a module specifier. */
function bareSpecifier(specifier: string): string {
  const query = specifier.indexOf("?");
  const fragment = specifier.indexOf("#", 1);
  const suffixes = [query, fragment].filter((index) => index >= 0);
  const end = suffixes.length === 0 ? specifier.length : Math.min(...suffixes);
  return specifier.slice(0, end);
}

/** Resolve one exact or prefix Deno import-map entry. */
function mappedSpecifier(
  specifier: string,
  imports: Readonly<Record<string, string>>,
): string | undefined {
  const exact = imports[specifier];
  if (exact !== undefined) return exact;
  for (const [prefix, target] of Object.entries(imports)) {
    if (!prefix.endsWith("/") || !target.endsWith("/")) continue;
    if (specifier.startsWith(prefix)) {
      return `${target}${specifier.slice(prefix.length)}`;
    }
  }
  return undefined;
}

/** Candidate paths for the source behind one local module specifier. */
function candidateModulePaths(path: string): string[] {
  const candidate = normalizedPath(path);
  const candidates = [candidate];
  if (
    !DENO_SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension))
  ) {
    for (const extension of DENO_SOURCE_EXTENSIONS) {
      candidates.push(`${candidate}${extension}`);
      candidates.push(`${candidate}/index${extension}`);
    }
  } else if (candidate.endsWith(".js")) {
    candidates.push(candidate.slice(0, -3) + ".ts");
    candidates.push(candidate.slice(0, -3) + ".tsx");
  }
  return candidates;
}

/** Resolve a source-backed module specifier, or leave external packages alone. */
function resolveModule(
  importer: string,
  rawSpecifier: string,
  sourcePaths: ReadonlySet<string>,
  imports: Readonly<Record<string, string>>,
): string | undefined {
  const specifier = bareSpecifier(rawSpecifier);
  const mapped = mappedSpecifier(specifier, imports);
  let candidate: string;
  if (mapped !== undefined) {
    if (!mapped.startsWith(".") && !mapped.startsWith("/")) return undefined;
    candidate = mapped;
  } else if (specifier.startsWith(".")) {
    candidate = join(dirname(importer), specifier);
  } else if (specifier.startsWith("/")) {
    candidate = specifier;
  } else {
    return undefined;
  }
  return candidateModulePaths(candidate).find((path) => sourcePaths.has(path));
}

/** Add one exact external use without losing an earlier wildcard use. */
function addNamedUse(
  uses: Map<string, Set<string> | "*">,
  target: string,
  name: string,
): void {
  const existing = uses.get(target);
  if (existing === "*") return;
  const names = existing ?? new Set<string>();
  names.add(name);
  uses.set(target, names);
}

/** A namespace or dynamic import can select any exported name at runtime. */
function addWildcardUse(
  uses: Map<string, Set<string> | "*">,
  target: string,
): void {
  uses.set(target, "*");
}

/** Collect authored import, re-export, and dynamic-import consumers. */
function externalUses(
  sourceFiles: readonly SourceFile[],
  sourcePaths: ReadonlySet<string>,
  imports: Readonly<Record<string, string>>,
): Map<string, Set<string> | "*"> {
  const uses = new Map<string, Set<string> | "*">();
  for (const sourceFile of sourceFiles) {
    const importer = normalizedPath(sourceFile.getFilePath());
    for (const declaration of sourceFile.getImportDeclarations()) {
      const target = resolveModule(
        importer,
        declaration.getModuleSpecifierValue(),
        sourcePaths,
        imports,
      );
      if (target === undefined) continue;
      if (declaration.getNamespaceImport() !== undefined) {
        addWildcardUse(uses, target);
      }
      for (const named of declaration.getNamedImports()) {
        addNamedUse(uses, target, named.getName());
      }
    }
    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier === undefined) continue;
      const target = resolveModule(importer, specifier, sourcePaths, imports);
      if (target === undefined) continue;
      const named = declaration.getNamedExports();
      if (named.length === 0) {
        addWildcardUse(uses, target);
      } else {
        for (const exported of named) {
          addNamedUse(uses, target, exported.getName());
        }
      }
    }
    for (
      const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
    ) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const argument = call.getArguments()[0];
      if (argument === undefined || !Node.isStringLiteral(argument)) continue;
      const target = resolveModule(
        importer,
        argument.getLiteralValue(),
        sourcePaths,
        imports,
      );
      if (target !== undefined) addWildcardUse(uses, target);
    }
  }
  return uses;
}

/** Register one identifier-backed direct export declaration. */
function declaration(
  sourceFile: SourceFile,
  nameNode: Node | undefined,
  kind: DeadExportFinding["kind"],
): DirectExportDeclaration | undefined {
  if (nameNode === undefined || !Node.isIdentifier(nameNode)) return undefined;
  return {
    name: nameNode.getText(),
    nameStart: nameNode.getStart(),
    line: sourceFile.getLineAndColumnAtPos(nameNode.getStart()).line,
    kind,
  };
}

/** Direct named exports only; aliases and facade re-exports are left alone. */
function directExports(sourceFile: SourceFile): DirectExportDeclaration[] {
  const declarations: DirectExportDeclaration[] = [];
  for (const statement of sourceFile.getStatements()) {
    if (Node.isVariableStatement(statement) && statement.isExported()) {
      for (const variable of statement.getDeclarations()) {
        const found = declaration(sourceFile, variable.getNameNode(), "value");
        if (found !== undefined) declarations.push(found);
      }
      continue;
    }
    if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isEnumDeclaration(statement) ||
      Node.isModuleDeclaration(statement)
    ) {
      if (!statement.isExported() || statement.isDefaultExport()) continue;
      const found = declaration(sourceFile, statement.getNameNode(), "value");
      if (found !== undefined) declarations.push(found);
      continue;
    }
    if (
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement)
    ) {
      if (!statement.isExported() || statement.isDefaultExport()) continue;
      const found = declaration(sourceFile, statement.getNameNode(), "type");
      if (found !== undefined) declarations.push(found);
    }
  }
  return declarations;
}

/** Whether a declaration name has any other identifier occurrence in its file. */
function usedLocally(
  sourceFile: SourceFile,
  declarations: readonly DirectExportDeclaration[],
): boolean {
  const name = declarations[0]?.name;
  if (name === undefined) return true;
  const declarationStarts = new Set(
    declarations.map((candidate) => candidate.nameStart),
  );
  return sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).some((node) =>
    node.getText() === name && !declarationStarts.has(node.getStart())
  );
}

/**
 * Find direct named exports with neither a local identifier use nor an
 * authored-module consumer. The caller supplies public-module knowledge.
 */
export function deadExportsInSources(
  sources: readonly DeadExportSource[],
  options: DeadExportOptions = {},
): DeadExportFinding[] {
  const paths = sources.map((source) => normalizedPath(source.path));
  if (new Set(paths).size !== paths.length) {
    throw new Error("dead-export census received duplicate source paths");
  }
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFiles = sources.map((source, index) =>
    project.createSourceFile(paths[index] ?? source.path, source.source)
  );
  const sourcePaths = new Set(paths);
  const uses = externalUses(sourceFiles, sourcePaths, options.imports ?? {});
  const publicModules = new Set(
    [...(options.publicModules ?? [])].map(normalizedPath),
  );
  const findings: DeadExportFinding[] = [];
  for (const sourceFile of sourceFiles) {
    const file = normalizedPath(sourceFile.getFilePath());
    if (file.endsWith(".d.ts") || publicModules.has(file)) continue;
    const grouped = Map.groupBy(
      directExports(sourceFile),
      (candidate) => candidate.name,
    );
    for (const [name, declarations] of grouped) {
      if (usedLocally(sourceFile, declarations)) continue;
      const external = uses.get(file);
      if (external === "*" || external?.has(name) === true) continue;
      const first = declarations[0];
      if (first === undefined) continue;
      findings.push({ file, line: first.line, name, kind: first.kind });
    }
  }
  return findings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line ||
    left.name.localeCompare(right.name)
  );
}

/** Read repository-local Deno import-map entries from a config document. */
export function configuredLocalImports(
  configText: string,
): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(configText);
  if (typeof parsed !== "object" || parsed === null) return {};
  const imports = Reflect.get(parsed, "imports");
  if (typeof imports !== "object" || imports === null) return {};
  return Object.fromEntries(
    Object.entries(imports).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Recursively collect local source paths from `deno.json#exports`. */
function publicExportPaths(value: unknown, paths: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith(".") || value.startsWith("/")) {
      paths.add(normalizedPath(value));
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) publicExportPaths(child, paths);
}

/** Modules explicitly published through `deno.json#exports`. */
export function configuredPublicModules(configText: string): Set<string> {
  const parsed: unknown = JSON.parse(configText);
  const paths = new Set<string>();
  if (typeof parsed !== "object" || parsed === null) return paths;
  publicExportPaths(Reflect.get(parsed, "exports"), paths);
  return paths;
}

/** Read and scan one canonical authored-Deno universe. */
export async function deadExportsInFiles(
  root: string,
  files: readonly string[],
  configText: string,
): Promise<DeadExportFinding[]> {
  const sources = await Promise.all(
    files.map(async (path) => ({
      path,
      source: await Deno.readTextFile(join(root, path)),
    })),
  );
  return deadExportsInSources(sources, {
    imports: configuredLocalImports(configText),
    publicModules: new Set([
      ...configuredPublicModules(configText),
      ...Object.keys(DEAD_EXPORT_EXTERNAL_ROOTS),
    ]),
  });
}
