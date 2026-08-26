/**
 * Deterministic TypeScript/JavaScript clone analysis for the duplication census.
 *
 * Exact token seeds nominate candidates. The collapse stage extends those
 * seeds, joins nearby edits, groups equivalent syntax, and admits findings in
 * descending size only while their source ranges remain globally disjoint.
 */

import { ts } from "ts-morph";

/** One authored source supplied to the clone detector. */
export interface DuplicationSource {
  /** Repository-relative path, used only for evidence and deterministic order. */
  readonly path: string;
  /** Source bytes decoded as text. */
  readonly text: string;
  /** Set only when declared generated-artifact ownership owns this path. */
  readonly generated?: true;
}

/** One exact source occurrence of a normalized clone. */
export interface DuplicateCloneOccurrence {
  readonly path: string;
  /** One-based inclusive start line and column. */
  readonly startLine: number;
  readonly startColumn: number;
  /** One-based inclusive end line and column. */
  readonly endLine: number;
  readonly endColumn: number;
}

/**
 * One maximal clone shape with globally non-overlapping occurrences.
 *
 * `normalizedLineCount` counts statement/block boundaries in the shared
 * semantic-token skeleton. It is deliberately independent of physical line
 * wrapping. `duplicateLineContribution` charges every occurrence after the
 * first, so pasting a third copy grows the scalar even though it remains one
 * clone group.
 */
export interface DuplicateCloneGroup {
  readonly fingerprint: string;
  readonly normalizedTokenCount: number;
  readonly normalizedLineCount: number;
  readonly duplicateLineContribution: number;
  readonly occurrences: readonly DuplicateCloneOccurrence[];
}

/** Complete deterministic result of one authored-source census. */
export interface DuplicationCensus {
  readonly groups: readonly DuplicateCloneGroup[];
  readonly duplicateCloneGroups: number;
  readonly duplicatedLines: number;
}

interface ExcludedRange {
  readonly start: number;
  readonly end: number;
}

interface SemanticToken {
  readonly key: string;
  readonly seedKey: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

interface ParsedSourceToken {
  readonly kind: ts.SyntaxKind;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface TokenSegment {
  readonly index: number;
  readonly path: string;
  readonly regionKind: "routine" | "top-level";
  readonly functionDepth: number;
  readonly tokens: readonly SemanticToken[];
}

interface SourceRegion {
  readonly start: number;
  readonly end: number;
  readonly kind: "routine" | "top-level";
  readonly functionDepth: number;
}

interface SeedPosition {
  readonly segment: number;
  readonly offset: number;
}

interface ExactMatch {
  readonly segmentA: number;
  readonly segmentB: number;
  readonly startA: number;
  readonly endA: number;
  readonly startB: number;
  readonly endB: number;
}

interface MatchChain {
  readonly segmentA: number;
  readonly segmentB: number;
  readonly blocks: ExactMatch[];
}

interface OccurrenceSpan {
  readonly segment: number;
  readonly start: number;
  readonly end: number;
}

interface CloneCandidateGroup {
  readonly skeleton: readonly string[];
  readonly normalizedTokenCount: number;
  readonly normalizedLineCount: number;
  readonly occurrences: OccurrenceSpan[];
}

interface RegionSimilarityProfile {
  readonly counts: ReadonlyMap<string, number>;
  readonly informativeSize: number;
  readonly operationShingles: ReadonlySet<string>;
  readonly roleShingles: ReadonlySet<string>;
  readonly normalizedLines: number;
}

interface SelectedGroup {
  readonly candidate: CloneCandidateGroup;
  readonly occurrences: readonly OccurrenceSpan[];
}

const SEED_TOKEN_COUNT = 10;
const MAX_SEED_OCCURRENCES = 48;
const MAX_EDIT_GAP_TOKENS = 40;
const MAX_EDIT_SKEW_TOKENS = 20;
const MIN_SHARED_TOKENS = 90;
const MIN_EXACT_NORMALIZED_LINES = 12;
const MIN_REGION_NORMALIZED_LINES = 9;
const MIN_SHARED_RATIO = 0.48;
const MIN_REGION_INFORMATIVE_TOKENS = 20;
const MIN_REGION_DICE = 0.72;
const EDIT_MARKER = "<edit>";

const SEMANTIC_GLOBALS = new Set([
  "Array",
  "Boolean",
  "Date",
  "Deno",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "RegExp",
  "Set",
  "String",
  "TextDecoder",
  "TextEncoder",
  "URL",
  "URLSearchParams",
  "console",
  "crypto",
  "setInterval",
  "setTimeout",
]);

const STRUCTURAL_ONLY_TOKENS = new Set([
  "id",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ";",
  ":",
  ".",
  "?.",
  "<",
  ">",
]);

const BEHAVIORAL_SIGNAL_TOKENS = new Set([
  "await",
  "break",
  "catch",
  "continue",
  "do",
  "for",
  "if",
  "new",
  "return",
  "switch",
  "throw",
  "try",
  "while",
  "yield",
]);

/** Compare text by UTF-16 code units without consulting the host locale. */
function stableTextOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Choose the parser mode that preserves JSX token boundaries when present. */
function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Remove syntax wrappers while remembering an explicit data-table contract. */
function unwrapDataInitializer(
  expression: ts.Expression,
): { expression: ts.Expression; declaredTable: boolean } {
  let current = expression;
  let declaredTable = false;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      if (current.type.getText() === "const") declaredTable = true;
      current = current.expression;
      continue;
    }
    if (ts.isSatisfiesExpression(current)) {
      declaredTable = true;
      current = current.expression;
      continue;
    }
    return { expression: current, declaredTable };
  }
}

