/** Syntax evidence for reviewing growth in expensive test execution. */
import { ts } from "ts-morph";

/** Exact production and harness boundaries; wrappers inherit their classification. */
const BOUNDARIES: Readonly<Record<string, readonly string[]>> = {
  "tests/engine_helpers.ts": [
    "scaffoldEngine",
    "runAgent",
    "runAgentMerged",
    "runAgentPty",
    "runAgentPtyJourney",
    "runAgentPtyWithViewport",
    "runWorktreeCore",
  ],
  "tests/helpers.ts": ["runCli"],
  "tests/engine_mcp_test.ts": ["spawnMcp"],
  "src/engine/gate/finish.ts": ["finishResult"],
  "src/engine/worktree/lifecycle.ts": ["acceptResult", "startResult"],
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
function syntaxProgram(sources: readonly TestExecutionSource[]): ts.Program {
  const files = new Map(sources.map(({ path, text }) => [
    `/${path}`,
    ts.createSourceFile(`/${path}`, text, ts.ScriptTarget.Latest, true),
  ]));
  for (const [path, names] of Object.entries(BOUNDARIES)) {
    if (!files.has(`/${path}`)) {
      files.set(
        `/${path}`,
        ts.createSourceFile(
          `/${path}`,
          names.map((name) => `export function ${name}() {}`).join("\n"),
          ts.ScriptTarget.Latest,
          true,
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
  return ts.createProgram([...files.keys()], {
    noLib: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
  }, host);
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
function expensiveCalls(program: ts.Program): (node: ts.Node) => boolean {
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
  const isExpensive = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    const symbol = symbolAt(checker, node.expression);
    return symbol !== undefined && expensive.has(symbol);
  };
  // A finite monotone closure handles recursive wrappers without recursive calls.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [symbol, body] of wrappers) {
      if (expensive.has(symbol)) continue;
      let found = false;
      walk(body, (node) => {
        if (isExpensive(node)) found = true;
      });
      if (found) {
        expensive.add(symbol);
        changed = true;
      }
    }
  }
  return isExpensive;
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
  // Scanner tokens exclude whitespace and comments; runtime values are never evaluated.
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    node.getText(),
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
): Map<string, Counts> {
  const program = syntaxProgram(sources);
  const checker = program.getTypeChecker();
  const expensive = expensiveCalls(program);
  const result = new Map<string, Counts>();
  for (const { path } of sources) {
    const file = program.getSourceFile(`/${path}`);
    if (file === undefined) throw new Error(`missing syntax for ${path}`);
    const diagnostics = program.getSyntacticDiagnostics(file);
    if (diagnostics.length > 0) throw new Error(`cannot parse ${path}`);
    const counts: Counts = new Map();
    walk(file, (node) => {
      if (!expensive(node)) return;
      const key = repetition(node, checker);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    result.set(path, counts);
  }
  return result;
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

/** Select changed files whose expensive call sites or repetition grow. */
export function testExecutionGrowth(
  before: readonly TestExecutionSource[],
  after: readonly TestExecutionSource[],
  changedPaths: ReadonlySet<string>,
): TestExecutionFinding[] {
  const previous = indicators(before);
  const current = indicators(after);
  const findings: TestExecutionFinding[] = [];
  for (const path of [...changedPaths].sort()) {
    const old = previous.get(path) ?? new Map<string, number>();
    const next = current.get(path);
    if (next === undefined) continue;
    const total = (counts: Counts): number =>
      [...counts.values()].reduce((sum, value) => sum + value, 0);
    const grew = total(next) > total(old);
    const oldRepetition = repetitionIndicators(old);
    const repeated = [...repetitionIndicators(next)].some(([key, count]) =>
      count > (oldRepetition.get(key) ?? 0)
    );
    if (grew || repeated) {
      findings.push({
        path,
        reason: grew
          ? `expensive call sites ${total(old)} -> ${total(next)}`
          : "changed repetition around expensive calls",
      });
    }
  }
  return findings;
}
