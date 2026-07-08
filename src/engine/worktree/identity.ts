/**
 * Resolve a linked git worktree's stable, agent-agnostic identity. Every derived
 * value (id / site / branch / port / db) comes from structured state, not
 * filesystem shape, so it survives wherever an agent keeps the checkout.
 *
 * Identity sources, in order:
 *   1. `DISCERN_WORKTREE_ID` from the environment, when valid.
 *   2. `DISCERN_WORKTREE_ID` from the target worktree's `.env`, when valid.
 *   3. Git's linked-worktree admin-directory basename (refusing the main
 *      checkout, where `--absolute-git-dir` == `--git-common-dir`).
 *
 * LOAD-BEARING (Risk R1): a worktree's port, site tail hash, and db name derive
 * from the POSIX `cksum` of the id (see `shared/crc.ts`). The derivation is
 * frozen — any change shifts every existing worktree's identity — and is pinned
 * against `tests/fixtures/parity/worktree-identity.json`.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import { cksumString } from "../../shared/crc.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { EnvReader } from "../../shared/env.ts";

/** The dev-server port band: 13000–14999, clear of common local services. */
const PORT_BASE = 13000;
/** The width of the port band hashed into. */
const PORT_SPAN = 2000;
/** The DNS label length limit a site/host name must fit within. */
const DNS_LABEL_LIMIT = 63;
/** Validation pattern for an explicit `DISCERN_WORKTREE_ID` override. */
const OVERRIDE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

/** A resolved worktree identity: every derived token in one object. */
export interface WorktreeIdentity {
  /** The safe worktree id (the basis for every other value). */
  id: string;
  /** The dev-server site/host name, e.g. `my-app-wt-feature`. */
  site: string;
  /** The default branch name, e.g. `agent/wt-feature`. */
  branch: string;
  /** The deterministic dev-server port, e.g. `13742`. */
  port: number;
  /** The database-name-safe identity, e.g. `my_app_wt_feature`. */
  db: string;
}

/**
 * The identity fields the `identity` command can resolve — the
 * {@link WorktreeIdentity} keys plus `worktree` (the base resource handle, derived
 * via `worktreeBase` rather than stored on the identity). The SINGLE source the
 * resolver's parameter union and exhaustive switch (`identityField`) and the
 * CLI's `--<field>` flags (`dispatch.ts`) derive from, so a new field can't be added
 * to one satellite without the others: the union+switch is compile-total (a missing
 * case fails `deno check`), and the flags are tied by `engine_verb_parity_test.ts`.
 *
 * This is a DISTINCT set from the adapter `WORKTREE_TOKENS` (`tokens.ts`): those are
 * the `@…@` placeholders a resource command expands (db/site/port/project_slug/dir/
 * worktree/resource), not the identity fields a user queries.
 */
export const WORKTREE_FIELDS = [
  "id",
  "site",
  "branch",
  "port",
  "db",
  "worktree",
] as const;

/** One resolvable identity field ({@link WORKTREE_FIELDS}). */
export type WorktreeField = (typeof WORKTREE_FIELDS)[number];

/** The project-level inputs identity derivation needs (slug + branch prefix). */
export interface IdentitySettings {
  /** The sanitized project slug (site/db/id prefix). Never empty. */
  slug: string;
  /** The branch prefix prepended to the id (default `agent/`). */
  branchPrefix: string;
}

/** An error in identity resolution, carrying a process-style exit code. */
export class IdentityError extends Error {
  /** The process-style exit code for this failure (1 or 2). */
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}

/**
 * Lowercase, collapse every run of non-`[a-z0-9]` to a single dash, and trim
 * leading/trailing dashes.
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Build the database-name-safe identity: `<slug>_<id>` lowercased with every run
 * of non-alphanumerics collapsed to a single underscore (and trimmed). Db mode
 * uses underscores where site uses dashes, because many engines disallow
 * dashes/dots in unquoted database names.
 */