/** Whether an initializer is a declared, multi-entry registry/data-table idiom. */
function isDeclaredDataTable(expression: ts.Expression): boolean {
  const unwrapped = unwrapDataInitializer(expression);
  if (!unwrapped.declaredTable) return false;
  if (ts.isArrayLiteralExpression(unwrapped.expression)) {
    return unwrapped.expression.elements.length >= 4;
  }
  if (ts.isObjectLiteralExpression(unwrapped.expression)) {
    return unwrapped.expression.properties.length >= 4;
  }
  return false;
}

/**
 * Recognize only top-level const tables that opt into `as const`/`satisfies`.
 * This syntax, rather than a path list, is the canonical registry exclusion.
 */
function isCanonicalRegistryStatement(
  statement: ts.Statement,
): statement is ts.VariableStatement {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
    return false;
  }
  const declarations = [...statement.declarationList.declarations];
  return declarations.length > 0 &&
    declarations.every((declaration) =>
      declaration.initializer !== undefined &&
      isDeclaredDataTable(declaration.initializer)
    );
}

/** Merge overlapping syntax exclusions into stable scanner boundaries. */
function mergeExcludedRanges(
  ranges: readonly ExcludedRange[],
): ExcludedRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ExcludedRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || range.start > previous.end) {
      merged.push(range);
      continue;
    }
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, range.end),
    };
  }
  return merged;
}

/** Collect syntax-owned noise ranges without maintaining path exemptions. */
function excludedSyntaxRanges(sourceFile: ts.SourceFile): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  const exclude = (node: ts.Node): void => {
    ranges.push({ start: node.getFullStart(), end: node.end });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)
    ) {
      exclude(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of sourceFile.statements) {
    if (isCanonicalRegistryStatement(statement)) {
      exclude(statement);
    } else {
      visit(statement);
    }
  }
  return mergeExcludedRanges(ranges);
}

/** Map literals and identifiers onto the stable semantic-token vocabulary. */
function normalizedTokenKey(
  kind: ts.SyntaxKind,
  text: string,
  previousKind: ts.SyntaxKind | undefined,
  aliases: Map<string, string>,
): string {
  if (kind === ts.SyntaxKind.Identifier) {
    if (
      previousKind === ts.SyntaxKind.DotToken ||
      previousKind === ts.SyntaxKind.QuestionDotToken
    ) {
      return `prop:${text}`;
    }
    if (SEMANTIC_GLOBALS.has(text)) return `global:${text}`;
    const existing = aliases.get(text);
    if (existing !== undefined) return existing;
    const alias = `id:${aliases.size}`;
    aliases.set(text, alias);
    return alias;
  }
  if (kind === ts.SyntaxKind.PrivateIdentifier) return "private-id";
  if (
    kind === ts.SyntaxKind.NumericLiteral ||
    kind === ts.SyntaxKind.BigIntLiteral
  ) {
    return "number";
  }
  if (
    kind === ts.SyntaxKind.StringLiteral ||
    kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === ts.SyntaxKind.TemplateHead ||
    kind === ts.SyntaxKind.TemplateMiddle ||
    kind === ts.SyntaxKind.TemplateTail ||
    kind === ts.SyntaxKind.JsxText
  ) {
    return "string";
  }
  if (kind === ts.SyntaxKind.RegularExpressionLiteral) return "regexp";
  return ts.tokenToString(kind) ?? `token:${kind}`;
}

/** Collapse alpha-normalized identifier roles only for candidate generation. */
function genericSeedKey(key: string): string {
  return key.startsWith("id:") ? "id" : key;
}

/** Whether a token is only structural scaffolding for similarity purposes. */
function isStructuralOnlyToken(key: string): boolean {
  return key.startsWith("id:") || STRUCTURAL_ONLY_TOKENS.has(key);
}

/** Whether a shared token identifies control flow, an effect, or a named API. */
function isBehavioralSignalToken(key: string): boolean {
  return BEHAVIORAL_SIGNAL_TOKENS.has(key) ||
    key.startsWith("global:") || key.startsWith("prop:");
}

/** Whether a node owns an executable function body and can bound one routine. */
function isFunctionRegionNode(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
}

