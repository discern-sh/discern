/**
 * The install manifest (`.icculus/manifest.json`).
 *
 * The manifest is what makes `upgrade` safe: it records the exact sha256 of the
 * bytes the kit wrote for every *managed* file, so a later upgrade can tell a
 * pristine managed file (safe to overwrite) from one the user edited (preserve,
 * write the new version as `.new`). It also pins the kit version and the
 * project identity.
 *
 * Managed vs seed is a classification on the *target* path:
 *   MANAGED  refreshed by `upgrade`  — `bin/agent`, `.icculus/engine/**`,
 *            `.ai/skills/**`.
 *   SEED     write-once, never overwritten on upgrade — everything else.
 */

import { encodeHex } from "@std/encoding/hex";

/** One recorded managed file: its target-relative path and content hash. */
export interface ManagedEntry {
  path: string;
  sha256: string;
}

/** The full manifest document written to `.icculus/manifest.json`. */
export interface Manifest {
  kit_version: string;
  generated_at: string;
  project: {
    slug: string;
    agents: string[];
  };
  managed: ManagedEntry[];
}

/**
 * Glob-ish prefixes/exacts that classify a target path as MANAGED. Kept as
 * simple structural checks rather than a glob engine: the managed set is a
 * small, fixed contract (`bin/agent`, the engine tree, the skills tree).
 */
const MANAGED_EXACT = new Set<string>(["bin/agent"]);
const MANAGED_PREFIXES = [".icculus/engine/", ".ai/skills/"];

/**
 * Classify a target-relative path as managed (refreshed by `upgrade`) or seed
 * (write-once). Paths are compared with forward slashes regardless of OS.
 */
export function isManaged(targetRelPath: string): boolean {
  const path = targetRelPath.replaceAll("\\", "/");
  if (MANAGED_EXACT.has(path)) {
    return true;
  }
  return MANAGED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Compute the lowercase-hex sha256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the type is unambiguously a
  // BufferSource (Deno's file reads can be backed by SharedArrayBuffer).
  const buffer = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return encodeHex(new Uint8Array(digest));
}

/** Build a manifest document from its parts. `managed` is sorted by path. */
export function buildManifest(params: {
  kitVersion: string;
  generatedAt: string;
  slug: string;
  agents: string[];
  managed: ManagedEntry[];
}): Manifest {
  const managed = [...params.managed].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  return {
    kit_version: params.kitVersion,
    generated_at: params.generatedAt,
    project: { slug: params.slug, agents: params.agents },
    managed,
  };
}

/** Parse a manifest from JSON bytes, or throw a clear error if malformed. */
export function parseManifest(text: string): Manifest {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null) {
    throw new Error("manifest.json is not a JSON object");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.kit_version !== "string") {
    throw new Error("manifest.json is missing a string kit_version");
  }
  const managedRaw = Array.isArray(obj.managed) ? obj.managed : [];
  const managed: ManagedEntry[] = managedRaw
    .filter((e): e is Record<string, unknown> =>
      typeof e === "object" && e !== null
    )
    .filter((e) => typeof e.path === "string" && typeof e.sha256 === "string")
    .map((e) => ({ path: e.path as string, sha256: e.sha256 as string }));
  const project = (typeof obj.project === "object" && obj.project !== null)
    ? obj.project as Record<string, unknown>
    : {};
  return {
    kit_version: obj.kit_version,
    generated_at: typeof obj.generated_at === "string" ? obj.generated_at : "",
    project: {
      slug: typeof project.slug === "string" ? project.slug : "",
      agents: Array.isArray(project.agents)
        ? project.agents.filter((a): a is string => typeof a === "string")
        : [],
    },
    managed,
  };
}

/** Serialize a manifest as pretty (2-space) JSON with a trailing newline. */
export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Look up a managed entry's recorded hash, or undefined if not tracked. */
export function recordedHash(
  manifest: Manifest,
  targetRelPath: string,
): string | undefined {
  const path = targetRelPath.replaceAll("\\", "/");
  return manifest.managed.find((e) => e.path === path)?.sha256;
}
