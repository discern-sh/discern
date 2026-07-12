/** A live config reference accepted in commands and globs that follow `[map].dir`. */
export const MAP_DIR_REFERENCE = "${map.dir}";

/** True when a map directory stays inside the project root. An angle bracket is
 * never part of a real map path — it is an unsubstituted `<placeholder>` copied
 * verbatim from an instruction, and accepting one scaffolds a literal
 * `<placeholder>/` tree — so the class is rejected here, for every caller. */
export function isValidMapDir(value: string): boolean {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (
    trimmed === "" || /^\.\/?$/.test(trimmed) || trimmed.startsWith("/") ||
    /^[A-Za-z]:\//.test(trimmed) || /[<>]/.test(trimmed)
  ) {
    return false;
  }
  return !trimmed.split("/").some((segment) => segment === "..");
}

/** Canonicalize a valid map directory to forward slashes with one trailing slash. */
export function normalizeMapDir(value: string): string {
  if (!isValidMapDir(value)) {
    throw new Error(
      `invalid map directory "${value}": use a project-relative path that stays inside the repository`,
    );
  }
  const normalized = value.trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  return `${normalized}/`;
}

/** Expand the one live map-root reference inside a configured command or glob. */
export function expandMapDirReference(value: string, mapDir: string): string {
  return value.replaceAll(MAP_DIR_REFERENCE, normalizeMapDir(mapDir));
}