/** Derive routine and top-level executable regions from syntax, never paths. */
function sourceRegions(sourceFile: ts.SourceFile): SourceRegion[] {
  const regions: Array<{
    start: number;
    end: number;
    kind: "routine" | "top-level";
    functionDepth: number;
  }> = [];
  const visit = (
    node: ts.Node,
    parentFunction: number | undefined,
  ): void => {
    let activeParent = parentFunction;
    if (isFunctionRegionNode(node) && node.getChildren(sourceFile).length > 0) {
      const start = node.getStart(sourceFile, false);
      const parent = parentFunction === undefined
        ? undefined
        : regions[parentFunction];
      const region = {
        start,
        end: node.end,
        kind: "routine" as const,
        functionDepth: (parent?.functionDepth ?? -1) + 1,
      };
      const index = regions.length;
      regions.push(region);
      activeParent = index;
    }
    ts.forEachChild(node, (child) => visit(child, activeParent));
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      (ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined) ||
      isCanonicalRegistryStatement(statement)
    ) {
      continue;
    }
    const before = regions.length;
    visit(statement, undefined);
    if (regions.length === before) {
      regions.push({
        start: statement.getStart(sourceFile, false),
        end: statement.end,
        kind: "top-level",
        functionDepth: 0,
      });
    }
  }
  return regions
    .filter((region) => region.end > region.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Read parser-owned leaf tokens so template and JSX boundaries stay correct. */
function parsedSourceTokens(sourceFile: ts.SourceFile): ParsedSourceToken[] {
  const tokens: ParsedSourceToken[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      const start = node.getStart(sourceFile, false);
      if (
        node.kind <= ts.SyntaxKind.LastToken &&
        node.end > start
      ) {
        tokens.push({
          kind: node.kind,
          start,
          end: node.end,
          text: sourceFile.text.slice(start, node.end),
        });
      }
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sourceFile);
  return tokens.sort((a, b) =>
    a.start - b.start || a.end - b.end || a.kind - b.kind
  );
}

/** Tokenize one syntax-bounded region while splitting at owned noise. */
function tokenizeRegion(
  source: DuplicationSource,
  sourceFile: ts.SourceFile,
  region: SourceRegion,
  excludedSyntax: readonly ExcludedRange[],
  parsedTokens: readonly ParsedSourceToken[],
  firstSegmentIndex: number,
): TokenSegment[] {
  const excluded = mergeExcludedRanges([
    ...excludedSyntax.filter((range) =>
      range.start < region.end && range.end > region.start
    ),
  ]);
  const segments: TokenSegment[] = [];
  let tokens: SemanticToken[] = [];
  let rangeIndex = 0;
  let pendingBoundary = false;
  let previousKind: ts.SyntaxKind | undefined;
  let aliases = new Map<string, string>();

  const flush = (): void => {
    if (tokens.length > 0) {
      segments.push({
        index: firstSegmentIndex + segments.length,
        path: source.path,
        regionKind: region.kind,
        functionDepth: region.functionDepth,
        tokens,
      });
      tokens = [];
    }
    previousKind = undefined;
    aliases = new Map<string, string>();
  };

  for (const parsed of parsedTokens) {
    if (parsed.end <= region.start) continue;
    if (parsed.start >= region.end) break;
    const { kind, start, end } = parsed;
    while (
      excluded[rangeIndex] !== undefined &&
      start >= (excluded[rangeIndex]?.end ?? Number.POSITIVE_INFINITY)
    ) {
      rangeIndex++;
      pendingBoundary = true;
    }
    const range = excluded[rangeIndex];
    if (range !== undefined && start < range.end && end > range.start) {
      pendingBoundary = true;
      continue;
    }
    if (pendingBoundary) {
      flush();
      pendingBoundary = false;
    }
    const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
    const lastCharacter = Math.max(start, end - 1);
    const endPosition = sourceFile.getLineAndCharacterOfPosition(lastCharacter);
    const key = normalizedTokenKey(
      kind,
      parsed.text,
      previousKind,
      aliases,
    );
    tokens.push({
      key,
      seedKey: genericSeedKey(key),
      start,
      end,
      line: startPosition.line + 1,
      column: startPosition.character + 1,
      endLine: endPosition.line + 1,
      endColumn: endPosition.character + 1,
    });
    previousKind = kind;
  }
  flush();
  return segments;
}

/** Turn one source into syntax-bounded semantic-token segments. */
function tokenizeSource(
  source: DuplicationSource,
  firstSegmentIndex: number,
): TokenSegment[] {
  const sourceFile = ts.createSourceFile(
    source.path,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(source.path),
  );
  const syntaxExclusions = excludedSyntaxRanges(sourceFile);
  const parsedTokens = parsedSourceTokens(sourceFile);
  const segments: TokenSegment[] = [];
  for (const region of sourceRegions(sourceFile)) {
    segments.push(...tokenizeRegion(
      source,
      sourceFile,
      region,
      syntaxExclusions,
      parsedTokens,
      firstSegmentIndex + segments.length,
    ));
  }
  return segments;
}

/** Build all semantic segments in path order so traversal order cannot leak. */
function tokenizeSources(
  sources: readonly DuplicationSource[],
): TokenSegment[] {
  const sorted = [...sources].sort((a, b) => stableTextOrder(a.path, b.path));
  const segments: TokenSegment[] = [];
  for (const source of sorted) {
    const next = tokenizeSource(source, segments.length);
    segments.push(...next);
  }
  return segments;
}

/** A seed needs language operations, not only punctuation and placeholders. */
function seedCarriesSignal(tokens: readonly SemanticToken[]): boolean {
  const signals = tokens
    .map((token) => token.seedKey)
    .filter((key) => !isStructuralOnlyToken(key));
  return signals.length >= 4 && new Set(signals).size >= 3;
}

/** Generate exact normalized-token windows as clone candidate anchors. */
function seedBuckets(
  segments: readonly TokenSegment[],
): Map<string, SeedPosition[]> {
  const buckets = new Map<string, SeedPosition[]>();
  for (const segment of segments) {
    for (
      let offset = 0;
      offset + SEED_TOKEN_COUNT <= segment.tokens.length;
      offset++
    ) {
      const window = segment.tokens.slice(offset, offset + SEED_TOKEN_COUNT);
      if (!seedCarriesSignal(window)) continue;
      const key = window.map((token) => token.seedKey).join("\u001f");
      const positions = buckets.get(key) ?? [];
      positions.push({ segment: segment.index, offset });
      buckets.set(key, positions);
    }
  }
  return buckets;
}

/** Whether two positions describe disjoint seed occurrences. */
function disjointSeed(a: SeedPosition, b: SeedPosition): boolean {
  return a.segment !== b.segment ||
    a.offset + SEED_TOKEN_COUNT <= b.offset ||
    b.offset + SEED_TOKEN_COUNT <= a.offset;
}

/** Extend one seed pair to its maximal exact normalized-token match. */
function extendExactMatch(
  segments: readonly TokenSegment[],
  a: SeedPosition,
  b: SeedPosition,
): ExactMatch {
  const segmentA = segments[a.segment];
  const segmentB = segments[b.segment];
  if (segmentA === undefined || segmentB === undefined) {
    throw new Error("clone seed references an absent token segment");
  }
  let startA = a.offset;
  let startB = b.offset;
  let endA = a.offset + SEED_TOKEN_COUNT;
  let endB = b.offset + SEED_TOKEN_COUNT;
  while (startA > 0 && startB > 0) {
    const previousA = segmentA.tokens[startA - 1];
    const previousB = segmentB.tokens[startB - 1];
    if (previousA?.key !== previousB?.key) break;
    if (a.segment === b.segment && endA - (startA - 1) > startB - 1 - startA) {
      break;
    }
    startA--;
    startB--;
  }
  while (
    endA < segmentA.tokens.length &&
    endB < segmentB.tokens.length
  ) {
    if (segmentA.tokens[endA]?.key !== segmentB.tokens[endB]?.key) break;
    if (a.segment === b.segment && endA + 1 > startB) break;
    endA++;
    endB++;
  }
  return {
    segmentA: a.segment,
    segmentB: b.segment,
    startA,
    endA,
    startB,
    endB,
  };
}

/** Enumerate unique exact anchors while discarding ubiquitous boilerplate. */
function exactMatches(segments: readonly TokenSegment[]): ExactMatch[] {
  const unique = new Map<string, ExactMatch>();
  for (const positions of seedBuckets(segments).values()) {
    if (
      positions.length < 2 ||
      positions.length > MAX_SEED_OCCURRENCES
    ) {
      continue;
    }
    positions.sort((a, b) => a.segment - b.segment || a.offset - b.offset);
    for (let left = 0; left < positions.length; left++) {
      const a = positions[left];
      if (a === undefined) continue;
      for (let right = left + 1; right < positions.length; right++) {
        const b = positions[right];
        if (b === undefined || !disjointSeed(a, b)) continue;
        const match = extendExactMatch(segments, a, b);
        const key = [
          match.segmentA,
          match.segmentB,
          match.startA,
          match.endA,
          match.startB,
          match.endB,
        ].join(":");
        unique.set(key, match);
      }
    }
  }
  return [...unique.values()];
}

/** Measure the unmatched distance between two exact blocks on one side. */
function blockGap(previousEnd: number, nextStart: number): number {
  return Math.max(0, nextStart - previousEnd);
}

/** Whether a later exact block is a plausible continuation across a small edit. */
function chainAccepts(chain: MatchChain, next: ExactMatch): boolean {
  const previous = chain.blocks[chain.blocks.length - 1];
  if (previous === undefined) return true;
  if (
    next.startA < previous.startA ||
    next.startB < previous.startB
  ) {
    return false;
  }
  const gapA = blockGap(previous.endA, next.startA);
  const gapB = blockGap(previous.endB, next.startB);
  return gapA <= MAX_EDIT_GAP_TOKENS &&
    gapB <= MAX_EDIT_GAP_TOKENS &&
    Math.abs(gapA - gapB) <= MAX_EDIT_SKEW_TOKENS;
}

/** Collapse exact anchors into monotonic maximal pairwise match chains. */
function collapseMatches(matches: readonly ExactMatch[]): MatchChain[] {
  const byPair = new Map<string, ExactMatch[]>();
  for (const match of matches) {
    const key = `${match.segmentA}:${match.segmentB}`;
    const pair = byPair.get(key) ?? [];
    pair.push(match);
    byPair.set(key, pair);
  }
  const collapsed: MatchChain[] = [];
  for (const pairMatches of byPair.values()) {
    pairMatches.sort((a, b) =>
      a.startA - b.startA ||
      a.startB - b.startB ||
      b.endA - a.endA ||
      b.endB - a.endB
    );
    const chains: MatchChain[] = [];
    for (const match of pairMatches) {
      const containing = chains.find((chain) => {
        const first = chain.blocks[0];
        const last = chain.blocks[chain.blocks.length - 1];
        return first !== undefined && last !== undefined &&
          match.startA >= first.startA && match.endA <= last.endA &&
          match.startB >= first.startB && match.endB <= last.endB;
      });
      if (containing !== undefined) continue;
      const compatible = [...chains].reverse().find((chain) =>
        chainAccepts(chain, match)
      );
      if (compatible === undefined) {
        chains.push({
          segmentA: match.segmentA,
          segmentB: match.segmentB,
          blocks: [match],
        });
      } else {
        compatible.blocks.push(match);
      }
    }
    collapsed.push(...chains);
  }
  return collapsed;
}

/** Remove pairwise blocks wholly contained by a larger aligned exact block. */
function maximalBlocks(blocks: readonly ExactMatch[]): ExactMatch[] {
  const sorted = [...blocks].sort((a, b) =>
    a.startA - b.startA ||
    a.startB - b.startB ||
    b.endA - a.endA ||
    b.endB - a.endB
  );
  return sorted.filter((block, index) =>
    !sorted.some((other, otherIndex) =>
      otherIndex !== index &&
      other.startA <= block.startA && other.endA >= block.endA &&
      other.startB <= block.startB && other.endB >= block.endB &&
      (other.startA < block.startA || other.endA > block.endA ||
        other.startB < block.startB || other.endB > block.endB)
    )
  );
}

/** Count shared tokens without double-counting overlapping exact blocks. */
function matchedTokenCount(blocks: readonly ExactMatch[]): number {
  let total = 0;
  let coveredUntil = -1;
  for (const block of blocks) {
    const start = Math.max(block.startA, coveredUntil);
    if (block.endA > start) total += block.endA - start;
    coveredUntil = Math.max(coveredUntil, block.endA);
  }
  return total;
}

/** Build the path-independent shared syntax skeleton for a pairwise chain. */
function chainSkeleton(
  chain: MatchChain,
  segments: readonly TokenSegment[],
): readonly string[] {
  const segment = segments[chain.segmentA];
  if (segment === undefined) {
    throw new Error("clone chain references an absent token segment");
  }
  const blocks = maximalBlocks(chain.blocks);
  const skeleton: string[] = [];
  let coveredUntil = -1;
  for (const block of blocks) {
    const start = Math.max(block.startA, coveredUntil);
    if (skeleton.length > 0 && start > coveredUntil) {
      skeleton.push(EDIT_MARKER);
    }
    for (let offset = start; offset < block.endA; offset++) {
      const token = segment.tokens[offset];
      if (token !== undefined) skeleton.push(token.key);
    }
    coveredUntil = Math.max(coveredUntil, block.endA);
  }
  return skeleton;
}

/** Count formatting-independent statement and block boundaries. */
function normalizedLineCount(skeleton: readonly string[]): number {
  const boundaries =
    skeleton.filter((token) => token === ";" || token === "{" || token === "}")
      .length;
  return Math.max(1, boundaries);
}

/** Convert one qualified pairwise chain into a group candidate. */
function candidateFromChain(
  chain: MatchChain,
  segments: readonly TokenSegment[],
): CloneCandidateGroup | undefined {
  const blocks = maximalBlocks(chain.blocks);
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const sharedTokens = matchedTokenCount(blocks);
  const spanA = last.endA - first.startA;
  const spanB = last.endB - first.startB;
  const sharedRatio = sharedTokens / Math.max(spanA, spanB);
  const skeleton = chainSkeleton(chain, segments);
  const lines = normalizedLineCount(skeleton);
  if (
    sharedTokens < MIN_SHARED_TOKENS ||
    lines < MIN_EXACT_NORMALIZED_LINES ||
    sharedRatio < MIN_SHARED_RATIO
  ) {
    return undefined;
  }
  return {
    skeleton,
    normalizedTokenCount: sharedTokens,
    normalizedLineCount: lines,
    occurrences: [
      { segment: chain.segmentA, start: first.startA, end: last.endA },
      { segment: chain.segmentB, start: first.startB, end: last.endB },
    ],
  };
}

/** Count a segment's operation-bearing tokens for Type-3 routine similarity. */
function informativeTokenCounts(
  segment: TokenSegment,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of segment.tokens) {
    if (isStructuralOnlyToken(token.key)) continue;
    counts.set(token.key, (counts.get(token.key) ?? 0) + 1);
  }
  return counts;
}

