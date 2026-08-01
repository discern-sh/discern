import {
  normalizeProjectRelativeDirectoryPath,
  projectRelativePathIssue,
} from "./project_path.ts";

/** A live config reference accepted in commands and globs that follow `[map].dir`. */
export const MAP_DIR_REFERENCE = "${map.dir}";

/** True when a map directory stays inside the project root. An angle bracket is
 * never part of a real map path — it is an unsubstituted `<placeholder>` copied
 * verbatim from an instruction, and accepting one scaffolds a literal
 * `<placeholder>/` tree — so the class is rejected here, for every caller. */
export function isValidMapDir(value: string): boolean {
  const normalized = normalizeProjectRelativeDirectoryPath(value);
  return projectRelativePathIssue(normalized) === undefined;
}

/** Canonicalize a valid map directory to forward slashes with one trailing slash. */
export function normalizeMapDir(value: string): string {
  const normalized = normalizeProjectRelativeDirectoryPath(value);
  if (projectRelativePathIssue(normalized) !== undefined) {
    throw new Error(
      `invalid map directory "${value}": use a project-relative path that stays inside the repository`,
    );
  }
  return `${normalized}/`;
}

/** Expand the one live map-root reference inside a configured command or glob. */
export function expandMapDirReference(value: string, mapDir: string): string {
  return value.replaceAll(MAP_DIR_REFERENCE, normalizeMapDir(mapDir));
}
