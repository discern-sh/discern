/** Strict SemVer parsing and precedence shared by release consumers. */
import { compare, format, parse, type SemVer } from "@std/semver";

/** Parse without accepting a tag prefix, whitespace, or numeric coercion. */
export function parseVersion(value: string): SemVer {
  const version = parse(value);
  if (format(version) !== value) throw new Error(`invalid SemVer: ${value}`);
  return version;
}

/** Compare precedence; build metadata never changes the answer. */
export function compareVersions(left: string, right: string): number {
  return compare(parseVersion(left), parseVersion(right));
}

/** Resolve the numeric family independently of release decoration. */
export function versionFamily(value: string): string {
  const version = parseVersion(value);
  return `${version.major}.${version.minor}`;
}