/** Preserve the operation-token order used to reject bag-of-words lookalikes. */
function informativeTokenSequence(segment: TokenSegment): string[] {
  return segment.tokens
    .map((token) => token.key)
    .filter((key) => !isStructuralOnlyToken(key));
}

/** Keep alpha-normalized identifier roles while dropping only punctuation. */
function roleTokenSequence(segment: TokenSegment): string[] {
  return segment.tokens
    .map((token) => token.key)
    .filter((key) => !STRUCTURAL_ONLY_TOKENS.has(key));
}

/** Build syntax-order shingles for one routine's operation sequence. */
function operationShingles(
  sequence: readonly string[],
  width = 3,
): Set<string> {
  const shingles = new Set<string>();
  for (let index = 0; index + width <= sequence.length; index++) {
    shingles.add(sequence.slice(index, index + width).join("\u001f"));
  }
  return shingles;
}

/** Count the exact set intersection without depending on iteration order. */
function setIntersectionSize(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count++;
  }
  return count;
}

/** Compute each routine's reusable similarity evidence once per census. */
function regionSimilarityProfile(
  segment: TokenSegment,
): RegionSimilarityProfile {
  const counts = informativeTokenCounts(segment);
  return {
    counts,
    informativeSize: [...counts.values()].reduce(
      (sum, count) => sum + count,
      0,
    ),
    operationShingles: operationShingles(informativeTokenSequence(segment)),
    roleShingles: operationShingles(roleTokenSequence(segment)),
    normalizedLines: normalizedLineCount(
      segment.tokens.map((token) => token.key),
    ),
  };
}

