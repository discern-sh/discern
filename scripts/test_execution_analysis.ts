/** Syntax evidence for reviewing growth in expensive test execution. */
import { ts } from "ts-morph";
import { dirname, join } from "@std/path/posix";
import { importSpecifiers } from "../tests/import_specifiers.ts";

/**
 * Exact production and harness boundaries; wrappers inherit their classification.
 * The engine invocation builders (`engineRunArgs`, `engineEnv`) are roots so a
 * hand-rolled spawn (`new Deno.Command(Deno.execPath(), …)` around them) counts
 * without enrolling every cheap subprocess, such as plain Git probes.
 */
const BOUNDARIES: Readonly<Record<string, readonly string[]>> = {
  "tests/engine_helpers.ts": [
    "engineEnv",
    "engineRunArgs",
    "scaffoldEngine",
    "runAgent",
    "runAgentMerged",
    "runAgentPty",
    "runAgentPtyJourney",
    "runAgentPtyWithViewport",
    "runWorktreeCore",
  ],
  "tests/helpers.ts": ["runCli"],
  "tests/mcp_client.ts": ["spawnMcp"],
  "src/engine/gate/finish.ts": ["finishResult"],
  "src/engine/gate/prepare.ts": ["prepareResult"],
  "src/engine/gate/test_job.ts": ["testResult"],
  "src/engine/status/status.ts": ["statusResult"],
  "src/engine/worktree/lifecycle.ts": ["acceptResult", "startResult"],
};

/** Pools run their seed once and each named callback once per case entry. */
const POOLS: Readonly<Record<string, readonly string[]>> = {
  "tests/engine_surface_fixture.ts": ["withPristineInstalls"],
  "tests/engine_integration_fixture.ts": ["withCountedPristineInstalls"],
};

/** Counted calls preserve the real boundary behind their run method. */
const ADAPTERS: Readonly<Record<string, readonly string[]>> = {
  "tests/counted_calls.ts": ["countedCalls"],
};

export interface TestExecutionSource {
  readonly path: string;
  readonly text: string;
}

export interface TestExecutionFinding {
  readonly path: string;
  readonly reason: string;
}

type Counts = Map<string, number>;

/** Build an isolated syntax graph; no libraries, project config, or module execution. */
function syntaxProgram(
  sources: readonly TestExecutionSource[],
  previous?: ts.Program,
): ts.Program {
  const parse = (path: string, text: string): ts.SourceFile => {
    const cached = previous?.getSourceFile(path);
    return cached?.text === text
      ? cached
      : ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  };
  const files = new Map(sources.map(({ path, text }) => [
    `/${path}`,
    parse(`/${path}`, text),
  ]));
  for (
    const [path, names] of Object.entries({
      ...BOUNDARIES,
      ...POOLS,
      ...ADAPTERS,
    })
  ) {
    if (!files.has(`/${path}`)) {
      files.set(
        `/${path}`,
        parse(
          `/${path}`,
          names.map((name) => `export function ${name}() {}`).join("\n"),
        ),
      );
    }
  }
  const host: ts.CompilerHost = {
    getSourceFile: (path) => files.get(path),
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (path) => files.has(path),
    readFile: (path) => files.get(path)?.text,
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  return ts.createProgram(
    [...files.keys()],
    {
      noLib: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
    },
    host,
    previous,
  );
}

/** Follow imports and re-exports to their declared symbol. */
function symbolAt(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

/** Visit descendants without depending on TypeScript's early-return traversal. */
function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    walk(child, visit);
  });
}

/** Bodies whose calls can make a fixture wrapper expensive. */
function declarationBody(node: ts.Declaration): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.body;
  }
  if (ts.isVariableDeclaration(node)) return node.initializer;
  return undefined;
}

/** Resolve fixture wrappers by symbol identity, including aliases and local helpers. */
function expensiveCalls(program: ts.Program): {
  call: (node: ts.Node) => boolean;
  reference: (node: ts.Node) => boolean;
} {
  const checker = program.getTypeChecker();
  const expensive = new Set<ts.Symbol>();
  const wrappers = new Map<ts.Symbol, ts.Node>();
  for (const file of program.getSourceFiles()) {
    walk(file, (node) => {
      if (
        !(ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) ||
          ts.isMethodDeclaration(node)) || node.name === undefined
      ) return;
      const symbol = symbolAt(checker, node.name);
      if (symbol === undefined) return;
      if (BOUNDARIES[file.fileName.slice(1)]?.includes(symbol.name)) {
        expensive.add(symbol);
      }
      const body = declarationBody(node);
      if (body !== undefined) wrappers.set(symbol, body);
    });
  }
  const isReference = (node: ts.Node): boolean => {
    const symbol = symbolAt(checker, node);
    return symbol !== undefined && expensive.has(symbol);
  };
  const isExpensive = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    if (isReference(node.expression)) return true;
    const callee = node.expression;
    if (
      !ts.isPropertyAccessExpression(callee) || callee.name.text !== "run" ||
      !isReference(callee.expression)
    ) return false;
    const adapter = staticValue(callee.expression, checker);
    if (!ts.isCallExpression(adapter)) return false;
    const factory = symbolAt(checker, adapter.expression);
    const path = factory?.valueDeclaration?.getSourceFile().fileName.slice(1);
    return path !== undefined && factory !== undefined &&
      ADAPTERS[path]?.includes(factory.name) === true;
  };
  // A finite monotone closure handles recursive wrappers without recursive calls.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [symbol, body] of wrappers) {
      if (expensive.has(symbol)) continue;
      let found = false;
      walk(body, (node) => {
        if (isExpensive(node) || isReference(node)) found = true;
      });
      if (found) {
        expensive.add(symbol);
        changed = true;
      }
    }
  }
  return {
    call: isExpensive,
    reference: isReference,
  };
}

