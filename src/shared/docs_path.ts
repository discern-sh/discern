/** The discoverable project-relative home for discern's documentation tree. */
export const DEFAULT_DOCS_DIR = "docs/";

/** A live config reference accepted in commands and globs that follow `[docs].dir`. */
export const DOCS_DIR_REFERENCE = "${docs.dir}";

/** True when a docs directory stays inside the project root. */
export function isValidDocsDir(value: string): boolean {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (
    trimmed === "" || /^\.\/?$/.test(trimmed) || trimmed.startsWith("/") ||
    /^[A-Za-z]:\//.test(trimmed)
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