/** Return the sorted multiset intersection of two operation vocabularies. */
function commonInformativeTokens(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): string[] {
  const common: string[] = [];
  for (const key of [...a.keys()].sort()) {
    const count = Math.min(a.get(key) ?? 0, b.get(key) ?? 0);
    for (let index = 0; index < count; index++) common.push(key);
  }
  return common;
}

/**
 * Promote a seed-nominated pair to its routine boundaries when their operation
 * multisets remain substantially the same despite a small local rewrite.
 */
function candidateFromSimilarRegions(
  chain: MatchChain,
  segments: readonly TokenSegment[],
  profiles: readonly RegionSimilarityProfile[],
): CloneCandidateGroup | undefined {
  if (chain.segmentA === chain.segmentB) return undefined;
  const segmentA = segments[chain.segmentA];
  const segmentB = segments[chain.segmentB];
  if (segmentA === undefined || segmentB === undefined) return undefined;
  if (
    segmentA.regionKind !== segmentB.regionKind ||
    segmentA.functionDepth !== segmentB.functionDepth
  ) {
    return undefined;
  }
  const firstA = segmentA.tokens[0];
  const lastA = segmentA.tokens[segmentA.tokens.length - 1];
  const firstB = segmentB.tokens[0];
  const lastB = segmentB.tokens[segmentB.tokens.length - 1];
  if (
    segmentA.path === segmentB.path && firstA !== undefined &&
    lastA !== undefined &&
    firstB !== undefined && lastB !== undefined &&
    firstA.start < lastB.end && firstB.start < lastA.end
  ) {
    return undefined;
  }
  const profileA = profiles[chain.segmentA];
  const profileB = profiles[chain.segmentB];
  if (profileA === undefined || profileB === undefined) return undefined;
  const countsA = profileA.counts;
  const countsB = profileB.counts;
  const sharedShingles = setIntersectionSize(
    profileA.operationShingles,
    profileB.operationShingles,
  );
  const shingleContainment = sharedShingles /
    Math.max(
      1,
      Math.min(
        profileA.operationShingles.size,
        profileB.operationShingles.size,
      ),
    );
  const sharedRoleShingles = setIntersectionSize(
    profileA.roleShingles,
    profileB.roleShingles,
  );
  const roleShingleContainment = sharedRoleShingles /
    Math.max(
      1,
      Math.min(profileA.roleShingles.size, profileB.roleShingles.size),
    );
  const common = commonInformativeTokens(countsA, countsB);
  const sizeA = profileA.informativeSize;
  const sizeB = profileB.informativeSize;
  const sizeRatio = Math.min(sizeA, sizeB) /
    Math.max(1, Math.max(sizeA, sizeB));
  const dice = 2 * common.length / Math.max(1, sizeA + sizeB);
  const lines = Math.min(profileA.normalizedLines, profileB.normalizedLines);
  if (
    common.length < MIN_REGION_INFORMATIVE_TOKENS ||
    new Set(common.filter(isBehavioralSignalToken)).size < 7 ||
    sharedShingles < 8 ||
    shingleContainment < 0.34 ||
    sharedRoleShingles < 12 ||
    roleShingleContainment < 0.4 ||
    sizeRatio < 0.7 ||
    dice < MIN_REGION_DICE ||
    lines < MIN_REGION_NORMALIZED_LINES
  ) {
    return undefined;
  }
  return {
    skeleton: ["<similar-routine>", ...common],
    normalizedTokenCount: common.length,
    normalizedLineCount: lines,
    occurrences: [
      { segment: chain.segmentA, start: 0, end: segmentA.tokens.length },
      { segment: chain.segmentB, start: 0, end: segmentB.tokens.length },
    ],
  };
}

