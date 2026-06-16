/**
 * The install manifest (`.icculus/manifest.json`).
 *
 * The manifest is what makes `upgrade` safe: it records the exact sha256 of the
 * bytes the kit wrote for every *managed* file, so a later upgrade can tell a
 * pristine managed file (safe to overwrite) from one the user edited (preserve,
 * write the new version as `.new`). It also pins the kit version and the
 * project identity.
 *
 * Managed vs seed is a classification on the *target* path, DECLARED by the kit
 * in `templates/managed.json` (an adapter may ship its own) rather than hardcoded
 * here:
 *   MANAGED  refreshed by `upgrade`  — by default `bin/agent`,
 *            `.icculus/engine/**`, `.ai/skills/**`.
 *   SEED     write-once, never overwritten on upgrade — everything else.
 */

import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";

/** The manifest's location under a destination root. */
export const MANIFEST_REL_PATH = ".icculus/manifest.json";

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

/** The filename a templates/adapter tree uses to DECLARE its managed-set. */
export const MANAGED_SPEC_FILE = "managed.json";

/**
 * Declares which target paths are MANAGED (refreshed by `upgrade`, hash-tracked,
 * preserved-as-`.new` when edited) vs SEED (write-once). A path is managed when
 * it equals an `exact` entry or starts with a `prefixes` entry — simple
 * structural checks, not a glob engine. The kit ships this as
 * `templates/managed.json`; the installer reads it instead of hardcoding the set,
 * and an adapter may ship its own to mark overlay files it owns.
 */
export interface ManagedSpec {
  exact: string[];
  prefixes: string[];
}

/**
 * The built-in default, used when no `managed.json` is present. It mirrors the
 * shipped `templates/managed.json`, so behaviour is identical whether the
 * declaration is read or this fallback applies.
 */
export const DEFAULT_MANAGED_SPEC: ManagedSpec = {
  exact: ["bin/agent"],
  prefixes: [".icculus/engine/", ".ai/skills/"],
};

/**
 * Classify a target-relative path as managed (refreshed by `upgrade`) or seed
 * (write-once) against a given spec. Paths are compared with forward slashes.
 */
export function isManagedBy(targetRelPath: string, spec: ManagedSpec): boolean {
  const path = targetRelPath.replaceAll("\\", "/");
  if (spec.exact.includes(path)) {
    return true;
  }
  return spec.prefixes.some((prefix) => path.startsWith(prefix));
}

/** Classify against the built-in default spec (for callers without one). */
export function isManaged(targetRelPath: string): boolean {
  return isManagedBy(targetRelPath, DEFAULT_MANAGED_SPEC);
}

/** Union two specs (deduped) — e.g. the base kit spec plus an adapter's. */
export function mergeManagedSpecs(a: ManagedSpec, b: ManagedSpec): ManagedSpec {
  return {
    exact: [...new Set([...a.exact, ...b.exact])],
    prefixes: [...new Set([...a.prefixes, ...b.prefixes])],
  };
}

/**
 * Parse a managed-set declaration, tolerating missing arrays. Throws on a
 * non-object (the caller reports it).
 */
export function parseManagedSpec(text: string): ManagedSpec {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${MANAGED_SPEC_FILE} must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return { exact: asStrings(obj.exact), prefixes: asStrings(obj.prefixes) };
}

/**
 * Load a managed-set declaration from `<dir>/managed.json`, or undefined when
 * absent. A malformed file throws. The installer reads this from the templates
 * tree (and an adapter dir) to classify scaffolded files; `managed.json` is
 * installer metadata and is never itself scaffolded.
 */
export async function loadManagedSpec(
  dir: string,
): Promise<ManagedSpec | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(dir, MANAGED_SPEC_FILE));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
  return parseManagedSpec(text);
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

/** Outcome of trying to load a manifest from a destination root. */
export interface ManifestLoad {
  /** The parsed manifest, or undefined when absent or unreadable. */
  manifest: Manifest | undefined;
  /**
   * A human-readable reason `manifest` is undefined, for the caller to warn
   * about; undefined when the manifest loaded cleanly (or the caller need not
   * warn). When set, every managed file is treated as not-provably-ours, so the
   * safe `.new` path applies.
   */
  warning?: string;
}

/**
 * Load the install manifest from a destination root, tolerating a missing or
 * malformed file. This is the one mechanism `init` and `upgrade` share to decide
 * whether an on-disk managed file is provably the kit's (recorded hash) and so
 * safe to overwrite — keeping the two commands' overwrite rule identical. A
 * missing or unparseable manifest yields `undefined` plus a `warning`, which the
 * shared disposition rule reads as "not provably ours → preserve, write `.new`".
 */
export async function loadManifest(destDir: string): Promise<ManifestLoad> {
  const path = join(destDir, MANIFEST_REL_PATH);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        manifest: undefined,
        warning:
          `no ${MANIFEST_REL_PATH} found; treating any existing managed files as yours (will not overwrite).`,
      };
    }
    throw error;
  }
  try {
    return { manifest: parseManifest(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      manifest: undefined,
      warning:
        `could not parse ${MANIFEST_REL_PATH} (${message}); treating any existing managed files as yours (will not overwrite).`,
    };
  }
}