/** Resolve static values by symbol, with a cycle bound for recursive aliases. */
function staticValue(
  node: ts.Node,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): ts.Node {
  if (seen.has(node)) return node;
  seen.add(node);
  if (
    ts.isAsExpression(node) || ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return staticValue(node.expression, checker, seen);
  }
  const declaration = symbolAt(checker, node)?.valueDeclaration;
  if (
    declaration !== undefined && ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined
  ) {
    return staticValue(declaration.initializer, checker, seen);
  }
  return node;
}

/** Count known pool callbacks without multiplying the seed by the case count. */
function pooledWork(
  node: ts.Node,
  checker: ts.TypeChecker,
  expensive: ReturnType<typeof expensiveCalls>,
): { seed: number; cases: number } {
  const result = { seed: 0, cases: 0 };
  if (!ts.isCallExpression(node)) return result;
  const symbol = symbolAt(checker, node.expression);
  const declaration = symbol?.valueDeclaration;
  if (
    symbol === undefined || declaration === undefined ||
    !POOLS[declaration.getSourceFile().fileName.slice(1)]?.includes(symbol.name)
  ) return result;
  const hasWork = (value: ts.Node): boolean => {
    let found = false;
    walk(staticValue(value, checker), (child) => {
      if (expensive.call(child) || expensive.reference(child)) found = true;
    });
    return found;
  };
  const seed = node.arguments[1];
  if (seed !== undefined && hasWork(seed)) result.seed = 1;
  const argument = node.arguments[2];
  if (argument === undefined) return result;
  const cases = staticValue(argument, checker);
  if (!ts.isArrayLiteralExpression(cases)) return result;
  for (const entry of cases.elements) {
    const tuple = staticValue(entry, checker);
    if (!ts.isArrayLiteralExpression(tuple)) continue;
    const callback = tuple.elements[1];
    if (callback !== undefined && hasWork(callback)) result.cases++;
  }
  return result;
}

/** Static array sizes ignore case values; dynamic selectors remain syntax evidence. */
function iterationKey(
  node: ts.Node,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): string {
  if (seen.has(node)) return "dynamic";
  seen.add(node);
  if (
    ts.isAsExpression(node) || ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return iterationKey(node.expression, checker, seen);
  }
  if (ts.isArrayLiteralExpression(node)) return `array:${node.elements.length}`;
  if (ts.isIdentifier(node)) {
    const declaration = symbolAt(checker, node)?.valueDeclaration;
    if (
      declaration !== undefined && ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined
    ) {
      return iterationKey(declaration.initializer, checker, seen);
    }
  }
  return syntaxKey(node.getText());
}

/** Ignore comments and formatting without evaluating runtime values. */
function syntaxKey(source: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  const tokens: string[] = [];
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    tokens.push(scanner.getTokenText());
  }
  return tokens.join(" ");
}

/** Describe surrounding loops and array callbacks independently of assertions. */
function repetition(node: ts.Node, checker: ts.TypeChecker): string {
  const contexts: string[] = [];
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      contexts.push(iterationKey(parent.expression, checker));
    } else if (ts.isForStatement(parent)) {
      contexts.push(
        parent.condition === undefined
          ? "unbounded"
          : iterationKey(parent.condition, checker),
      );
    } else if (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) {
      contexts.push(iterationKey(parent.expression, checker));
    } else if (
      ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      ["map", "forEach", "flatMap"].includes(parent.expression.name.text)
    ) {
      contexts.push(iterationKey(parent.expression.expression, checker));
    }
  }
  return contexts.join(" / ");
}