/** Intersect operation multisets across a connected routine-variant group. */
function candidateFromSimilarComponent(
  component: readonly number[],
  segments: readonly TokenSegment[],
  profiles: readonly RegionSimilarityProfile[],
): CloneCandidateGroup | undefined {
  const members = component
    .map((index) => segments[index])
    .filter((segment): segment is TokenSegment => segment !== undefined);
  if (members.length < 2) return undefined;
  const firstMember = members[0];
  if (firstMember === undefined) return undefined;
  const firstProfile = profiles[firstMember.index];
  if (firstProfile === undefined) return undefined;
  const intersection = new Map(firstProfile.counts);
  for (const member of members.slice(1)) {
    const profile = profiles[member.index];
    if (profile === undefined) return undefined;
    const counts = profile.counts;
    for (const key of [...intersection.keys()]) {
      const count = Math.min(intersection.get(key) ?? 0, counts.get(key) ?? 0);
      if (count === 0) intersection.delete(key);
      else intersection.set(key, count);
    }
  }
  const common = [...intersection.entries()]
    .sort(([a], [b]) => stableTextOrder(a, b))
    .flatMap(([key, count]) => Array.from({ length: count }, () => key));
  const lines = Math.min(
    ...members.map((member) =>
      profiles[member.index]?.normalizedLines ?? Number.POSITIVE_INFINITY
    ),
  );
  if (
    common.length < MIN_REGION_INFORMATIVE_TOKENS ||
    new Set(common.filter(isBehavioralSignalToken)).size < 7 ||
    lines < MIN_REGION_NORMALIZED_LINES
  ) {
    return undefined;
  }
  return {
    skeleton: ["<similar-routine>", ...common],
    normalizedTokenCount: common.length,
    normalizedLineCount: lines,
    occurrences: members.map((member) => ({
      segment: member.index,
      start: 0,
      end: member.tokens.length,
    })),
  };
}

