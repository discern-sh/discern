/**
 * Declared source universes for structural guards.
 *
 * A structural guard is authored test or lint code that enumerates source
 * files, inspects their text or syntax, and enforces one invariant across
 * files. Behavioral tests that happen to walk their own fixtures, fixture
 * walkers, code generators, and production directory traversal are outside
 * that predicate because enumeration is input or behavior there, not the
 * membership boundary of a cross-file rule.
 *
 * Every structural guard obtains its files here. A declaration names the guard
 * as `<repo-relative module>#<local-id>`, selects one canonical Git-derived
 * universe, and records any intentional narrowing beside its predicate. A
 * specialized universe is also Git-derived: it may name a source-extension
 * family or the text contract including fixtures, never member paths, and must
 * explain why none of the canonical universes fits.
 */

import {
  AUTHORED_DENO_FILES,
  AUTHORED_TEXT_FILES,
  AUTHORED_TS_FILES,
  authoredDenoFiles,
  authoredTextFiles,
  authoredTsFiles,
  gitListedRepoFiles,
  gitListedTextFiles,
  REPO_ROOT,
  TRACKED_MD_FILES,
  trackedMarkdownFiles,
} from "./repo_authored_paths.ts";

export type CanonicalStructuralGuardUniverse =
  | "authored-ts"
  | "authored-deno"
  | "tracked-markdown"
  | "authored-text";

interface SpecializedStructuralGuardUniverseBase {
  readonly kind: "specialized";
  /** Stable description of the syntax family, not a list of members. */
  readonly name: string;
  /** Why no canonical authored universe represents this syntax family. */
  readonly reason: string;
}

export type SpecializedStructuralGuardUniverse =
  & SpecializedStructuralGuardUniverseBase
  & (
    | {
      /** File extensions including the leading dot; Git supplies membership. */
      readonly extensions: readonly string[];
      readonly text?: never;
    }
    | {
      /** Every Git-derived text-contract file, including inert fixture data. */
      readonly text: true;
      readonly extensions?: never;
    }
  );

export interface StructuralGuardNarrowing {
  /** The invariant boundary, not an implementation convenience. */
  readonly reason: string;
  readonly include: (repoRelativePath: string) => boolean;
}

export interface StructuralGuardScopeDeclaration {
  /** `<repo-relative module>#<local-id>` identifies this call-site guard. */
  readonly guard: string;
  readonly universe:
    | CanonicalStructuralGuardUniverse
    | SpecializedStructuralGuardUniverse;
  readonly narrow?: StructuralGuardNarrowing;
}

/** Require a concise single-line explanation at each declaration site. */
function assertOneLine(label: string, value: string): void {
  if (value.trim().length < 12 || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a specific one-line explanation`);
  }
}

/** Validate the call-site identity used by the architectural enrollment test. */
function assertGuardIdentity(guard: string): void {
  if (!/^[^#]+\.ts#[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guard)) {
    throw new Error(
      `structural guard '${guard}' must be <repo-relative module>.ts#<local-id>`,
    );
  }
}

/** Validate and convert specialized extensions into recursive Git pathspecs. */
function specializedPatterns(
  universe: SpecializedStructuralGuardUniverse,
): string[] {
  assertOneLine(
    `${universe.name} specialized-universe reason`,
    universe.reason,
  );
  if (universe.name.trim().length < 3 || /[\r\n]/.test(universe.name)) {
    throw new Error("a specialized universe needs a stable one-line name");
  }
  if (universe.extensions === undefined) return [];
  if (universe.extensions.length === 0) {
    throw new Error(`${universe.name} must name at least one source extension`);
  }
  const extensions = [...new Set(universe.extensions)];
  if (extensions.length !== universe.extensions.length) {
    throw new Error(`${universe.name} repeats a source extension`);
  }
  for (const extension of extensions) {
    if (!/^\.[a-z0-9]+$/i.test(extension)) {
      throw new Error(
        `${universe.name} extension '${extension}' must be an extension, not a path or glob`,
      );
    }
  }
  return extensions.map((extension) => `*${extension}`);
}

/** Resolve a specialized Git-derived syntax family, including fixture data. */
async function specializedFiles(
  universe: SpecializedStructuralGuardUniverse,
  root: string,
): Promise<string[]> {
  const patterns = specializedPatterns(universe);
  if (universe.text === true) {
    return await gitListedTextFiles(root, { includeTestFixtures: true });
  }
  return await gitListedRepoFiles(root, patterns, {
    includeTestFixtures: true,
  });
}

/** Resolve one canonical universe against the checkout or an injected Git root. */
async function canonicalFiles(
  universe: CanonicalStructuralGuardUniverse,
  root: string,
): Promise<string[]> {
  if (root === REPO_ROOT) {
    switch (universe) {
      case "authored-ts":
        return [...AUTHORED_TS_FILES];
      case "authored-deno":
        return [...AUTHORED_DENO_FILES];
      case "tracked-markdown":
        return [...TRACKED_MD_FILES];
      case "authored-text":
        return [...AUTHORED_TEXT_FILES];
    }
  }
  switch (universe) {
    case "authored-ts":
      return await authoredTsFiles(root);
    case "authored-deno":
      return await authoredDenoFiles(root);
    case "tracked-markdown":
      return await trackedMarkdownFiles(root);
    case "authored-text":
      return await authoredTextFiles(root);
  }
}

/** Return the Git-derived file set declared by one structural guard. */
export async function structuralGuardScope(
  declaration: StructuralGuardScopeDeclaration,
  root: string = REPO_ROOT,
): Promise<string[]> {
  assertGuardIdentity(declaration.guard);
  let files: string[];
  if (typeof declaration.universe === "string") {
    files = await canonicalFiles(declaration.universe, root);
  } else {
    files = await specializedFiles(declaration.universe, root);
  }
  if (declaration.narrow === undefined) return files;
  assertOneLine(
    `${declaration.guard} narrowing reason`,
    declaration.narrow.reason,
  );
  return files.filter(declaration.narrow.include);
}
