/** Type-aware detection for promise-like values ignored as expressions. */

import { dirname, join } from "@std/path";
import {
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
  ts,
  type Type,
} from "ts-morph";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";

interface DenoInfoResolution {
  readonly specifier: string;
}

interface DenoInfoDependency {
  readonly specifier: string;
  readonly code?: DenoInfoResolution;
  readonly type?: DenoInfoResolution;
}

interface DenoInfoModule {
  readonly specifier: string;
  readonly local?: string;
  readonly mediaType?: string;
  readonly dependencies: readonly DenoInfoDependency[];
}

interface DenoInfoNpmPackage {
  readonly name: string;
  readonly localPath: string;
}

interface DenoInfoGraph {
  readonly modules: readonly DenoInfoModule[];
  readonly redirects: Readonly<Record<string, string>>;
  readonly npmPackages: readonly DenoInfoNpmPackage[];
}

interface ExternalGraph {
  readonly graph: DenoInfoGraph;
  readonly resolutions: Readonly<Record<string, string>>;
}

interface GraphModule {
  readonly compilerPath: string;
  readonly extension: ts.Extension;
  readonly info: DenoInfoModule;
  readonly source: string;
}

interface DenoJson {
  readonly imports: Readonly<Record<string, string>>;
}

/** One ignored promise-like expression or type-resolution refusal. */
export interface PromiseEffectFinding {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly enclosingFunction: string;
  readonly expression: string;
  readonly type: string;
  readonly reason: "ignored-promise" | "naked-void" | "unresolved-type";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

/** Decode one optional Deno module-graph resolution. */
function decodeResolution(
  value: unknown,
  context: string,
): DenoInfoResolution | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${context} must be an object`);
  return { specifier: requiredString(value, "specifier", context) };
}

/** Decode the dependency edges needed by the TypeScript resolution host. */
function decodeDependencies(
  value: unknown,
  context: string,
): DenoInfoDependency[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${context} must be an array`);
  return value.map((item, index) => {
    const itemContext = `${context}[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${itemContext} must be an object`);
    }
    const code = decodeResolution(item.code, `${itemContext}.code`);
    const type = decodeResolution(item.type, `${itemContext}.type`);
    return {
      specifier: requiredString(item, "specifier", itemContext),
      ...(code === undefined ? {} : { code }),
      ...(type === undefined ? {} : { type }),
    };
  });
}

/** Decode the stable subset of `deno info --json` used by the checker. */
function decodeDenoInfoGraph(value: unknown): DenoInfoGraph {
  if (!isRecord(value)) {
    throw new TypeError("deno info output must be an object");
  }
  if (!Array.isArray(value.modules)) {
    throw new TypeError("deno info output.modules must be an array");
  }
  const modules = value.modules.map((item, index): DenoInfoModule => {
    const context = `deno info output.modules[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${context} must be an object`);
    const local = item.local;
    const mediaType = item.mediaType;
    if (local !== undefined && local !== null && typeof local !== "string") {
      throw new TypeError(`${context}.local must be a string or null`);
    }
    if (
      mediaType !== undefined && mediaType !== null &&
      typeof mediaType !== "string"
    ) {
      throw new TypeError(`${context}.mediaType must be a string or null`);
    }
    return {
      specifier: requiredString(item, "specifier", context),
      ...(typeof local === "string" ? { local } : {}),
      ...(typeof mediaType === "string" ? { mediaType } : {}),
      dependencies: decodeDependencies(
        item.dependencies,
        `${context}.dependencies`,
      ),
    };
  });

  if (!isRecord(value.redirects)) {
    throw new TypeError("deno info output.redirects must be an object");
  }
  const redirects: Record<string, string> = {};
  for (const [from, to] of Object.entries(value.redirects)) {
    if (typeof to !== "string") {
      throw new TypeError(`deno info redirect '${from}' must name a string`);
    }
    redirects[from] = to;
  }

  if (!isRecord(value.npmPackages)) {
    throw new TypeError("deno info output.npmPackages must be an object");
  }
  const npmPackages: DenoInfoNpmPackage[] = [];
  for (const [id, item] of Object.entries(value.npmPackages)) {
    if (!isRecord(item)) {
      throw new TypeError(`deno info npm package '${id}' must be an object`);
    }
    npmPackages.push({
      name: requiredString(item, "name", `deno info npm package '${id}'`),
      localPath: requiredString(
        item,
        "localPath",
        `deno info npm package '${id}'`,
      ),
    });
  }
  return { modules, redirects, npmPackages };
}