/** Find the current representative of one deterministic union-find member. */
function componentRoot(parents: Map<number, number>, member: number): number {
  const parent = parents.get(member);
  if (parent === undefined || parent === member) return member;
  const root = componentRoot(parents, parent);
  parents.set(member, root);
  return root;
}

/** Join two routine-variant components using the lower index as representative. */
function joinComponents(
  parents: Map<number, number>,
  a: number,
  b: number,
): void {
  const rootA = componentRoot(parents, a);
  const rootB = componentRoot(parents, b);
  if (rootA === rootB) return;
  parents.set(Math.max(rootA, rootB), Math.min(rootA, rootB));
}

/** Merge overlapping views of one physical occurrence into its maximal span. */
function mergeOccurrenceSpans(
  spans: readonly OccurrenceSpan[],
): OccurrenceSpan[] {
  const sorted = [...spans].sort((a, b) =>
    a.segment - b.segment || a.start - b.start || a.end - b.end
  );
  const merged: OccurrenceSpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous === undefined ||
      previous.segment !== span.segment ||
      span.start >= previous.end
    ) {
      merged.push(span);
      continue;
    }
    merged[merged.length - 1] = {
      segment: previous.segment,
      start: Math.min(previous.start, span.start),
      end: Math.max(previous.end, span.end),
    };
  }
  return merged;
}

/** Group pairwise candidates by their normalized shared syntax. */
function groupCandidates(
  chains: readonly MatchChain[],
  segments: readonly TokenSegment[],
): CloneCandidateGroup[] {
  const groups = new Map<string, CloneCandidateGroup>();
  const regionPairs = new Set<string>();
  const parents = new Map<number, number>();
  const profiles = segments.map(regionSimilarityProfile);
  for (const chain of chains) {
    const candidates: CloneCandidateGroup[] = [];
    const exact = candidateFromChain(chain, segments);
    if (exact !== undefined) candidates.push(exact);
    const pairKey = `${chain.segmentA}:${chain.segmentB}`;
    if (!regionPairs.has(pairKey)) {
      regionPairs.add(pairKey);
      const similar = candidateFromSimilarRegions(chain, segments, profiles);
      if (similar !== undefined) {
        parents.set(
          chain.segmentA,
          parents.get(chain.segmentA) ?? chain.segmentA,
        );
        parents.set(
          chain.segmentB,
          parents.get(chain.segmentB) ?? chain.segmentB,
        );
        joinComponents(parents, chain.segmentA, chain.segmentB);
      }
    }
    for (const candidate of candidates) {
      const key = candidate.skeleton.join("\u001f");
      const current = groups.get(key);
      if (current === undefined) {
        groups.set(key, candidate);
      } else {
        current.occurrences.push(...candidate.occurrences);
      }
    }
  }
  const components = new Map<number, number[]>();
  for (const member of parents.keys()) {
    const root = componentRoot(parents, member);
    const component = components.get(root) ?? [];
    component.push(member);
    components.set(root, component);
  }
  for (const component of components.values()) {
    component.sort((a, b) => a - b);
    const candidate = candidateFromSimilarComponent(
      component,
      segments,
      profiles,
    );
    if (candidate === undefined) continue;
    const key = candidate.skeleton.join("\u001f");
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, candidate);
    } else {
      current.occurrences.push(...candidate.occurrences);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    occurrences: mergeOccurrenceSpans(group.occurrences),
  }));
}