/** Counts are syntax indicators, not estimates of subprocess totals or elapsed time. */
function indicators(
  sources: readonly TestExecutionSource[],
  changedPaths: ReadonlySet<string>,
  previous?: ts.Program,
): { counts: Map<string, Counts>; program: ts.Program } {
  const program = syntaxProgram(sources, previous);
  const checker = program.getTypeChecker();
  const expensive = expensiveCalls(program);
  const result = new Map<string, Counts>();
  for (const { path } of sources) {
    const file = program.getSourceFile(`/${path}`);
    if (file === undefined) throw new Error(`missing syntax for ${path}`);
    const diagnostics = program.getSyntacticDiagnostics(file);
    if (diagnostics.length > 0) throw new Error(`cannot parse ${path}`);
    if (!changedPaths.has(path)) continue;
    const counts: Counts = new Map();
    walk(file, (node) => {
      const pool = pooledWork(node, checker, expensive);
      const calls = Number(expensive.call(node)) + pool.seed;
      if (calls === 0 && pool.cases === 0) return;
      const key = repetition(node, checker);
      if (calls > 0) counts.set(key, (counts.get(key) ?? 0) + calls);
      if (pool.cases > 0) {
        const pooled = `pooled callbacks / ${key}`;
        counts.set(pooled, (counts.get(pooled) ?? 0) + pool.cases);
      }
    });
    result.set(path, counts);
  }
  return { counts: result, program };
}

/** Compare static array cardinalities within otherwise equivalent loop contexts. */
function repetitionIndicators(counts: Counts): Counts {
  const result: Counts = new Map();
  for (const [key, count] of counts) {
    if (key === "") continue;
    let weight = count;
    const shape = key.replace(/array:(\d+)/g, (_match, size: string) => {
      weight *= Number(size);
      return "array";
    });
    result.set(shape, (result.get(shape) ?? 0) + weight);
  }
  return result;
}

interface ExecutionGraph {
  readonly sources: readonly TestExecutionSource[];
  readonly callers: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Fixture specimens stay inert until a test source imports them at runtime. */
function executionGraph(
  sources: readonly TestExecutionSource[],
): ExecutionGraph {
  const files = new Map(sources.map((source) => [source.path, source]));
  const active = new Set<string>();
  const callers = new Map<string, Set<string>>();
  const pending = sources.filter(({ path }) =>
    !path.startsWith("tests/fixtures/")
  ).map(({ path }) => path);
  for (const path of pending) {
    if (active.has(path)) continue;
    active.add(path);
    const source = files.get(path);
    if (source === undefined) continue;
    for (
      const specifier of importSpecifiers(source.text, { runtimeOnly: true })
        .specifiers
    ) {
      if (!specifier.startsWith(".")) continue;
      const dependency = join(dirname(path), specifier);
      if (!files.has(dependency)) continue;
      const parents = callers.get(dependency) ?? new Set<string>();
      parents.add(path);
      callers.set(dependency, parents);
      pending.push(dependency);
    }
  }
  return { sources: sources.filter(({ path }) => active.has(path)), callers };
}

/** Follow either snapshot so dependency-only edits select their changed cause. */
function affectedCallers(
  path: string,
  graphs: readonly ExecutionGraph[],
): Set<string> {
  const affected = new Set([path]);
  for (const member of affected) {
    for (const graph of graphs) {
      for (const caller of graph.callers.get(member) ?? []) {
        affected.add(caller);
      }
    }
  }
  return affected;
}

/** Compare call-site indicators in affected sources, then name changed subjects. */
export function testExecutionGrowth(
  before: readonly TestExecutionSource[],
  after: readonly TestExecutionSource[],
  changedPaths: ReadonlySet<string>,
): TestExecutionFinding[] {
  const graphs = [executionGraph(before), executionGraph(after)] as const;
  const oldText = new Map(before.map(({ path, text }) => [path, text]));
  const newText = new Map(after.map(({ path, text }) => [path, text]));
  const subjects = [...changedPaths].filter((path) => {
    const old = oldText.get(path) ?? "";
    const next = newText.get(path) ?? "";
    return old === next || syntaxKey(old) !== syntaxKey(next);
  });
  const effects = new Map(
    subjects.map((path) => [path, affectedCallers(path, graphs)]),
  );
  const compared = new Set(
    [...effects.values()].flatMap((paths) => [...paths]),
  );
  const previous = indicators(graphs[0].sources, compared);
  const current = indicators(graphs[1].sources, compared, previous.program);
  const growth = new Map<string, string>();
  for (const path of compared) {
    const old = previous.counts.get(path) ?? new Map<string, number>();
    const next = current.counts.get(path);
    if (next === undefined) continue;
    const total = (counts: Counts): number =>
      [...counts.values()].reduce((sum, value) => sum + value, 0);
    const grew = total(next) > total(old);
    const oldRepetition = repetitionIndicators(old);
    const repeated = [...repetitionIndicators(next)].some(([key, count]) =>
      count > (oldRepetition.get(key) ?? 0)
    );
    if (grew || repeated) {
      growth.set(
        path,
        grew
          ? `expensive call indicators ${total(old)} -> ${total(next)}`
          : "changed repetition around expensive calls",
      );
    }
  }
  const findings: TestExecutionFinding[] = [];
  for (const path of [...changedPaths].sort()) {
    const affected = [...(effects.get(path) ?? [])].find((caller) =>
      growth.has(caller)
    );
    if (affected !== undefined) {
      findings.push({
        path,
        reason: `${affected}: ${growth.get(affected)}`,
      });
    }
  }
  return findings;
}
