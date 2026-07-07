/** A live config reference accepted in commands and globs that follow `[docs].dir`. */
export const DOCS_DIR_REFERENCE = "${docs.dir}";

/** True when a docs directory stays inside the project root. An angle bracket is
 * never part of a real docs path — it is an unsubstituted `<placeholder>` copied
 * verbatim from an instruction, and accepting one scaffolds a literal
 * `<placeholder>/` tree — so the class is rejected here, for every caller. */
export function isValidDocsDir(value: string): boolean {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (
    trimmed === "" || /^\.\/?$/.test(trimmed) || trimmed.startsWith("/") ||
    /^[A-Za-z]:\//.test(trimmed) || /[<>]/.test(trimmed)
  ) {
    return false;
  }
  return !trimmed.split("/").some((segment) => segment === "..");
}

/** Canonicalize a valid docs directory to forward slashes with one trailing slash. */
export function normalizeDocsDir(value: string): string {
  if (!isValidDocsDir(value)) {
    throw new Error(
      `invalid docs directory "${value}": use a project-relative path that stays inside the repository`,
    );
  }
  const normalized = value.trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  return `${normalized}/`;
}

/** Expand the one live docs-root reference inside a configured command or glob. */
export function expandDocsDirReference(value: string, docsDir: string): string {
  return value.replaceAll(DOCS_DIR_REFERENCE, normalizeDocsDir(docsDir));
}