/** Whether two token spans claim any of the same source bytes. */
function spansOverlap(
  a: OccurrenceSpan,
  b: OccurrenceSpan,
  segments: readonly TokenSegment[],
): boolean {
  const segmentA = segments[a.segment];
  const segmentB = segments[b.segment];
  const firstA = segmentA?.tokens[a.start];
  const lastA = segmentA?.tokens[a.end - 1];
  const firstB = segmentB?.tokens[b.start];
  const lastB = segmentB?.tokens[b.end - 1];
  if (
    segmentA === undefined || segmentB === undefined ||
    firstA === undefined || lastA === undefined ||
    firstB === undefined || lastB === undefined ||
    segmentA.path !== segmentB.path
  ) {
    return false;
  }
  return firstA.start < lastB.end && firstB.start < lastA.end;
}

/** Choose maximal groups while allowing no source range to inflate the census. */
function selectNonOverlappingGroups(
  candidates: readonly CloneCandidateGroup[],
  segments: readonly TokenSegment[],
): SelectedGroup[] {
  const ordered = [...candidates].sort((a, b) =>
    b.normalizedTokenCount - a.normalizedTokenCount ||
    b.occurrences.length - a.occurrences.length ||
    stableTextOrder(
      a.skeleton.join("\u001f"),
      b.skeleton.join("\u001f"),
    )
  );
  const claimed: OccurrenceSpan[] = [];
  const selected: SelectedGroup[] = [];
  for (const candidate of ordered) {
    const occurrences: OccurrenceSpan[] = [];
    for (const occurrence of candidate.occurrences) {
      if (
        claimed.some((other) => spansOverlap(occurrence, other, segments)) ||
        occurrences.some((other) => spansOverlap(occurrence, other, segments))
      ) {
        continue;
      }
      occurrences.push(occurrence);
    }
    if (occurrences.length < 2) continue;
    claimed.push(...occurrences);
    selected.push({ candidate, occurrences });
  }
  return selected;
}

/** Hash normalized syntax with a version prefix, excluding locations and order. */
async function cloneFingerprint(skeleton: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(
    `duplicate-clone-v1\0${skeleton.join("\0")}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `clone-v1-${hex}`;
}

/** Project an internal token span into an exact repository source range. */
function occurrenceEvidence(
  span: OccurrenceSpan,
  segments: readonly TokenSegment[],
): DuplicateCloneOccurrence {
  const segment = segments[span.segment];
  const first = segment?.tokens[span.start];
  const last = segment?.tokens[span.end - 1];
  if (segment === undefined || first === undefined || last === undefined) {
    throw new Error("clone occurrence references an absent semantic token");
  }
  return {
    path: segment.path,
    startLine: first.line,
    startColumn: first.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
  };
}

/** Run the qualified candidate-and-collapse pipeline over authored sources. */
export async function duplicationCensus(
  sources: readonly DuplicationSource[],
): Promise<DuplicationCensus> {
  const authoredSources = sources.filter((source) => source.generated !== true);
  const paths = new Set<string>();
  for (const source of authoredSources) {
    if (paths.has(source.path)) {
      throw new Error(`duplicate census source path '${source.path}'`);
    }
    paths.add(source.path);
  }
  const segments = tokenizeSources(authoredSources);
  const selected = selectNonOverlappingGroups(
    groupCandidates(collapseMatches(exactMatches(segments)), segments),
    segments,
  );
  const groups: DuplicateCloneGroup[] = [];
  for (const group of selected) {
    const occurrences = group.occurrences
      .map((span) => occurrenceEvidence(span, segments))
      .sort((a, b) =>
        stableTextOrder(a.path, b.path) ||
        a.startLine - b.startLine ||
        a.startColumn - b.startColumn
      );
    groups.push({
      fingerprint: await cloneFingerprint(group.candidate.skeleton),
      normalizedTokenCount: group.candidate.normalizedTokenCount,
      normalizedLineCount: group.candidate.normalizedLineCount,
      duplicateLineContribution: group.candidate.normalizedLineCount *
        (occurrences.length - 1),
      occurrences,
    });
  }
  groups.sort((a, b) => stableTextOrder(a.fingerprint, b.fingerprint));
  return {
    groups,
    duplicateCloneGroups: groups.length,
    duplicatedLines: groups.reduce(
      (sum, group) => sum + group.duplicateLineContribution,
      0,
    ),
  };
}

/** Render one concise, actionable clone diagnostic. */
export function duplicateCloneDiagnostic(group: DuplicateCloneGroup): string {
  const locations = group.occurrences.map((occurrence) =>
    `${occurrence.path}:${occurrence.startLine}:${occurrence.startColumn}-` +
    `${occurrence.endLine}:${occurrence.endColumn}`
  ).join(", ");
  return `${group.fingerprint} ` +
    `${group.normalizedLineCount} normalized lines / ` +
    `${group.normalizedTokenCount} semantic tokens / ` +
    `+${group.duplicateLineContribution} duplicate lines: ${locations}`;
}