export function dbNameForId(slug: string, id: string): string {
  return `${slug}_${id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

/**
 * Derive the deterministic dev-server port from the id: `13000 + cksum(id) %
 * 2000`. Hashing the id into a fixed band gives every worktree its own port with
 * no shared registry.
 */
export function portForId(id: string): number {
  return PORT_BASE + (cksumString(id) % PORT_SPAN);
}

/**
 * Fit the id into a site/host tail within the 63-char DNS label limit, hashing
 * the tail when `slug-id` would exceed it: `maxIdLen = 63 - slug.length - 1`;
 * under the limit the id is used whole, else `keep = max(1, maxIdLen -
 * hash.length - 1)` and the result is `id[0:keep] + "-" + cksum(id)` (so a
 * `keep` landing on a dash boundary yields the documented double dash).
 */
export function fitSiteId(slug: string, id: string): string {
  const maxIdLen = DNS_LABEL_LIMIT - slug.length - 1;
  if (id.length <= maxIdLen) {
    return id;
  }
  const hash = String(cksumString(id));
  const keep = Math.max(1, maxIdLen - hash.length - 1);
  return `${id.slice(0, keep)}-${hash}`;
}

/** The full site/host name: `<slug>-<fitSiteId(id)>`. */
export function siteForId(slug: string, id: string): string {
  return `${slug}-${fitSiteId(slug, id)}`;
}

/**
 * The worktree's resource-agnostic base handle: `<slug>-<id>` sanitized (the
 * `@worktree@` token). Like {@link siteForId} but NOT DNS-fitted — a plain,
 * predictable, project-namespaced name a generic external resource manager can
 * use. Deterministic per worktree; the slug prefix keeps two projects' worktrees
 * from ever colliding on the same host.
 */
export function worktreeBase(slug: string, id: string): string {
  return sanitizeSlug(`${slug}-${id}`);
}

/**
 * A named resource's per-worktree handle: `<slug>-<id>-<name>` sanitized (the
 * `@resource@` token, bound to the resource whose `create`/`destroy`/`ensure` is
 * running). Deterministic (same worktree + name ⇒ same handle), unique across
 * worktrees (the id) and across resources (the name), namespaced by project (the
 * slug prefix ⇒ cross-project non-collision), and shell/CLI/resource-name-safe
 * (sanitized to `[a-z0-9-]`). Unclamped, matching {@link dbNameForId}'s
 * convention — a resource that needs a length-bounded DNS label uses `@site@`.
 */
export function resourceForId(slug: string, id: string, name: string): string {
  return sanitizeSlug(`${slug}-${id}-${name}`);
}

/**
 * Validate an explicit id override against the override pattern, then normalise
 * it to a slug. Throws an `IdentityError` (exit 1) on an invalid value.
 */
export function validateOverrideId(raw: string): string {
  if (!OVERRIDE_ID_RE.test(raw)) {
    throw new IdentityError(
      `identity: invalid DISCERN_WORKTREE_ID '${raw}'. Use letters, numbers, dots, dashes, or underscores.`,
    );
  }
  return sanitizeSlug(raw);
}

/**
 * Build the five derived identity values from a resolved id and project
 * settings. Pure — no I/O — so the parity tests can drive it directly with a
 * known id, slug, and branch prefix.
 */
export function deriveIdentity(
  id: string,
  settings: IdentitySettings,
): WorktreeIdentity {
  return {
    id,
    site: siteForId(settings.slug, id),
    branch: `${settings.branchPrefix}${id}`,
    port: portForId(id),
    db: dbNameForId(settings.slug, id),
  };
}

/**
 * Word lists for a freshly-minted worktree id (`<adjective>-<noun>-<hex>`). Kept
 * deliberately generic — discern is stack- and domain-neutral, so these stand-ins
 * must read correctly for a project in any field. The pair is for legibility; the
 * hex tail (not the words) is what makes a minted id unique.
 */
const ID_ADJECTIVES = [
  "amber",
  "brave",
  "brisk",
  "calm",
  "clever",
  "eager",
  "fond",
  "gentle",
  "jolly",
  "keen",
  "lively",
  "lucky",
  "mellow",
  "merry",
  "nimble",
  "plucky",
  "proud",
  "quiet",
  "rapid",
  "snug",
  "spry",
  "sunny",
  "tidy",
  "witty",
] as const;
const ID_NOUNS = [
  "beacon",
  "brook",
  "cedar",
  "comet",
  "cove",
  "ember",
  "falcon",
  "finch",
  "glade",
  "harbor",
  "heron",
  "juniper",
  "lantern",
  "maple",
  "marsh",
  "meadow",
  "otter",
  "pebble",
  "ridge",
  "river",
  "sparrow",
  "summit",
  "thicket",
  "willow",
] as const;

/** A uniformly-random element of a non-empty word list, from the Web Crypto RNG. */
function randomChoice(items: readonly string[]): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const choice = items[(buf[0] ?? 0) % items.length];
  if (choice === undefined) {
    throw new Error("randomChoice: empty word list");
  }
  return choice;
}

/** A short random hex tail (6 chars / 3 bytes) — the uniqueness in a minted id. */
function randomHexTail(): string {
  const buf = new Uint8Array(3);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The longest a caller-supplied name may make the human portion (the slug body,
 * before the hex tail) of a minted id. Beyond this the name is shortened on a word
 * boundary — the hex tail still guarantees uniqueness, so this cap is purely about a
 * readable branch and directory name, not correctness.
 */
export const NAME_SLUG_MAX = 40;

/** How the human portion of a minted worktree id was chosen. */
export type WorktreeNameSource = "name" | "codename";

/**
 * The decision {@link chooseWorktreeName} makes from an optional caller-supplied
 * name: whether to build the id from that name or from a random codename, plus a
 * transparency note when the supplied name was normalised or could not be used.
 */
export interface WorktreeNameChoice {
  /** `"name"` when the caller's name yielded a usable slug; `"codename"` otherwise. */
  source: WorktreeNameSource;
  /** The branch-safe slug the name reduced to — non-empty ONLY when `source` is
   * `"name"`, empty when a codename is used. */
  slug: string;
  /** A human note, present ONLY when a name was supplied AND it either changed under
   * normalisation or was unusable (so a codename was substituted). Absent when no
   * name was supplied, or it was already slug-clean. */
  note?: string;
}

/**
 * Shorten an already-sanitized slug to at most `max` chars, cutting on a dash
 * boundary so a whole trailing word is dropped rather than a fragment left behind.
 * Falls back to a hard cut only when the first word alone exceeds `max`.
 */
function clampSlug(slug: string, max: number): string {
  if (slug.length <= max) {
    return slug;
  }
  const cut = slug.slice(0, max).replace(/-+$/, "");
  const lastDash = cut.lastIndexOf("-");
  const onBoundary = lastDash > 0 ? cut.slice(0, lastDash) : "";
  return onBoundary !== "" ? onBoundary : cut;
}

/**
 * Decide the human portion of a minted worktree id from an OPTIONAL caller-supplied
 * name. discern uses no AI, so an agent supplies intent as free text and this reduces
 * it — deterministically — to a branch- and path-safe slug through the same
 * {@link sanitizeSlug} every identity token obeys, clamped to {@link NAME_SLUG_MAX}
 * on a word boundary. Because `sanitizeSlug` collapses every non-`[a-z0-9]` run to a
 * single dash and trims the ends, the git-ref and path hazards a raw name might carry
 * (spaces, slashes, `..`, a leading dash, a trailing `.lock`, control/emoji bytes)
 * cannot survive it. The transform NEVER fails: an empty or fully-stripped name
 * (all punctuation, emoji, or non-Latin script) returns `source:"codename"` so the
 * caller falls back to a random `<adjective>-<noun>` pair — keeping `discern start`
 * unable to fail on a cosmetic field. A `note` comes back whenever the supplied name
 * changed or was dropped, so the caller can surface what happened (and retry with a
 * cleaner name if it cares) without ever being forced to.
 */
export function chooseWorktreeName(name?: string): WorktreeNameChoice {
  const trimmed = (name ?? "").trim();
  if (trimmed === "") {
    // No name supplied — a pure codename, and nothing to report.
    return { source: "codename", slug: "" };
  }
  const slug = clampSlug(sanitizeSlug(trimmed), NAME_SLUG_MAX);
  if (slug === "") {
    return {
      source: "codename",
      slug: "",
      note:
        `Could not derive a branch-safe name from '${trimmed}' — used a random codename instead.`,
    };
  }
  if (slug !== trimmed) {
    return {
      source: "name",
      slug,
      note: `Normalised the worktree name '${trimmed}' → '${slug}'.`,
    };
  }
  return { source: "name", slug };
}

/** A freshly-minted worktree id plus how its human portion was chosen. */
export interface MintedWorktreeId {
  /** The full id: `<slug>-<hex>` from a caller name, else `<adjective>-<noun>-<hex>`. */
  id: string;
  /** Whether the human portion came from a caller name or a random codename. */
  source: WorktreeNameSource;
  /** Transparency note when a supplied name was normalised or dropped
   * (see {@link chooseWorktreeName}). */
  note?: string;
}

/**
 * Mint a fresh, readable worktree id. With no name it keeps the original shape — a
 * random `<adjective>-<noun>-<hex>` pair (e.g. `brisk-otter-a3f9c1`), legible like the
 * names Claude Code's worktree hook supplies — so the unnamed path is unchanged. With
 * a name it becomes `<slug>-<hex>`, the slug derived by {@link chooseWorktreeName} (an
 * unusable name falls back to a codename). Either way the id is sanitized to the same
 * rules a `DISCERN_WORKTREE_ID` override obeys ({@link sanitizeSlug} /
 * {@link OVERRIDE_ID_RE}), and the hex tail — not the words — is what makes it unique
 * across calls, so two worktrees sharing a name still get distinct ids. Callers verify
 * the derived branch / directory is actually free before using it; a collision is
 * astronomically unlikely but never assumed.
 */
export function generateWorktreeId(name?: string): MintedWorktreeId {
  const choice = chooseWorktreeName(name);
  const stem = choice.source === "name"
    ? choice.slug
    : `${randomChoice(ID_ADJECTIVES)}-${randomChoice(ID_NOUNS)}`;
  const id = sanitizeSlug(`${stem}-${randomHexTail()}`);
  return choice.note !== undefined
    ? { id, source: choice.source, note: choice.note }
    : { id, source: choice.source };
}

/**
 * Resolve the project slug and branch prefix from config, with env overrides
 * (`DISCERN_PROJECT_SLUG` / `DISCERN_WORKTREE_BRANCH_PREFIX`) winning. The slug
 * is sanitized and must be non-empty.
 */
export async function loadIdentitySettings(
  root: string,
  env: EnvReader = Deno.env,
): Promise<IdentitySettings> {
  let rawSlug = env.get("DISCERN_PROJECT_SLUG") ?? "";
  let branchPrefix = env.get("DISCERN_WORKTREE_BRANCH_PREFIX");
  if (rawSlug === "" || branchPrefix === undefined) {
    // Tolerant config read: a missing or invalid toml just leaves the defaults in
    // place (worktree naming must work even when the config is mid-edit).
    let config: DiscernConfig | undefined;
    try {
      config = await loadConfig(root);
    } catch {
      config = undefined;
    }
    if (rawSlug === "") {
      rawSlug = config?.project.slug ?? "";
    }
    if (branchPrefix === undefined) {
      branchPrefix = config?.project.branch_prefix ?? "agent/";
    }
  }
  const slug = sanitizeSlug(rawSlug);
  if (slug === "") {
    throw new IdentityError(
      "identity: project slug resolved to an empty value (set [project].slug or DISCERN_PROJECT_SLUG).",
    );
  }
  return { slug, branchPrefix };
}

/** Run a git subcommand for a target path, returning trimmed stdout or undefined. */
async function gitOut(
  target: string,
  args: string[],
): Promise<string | undefined> {
  const r = await runGit(args, { cwd: target });
  if (!r.success) {
    return undefined;
  }
  const text = r.stdout.trim();
  return text === "" ? undefined : text;
}

/**
 * Canonicalize a target path, tolerating one that no longer exists by
 * canonicalizing its parent and re-appending the basename.
 * discern-allow-retrospective: runtime — the target path may be absent.
 */
async function canonicalizeTarget(path: string): Promise<string> {
  try {
    if ((await Deno.stat(path)).isDirectory) {
      return await Deno.realPath(path);
    }
  } catch {
    // not a directory we can stat — fall through to the parent strategy
  }
  const parent = dirname(path);
  try {
    if ((await Deno.stat(parent)).isDirectory) {
      return join(await Deno.realPath(parent), basename(path));
    }
  } catch {
    // parent missing too — return the path unchanged
  }
  return path;
}

/** Strip one layer of surrounding whitespace and matching quotes from a value. */
function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Read an `DISCERN_WORKTREE_ID` override from the target's `.env`, if present. */
async function readDotenvId(target: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(target, ".env"));
  } catch {
    return undefined; // no .env
  }
  for (const line of text.split("\n")) {
    if (line.startsWith("DISCERN_WORKTREE_ID=")) {
      return stripOuterQuotes(line.slice("DISCERN_WORKTREE_ID=".length));
    }
  }
  return undefined;
}

/** Resolve a possibly-relative git-common-dir against a base, then canonicalize. */
async function normalizeCommonGitDir(
  base: string,
  raw: string,
): Promise<string> {
  const abs = isAbsolute(raw) ? raw : resolve(base, raw);
  try {
    return await Deno.realPath(abs);
  } catch {
    return abs;
  }
}

/**
 * Derive the id from git's linked-worktree admin directory name. Refuses the
 * main checkout (where the absolute and common git dirs are the same path).
 * Falls back to reading a `.git` gitlink file directly. Throws an
 * `IdentityError` when no linked-worktree metadata can be resolved.
 */
async function metadataIdFromGit(path: string): Promise<string> {
  let isDir = false;
  try {
    isDir = (await Deno.stat(path)).isDirectory;
  } catch {
    isDir = false;
  }

  if (isDir) {
    const gitDir = await gitOut(path, ["rev-parse", "--absolute-git-dir"]);
    if (gitDir !== undefined) {
      const commonRaw = await gitOut(path, ["rev-parse", "--git-common-dir"]);
      const commonGitDir = await normalizeCommonGitDir(path, commonRaw ?? "");
      if (gitDir === commonGitDir) {
        throw new IdentityError(
          "identity: refused - target is the main checkout, not a linked worktree.",
        );
      }
      return basename(gitDir);
    }
  }

  // Fall back to a `.git` gitlink file (a worktree whose checkout git cannot run
  // rev-parse against, but whose link still points at its admin dir).
  let linkText: string | undefined;
  try {
    linkText = await Deno.readTextFile(join(path, ".git"));
  } catch {
    linkText = undefined;
  }
  if (linkText !== undefined) {
    const firstLine = linkText.split("\n")[0] ?? "";
    if (firstLine.startsWith("gitdir: ")) {
      let linkDir = firstLine.slice("gitdir: ".length);
      if (!isAbsolute(linkDir)) {
        linkDir = join(path, linkDir);
      }
      return basename(linkDir);
    }
  }

  throw new IdentityError(
    `identity: could not resolve linked-worktree metadata for ${path}.`,
  );
}

/**
 * Resolve only the worktree id (the basis for every derived value), applying the
 * three-source precedence and the slug-collision `wt-` prefix. `target` defaults
 * to the cwd.
 */
export async function resolveWorktreeId(
  settings: IdentitySettings,
  target: string = Deno.cwd(),
  env: EnvReader = Deno.env,
): Promise<string> {
  const canonical = await canonicalizeTarget(target);

  const envOverride = env.get("DISCERN_WORKTREE_ID");
  if (envOverride !== undefined && envOverride !== "") {
    return validateOverrideId(envOverride);
  }

  const dotenvId = await readDotenvId(canonical);
  if (dotenvId !== undefined && dotenvId !== "") {
    return validateOverrideId(dotenvId);
  }

  const rawId = await metadataIdFromGit(canonical);
  const id = sanitizeSlug(rawId);
  if (id === "") {
    throw new IdentityError(
      `identity: git metadata id '${rawId}' did not contain any safe characters.`,
    );
  }

  // If the metadata id collides with the project slug (e.g. the admin dir was
  // named after the project), prefix it so the identity stays distinct.
  if (
    id === settings.slug ||
    new RegExp(`^${escapeRe(settings.slug)}[0-9]+$`).test(id)
  ) {
    return `wt-${id}`;
  }
  return id;
}

/** Escape a string for safe embedding into a RegExp (the slug, which is `[a-z0-9-]`). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve the full identity for a target worktree (default: the cwd), loading
 * project settings from `root` and applying all three id sources. This is the
 * high-level entry the lifecycle/token layers use.
 */
export async function resolveIdentity(
  root: string,
  target: string = Deno.cwd(),
): Promise<WorktreeIdentity> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  return deriveIdentity(id, settings);
}