/** Read the exact import-map aliases which Deno applies to this checkout. */
async function readDenoJson(root: string): Promise<DenoJson> {
  const parsed: unknown = JSON.parse(
    await Deno.readTextFile(join(root, "deno.json")),
  );
  if (!isRecord(parsed) || !isRecord(parsed.imports)) {
    throw new TypeError("deno.json.imports must be an object");
  }
  const imports: Record<string, string> = {};
  for (const [name, target] of Object.entries(parsed.imports)) {
    if (typeof target !== "string" || target.length === 0) {
      throw new TypeError(`deno.json import '${name}' must name a string`);
    }
    imports[name] = target;
  }
  return { imports };
}

/** Run one read-only Deno metadata command and return its stdout. */
async function denoMetadata(
  root: string,
  args: readonly string[],
): Promise<string> {
  const output = await new Deno.Command("deno", {
    args: [...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `deno ${args[0] ?? "metadata"} failed: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

/** Resolve every configured external alias once through Deno's live graph. */
async function externalGraph(
  root: string,
  denoJson: DenoJson,
  moduleSpecifiers: readonly string[],
): Promise<ExternalGraph> {
  const names = [
    ...new Set([
      ...Object.keys(denoJson.imports),
      ...moduleSpecifiers,
    ]),
  ].sort();
  const imports = names.map((name) => `import ${JSON.stringify(name)};`).join(
    "\n",
  );
  const entry = `data:application/typescript,${encodeURIComponent(imports)}`;
  const raw = await denoMetadata(root, [
    "info",
    "--json",
    "--config",
    join(root, "deno.json"),
    "--frozen=true",
    "--deny-import",
    entry,
  ]);
  const graph = decodeDenoInfoGraph(JSON.parse(raw));
  const entryModule = graph.modules.find((module) =>
    module.specifier === entry
  );
  if (entryModule === undefined) {
    throw new TypeError("deno info omitted its aggregate import-map entry");
  }
  const resolutions: Record<string, string> = {};
  for (const dependency of entryModule.dependencies) {
    const target = dependency.type?.specifier ?? dependency.code?.specifier;
    if (target !== undefined) resolutions[dependency.specifier] = target;
  }
  return { graph, resolutions };
}

/** Follow Deno's version/export redirects to one concrete graph specifier. */
function redirectedSpecifier(
  specifier: string,
  redirects: Readonly<Record<string, string>>,
): string {
  const seen = new Set<string>();
  let current = specifier;
  while (true) {
    const redirected = redirects[current];
    if (redirected === undefined) break;
    if (seen.has(current)) {
      throw new TypeError(`cyclic Deno module redirect at '${current}'`);
    }
    seen.add(current);
    current = redirected;
  }
  return current;
}

function compilerExtension(mediaType: string | undefined): ts.Extension {
  switch (mediaType) {
    case "JavaScript":
    case "Mjs":
    case "Cjs":
      return ts.Extension.Js;
    case "JSX":
      return ts.Extension.Jsx;
    case "TSX":
      return ts.Extension.Tsx;
    case "Dts":
      return ts.Extension.Dts;
    case "Json":
      return ts.Extension.Json;
    default:
      return ts.Extension.Ts;
  }
}

function syntheticGraphPath(index: number, extension: ts.Extension): string {
  const suffix = extension === ts.Extension.Js
    ? ".js"
    : extension === ts.Extension.Jsx
    ? ".jsx"
    : extension === ts.Extension.Tsx
    ? ".tsx"
    : extension === ts.Extension.Dts
    ? ".d.ts"
    : extension === ts.Extension.Json
    ? ".json"
    : ".ts";
  return `/__discern_promise_graph__/${
    String(index).padStart(5, "0")
  }${suffix}`;
}

/** Materialize cached graph modules as in-memory compiler sources. */
async function graphModules(
  graph: DenoInfoGraph,
): Promise<GraphModule[]> {
  const modules: GraphModule[] = [];
  for (const info of graph.modules) {
    if (info.local === undefined || info.mediaType === "Json") continue;
    const extension = compilerExtension(info.mediaType);
    modules.push({
      compilerPath: syntheticGraphPath(modules.length, extension),
      extension,
      info,
      source: await Deno.readTextFile(info.local),
    });
  }
  return modules;
}

/** Convert a `npm:` target into the package specifier TypeScript resolves. */
function npmModuleName(specifier: string): string | undefined {
  if (!specifier.startsWith("npm:")) return undefined;
  const target = specifier.slice("npm:".length).replace(/^\/+/, "");
  if (target.startsWith("@")) {
    const slash = target.indexOf("/");
    const versionAt = target.indexOf("@", slash + 1);
    if (slash < 0 || versionAt < 0) return undefined;
    return target.slice(0, versionAt) +
      target.slice(
        target.indexOf("/", versionAt) < 0
          ? target.length
          : target.indexOf("/", versionAt),
      );
  }
  const versionAt = target.indexOf("@");
  if (versionAt < 0) return target;
  const subpathAt = target.indexOf("/", versionAt);
  return target.slice(0, versionAt) +
    (subpathAt < 0 ? "" : target.slice(subpathAt));
}

interface NpmModuleParts {
  readonly name: string;
  readonly subpath: string;
}

/** Split one ordinary or versioned npm package specifier. */
function npmModuleParts(specifier: string): NpmModuleParts | undefined {
  const ordinary = npmModuleName(specifier) ?? specifier;
  if (ordinary.startsWith("node:")) return undefined;
  if (ordinary.startsWith("@")) {
    const first = ordinary.indexOf("/");
    if (first < 0) return undefined;
    const second = ordinary.indexOf("/", first + 1);
    return {
      name: second < 0 ? ordinary : ordinary.slice(0, second),
      subpath: second < 0 ? "" : ordinary.slice(second + 1),
    };
  }
  const slash = ordinary.indexOf("/");
  return {
    name: slash < 0 ? ordinary : ordinary.slice(0, slash),
    subpath: slash < 0 ? "" : ordinary.slice(slash + 1),
  };
}

/** A package export's preferred type-bearing path. */
function packageExportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = packageExportTarget(item);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const condition of ["types", "deno", "import", "default", "require"]) {
    const target = packageExportTarget(value[condition]);
    if (target !== undefined) return target;
  }
  return undefined;
}

/** Resolve exact and wildcard package exports for one requested subpath. */
function packageSubpathTarget(
  exportsValue: unknown,
  subpath: string,
): string | undefined {
  if (subpath === "" && !isRecord(exportsValue)) {
    return packageExportTarget(exportsValue);
  }
  if (!isRecord(exportsValue)) return undefined;
  const request = subpath === "" ? "." : `./${subpath}`;
  const exact = packageExportTarget(exportsValue[request]);
  if (exact !== undefined) return exact;
  for (const [pattern, value] of Object.entries(exportsValue)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!request.startsWith(prefix) || !request.endsWith(suffix)) continue;
    const matched = request.slice(
      prefix.length,
      request.length - suffix.length,
    );
    const target = packageExportTarget(value);
    if (target !== undefined) return target.replaceAll("*", matched);
  }
  return undefined;
}

/** Candidate declaration and source paths for one resolved package target. */
function moduleFileCandidates(base: string): string[] {
  const withoutJs = base.replace(/\.(?:c|m)?js$/u, "");
  return [
    ...new Set([
      base.replace(/\.(?:c|m)?js$/u, ".d.ts"),
      `${withoutJs}.d.ts`,
      `${withoutJs}.ts`,
      base,
      join(base, "index.d.ts"),
      join(base, "index.ts"),
    ]),
  ];
}

/** Read one cached npm package manifest for synchronous compiler resolution. */
function packageJson(path: string): Record<string, unknown> | undefined {
  const parsed: unknown = JSON.parse(Deno.readTextFileSync(path));
  return isRecord(parsed) ? parsed : undefined;
}

/** Collect every external static module name used by the production universe. */
async function externalModuleSpecifiers(root: string): Promise<string[]> {
  const syntax = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowImportingTsExtensions: true },
  });
  const names = new Set<string>();
  for (const path of await productionPromiseEffectFiles(root)) {
    const sourceFile = syntax.addSourceFileAtPath(join(root, path));
    for (const declaration of sourceFile.getImportDeclarations()) {
      const name = declaration.getModuleSpecifierValue();
      if (!name.startsWith(".") && !name.startsWith("/")) names.add(name);
    }
    for (const declaration of sourceFile.getExportDeclarations()) {
      const name = declaration.getModuleSpecifierValue();
      if (
        name !== undefined && !name.startsWith(".") && !name.startsWith("/")
      ) names.add(name);
    }
  }
  return [...names].sort();
}

/** Remove an authored Deno extension for TypeScript's filesystem resolver. */
function withoutDenoExtension(specifier: string): string {
  return specifier.replace(/\.(?:cts|mts|tsx|ts)$/u, "");
}

/** Build the compiler project against Deno's imports and runtime declarations. */
export async function createPromiseEffectsProject(
  root: string = REPO_ROOT,
): Promise<Project> {
  const denoJson = await readDenoJson(root);
  const external = await externalGraph(
    root,
    denoJson,
    await externalModuleSpecifiers(root),
  );
  const graph = external.graph;
  const modules = await graphModules(graph);
  const bySpecifier = new Map<string, GraphModule>();
  const byCompilerPath = new Map<string, GraphModule>();
  for (const module of modules) {
    bySpecifier.set(module.info.specifier, module);
    byCompilerPath.set(module.compilerPath, module);
  }

  const typeRoots = [join(root, "node_modules", "@types")];
  for (const pkg of graph.npmPackages) {
    if (pkg.name === "@types/node") typeRoots.push(dirname(pkg.localPath));
  }
  const packagesByName = new Map<string, DenoInfoNpmPackage[]>();
  for (const pkg of graph.npmPackages) {
    const entries = packagesByName.get(pkg.name) ?? [];
    entries.push(pkg);
    packagesByName.set(pkg.name, entries);
  }
  const project = new Project({
    tsConfigFilePath: join(root, "deno.json"),
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowArbitraryExtensions: true,
      allowImportingTsExtensions: true,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      typeRoots,
      types: ["node", "react", "react-dom"],
    },
    resolutionHost: (host, getCompilerOptions) => ({
      resolveModuleNames: (moduleNames, containingFile) =>
        moduleNames.map((moduleName) => {
          const containing = byCompilerPath.get(containingFile);
          const dependency = containing?.info.dependencies.find((candidate) =>
            candidate.specifier === moduleName
          );
          const mapped = dependency?.type?.specifier ??
            dependency?.code?.specifier ?? external.resolutions[moduleName] ??
            denoJson.imports[moduleName] ?? moduleName;
          const concrete = redirectedSpecifier(mapped, graph.redirects);
          const graphModule = bySpecifier.get(concrete);
          if (graphModule !== undefined) {
            return {
              extension: graphModule.extension,
              isExternalLibraryImport: true,
              resolvedFileName: graphModule.compilerPath,
            };
          }
          const nodeName = npmModuleName(concrete) ?? concrete;
          const packageParts = npmModuleParts(nodeName);
          if (packageParts !== undefined) {
            let packageEntry = packagesByName.get(packageParts.name)?.[0];
            if (packageEntry === undefined && packageParts.subpath === "") {
              packageEntry = packagesByName.get(
                `@types/${packageParts.name}`,
              )?.[0];
            }
            if (packageEntry !== undefined) {
              const manifestPath = join(packageEntry.localPath, "package.json");
              const manifest = host.fileExists(manifestPath)
                ? packageJson(manifestPath)
                : undefined;
              const exported = packageSubpathTarget(
                manifest?.exports,
                packageParts.subpath,
              );
              const manifestTypes = packageParts.subpath === ""
                ? typeof manifest?.types === "string"
                  ? manifest.types
                  : typeof manifest?.typings === "string"
                  ? manifest.typings
                  : undefined
                : undefined;
              const target = exported ?? manifestTypes ?? packageParts.subpath;
              for (
                const candidate of moduleFileCandidates(
                  join(packageEntry.localPath, target),
                )
              ) {
                if (!host.fileExists(candidate)) continue;
                return {
                  extension: compilerExtension(
                    candidate.endsWith(".d.ts") ? "Dts" : undefined,
                  ),
                  isExternalLibraryImport: true,
                  resolvedFileName: candidate,
                };
              }
            }
          }
          const direct = ts.resolveModuleName(
            nodeName,
            containingFile,
            getCompilerOptions(),
            host,
          ).resolvedModule;
          if (direct !== undefined) return direct;
          return ts.resolveModuleName(
            withoutDenoExtension(nodeName),
            containingFile,
            getCompilerOptions(),
            host,
          ).resolvedModule;
        }),
    }),
  });
  for (const module of modules) {
    project.createSourceFile(module.compilerPath, module.source, {
      overwrite: true,
    });
  }
  project.createSourceFile(
    "/__discern_deno_types__/lib.deno.d.ts",
    await denoMetadata(root, ["types"]),
    { overwrite: true },
  );
  return project;
}

/** Git-derived authored production TypeScript; tests are deliberate consumers. */
export async function productionPromiseEffectFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await structuralGuardScope({
    guard: "scripts/promise_effects.ts#production-promise-effects",
    universe: "authored-ts",
    narrow: {
      reason:
        "The promise-effect contract governs executable product and repository tooling; authored tests assert effects rather than shipping them.",
      include: (path) =>
        !path.startsWith("tests/") &&
        !path.startsWith("types/"),
    },
  }, root);
}

/** Nearest stable function or method owning one expression statement. */
function enclosingFunctionName(node: Node): string {
  const owner = node.getAncestors().find((ancestor) => {
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isConstructorDeclaration(ancestor)
    ) return true;
    const parent = ancestor.getParent();
    return (Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor)) &&
      (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent));
  });
  if (owner === undefined) return "<module>";
  if (Node.isConstructorDeclaration(owner)) return "constructor";
  if (Node.isFunctionDeclaration(owner) || Node.isMethodDeclaration(owner)) {
    return owner.getName() ?? "<module>";
  }
  const parent = owner.getParent();
  return Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)
    ? parent.getName()
    : "<anonymous>";
}

type PromiseLikeClassification = "no" | "yes" | "unresolved";

const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether a statement stores its expression result instead of discarding it. */
function structurallyConsumesExpression(expression: Node): boolean {
  return Node.isYieldExpression(expression) ||
    (Node.isBinaryExpression(expression) &&
      ASSIGNMENT_OPERATORS.has(expression.getOperatorToken().getKind()));
}

/** Ask the compiler whether any reachable constituent can be promise-like. */
function classifyPromiseLike(
  type: Type,
  seen = new Set<ts.Type>(),
): PromiseLikeClassification {
  const compilerType = type.compilerType;
  if (seen.has(compilerType)) return "no";
  seen.add(compilerType);
  if (type.isAny() || type.isUnknown()) return "unresolved";
  if (type.isNever()) return "no";
  if (type.isUnion()) {
    let unresolved = false;
    for (const member of type.getUnionTypes()) {
      const classification = classifyPromiseLike(member, seen);
      if (classification === "yes") return "yes";
      unresolved ||= classification === "unresolved";
    }
    return unresolved ? "unresolved" : "no";
  }
  if (type.isTypeParameter()) {
    const constraint = type.getConstraint();
    return constraint === undefined
      ? "unresolved"
      : classifyPromiseLike(constraint, seen);
  }
  const awaited = type.getAwaitedType();
  return awaited !== undefined && awaited.compilerType !== compilerType
    ? "yes"
    : "no";
}

/** One expression's typed finding, with `void` unable to erase the operand. */
function findingForExpression(
  path: string,
  expression: Node,
): PromiseEffectFinding | undefined {
  if (
    Node.isAwaitExpression(expression) ||
    structurallyConsumesExpression(expression)
  ) return undefined;
  const inspected = Node.isVoidExpression(expression)
    ? expression.getExpression()
    : expression;
  const type = inspected.getType();
  const classification = classifyPromiseLike(type);
  if (classification === "no") return undefined;
  const sourceFile = expression.getSourceFile();
  const location = sourceFile.getLineAndColumnAtPos(expression.getStart());
  return {
    path,
    line: location.line,
    column: location.column,
    enclosingFunction: enclosingFunctionName(expression),
    expression: expression.getText(),
    type: type.getText(inspected),
    reason: classification === "unresolved"
      ? "unresolved-type"
      : Node.isVoidExpression(expression)
      ? "naked-void"
      : "ignored-promise",
  };
}

/** Inspect selected project sources with the project's one compiler checker. */
export function promiseEffectFindingsInFiles(
  files: readonly SourceFile[],
  root: string = REPO_ROOT,
): PromiseEffectFinding[] {
  const findings: PromiseEffectFinding[] = [];
  for (const sourceFile of files) {
    const path = sourceFile.getFilePath().startsWith(`${root}/`)
      ? sourceFile.getFilePath().slice(root.length + 1)
      : sourceFile.getBaseName();
    for (
      const statement of sourceFile.getDescendantsOfKind(
        SyntaxKind.ExpressionStatement,
      )
    ) {
      const finding = findingForExpression(
        path,
        statement.getExpression(),
      );
      if (finding !== undefined) findings.push(finding);
    }
  }
  return findings;
}

/** Build and inspect the complete Git-derived production universe. */
export async function validatePromiseEffects(
  root: string = REPO_ROOT,
): Promise<PromiseEffectFinding[]> {
  const project = await createPromiseEffectsProject(root);
  const sourceFiles = (await productionPromiseEffectFiles(root)).map((path) =>
    project.addSourceFileAtPath(join(root, path))
  );
  project.resolveSourceFileDependencies();
  return promiseEffectFindingsInFiles(sourceFiles, root);
}

if (import.meta.main) {
  const findings = await validatePromiseEffects();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${finding.path}:${finding.line}:${finding.column} ${finding.reason}: ${finding.expression} (${finding.type}) inside ${finding.enclosingFunction}`,
      );
    }
    Deno.exitCode = 1;
  }
}
