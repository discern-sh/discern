/**
 * Per-worktree external resources — the generic seam a project wires arbitrary
 * `create`/`destroy`/`ensure` commands into, plus the ledger that makes orphan
 * garbage-collection possible.
 *
 * A resource (`[worktree.resources.<name>]`) is an external thing — a database, a
 * container, an emulator, a queue — that must exist for exactly the lifetime of a
 * worktree: CREATED once at setup, REUSED by every later command, DESTROYED once
 * at teardown. discern provides the orchestration and the GC; the project provides
 * the commands. The engine never learns what the resource actually is.
 *
 * The ledger lives under `<git-common-dir>/discern/resources/`, one JSON file per
 * (worktree, resource). It survives worktree removal (it is a sibling of git's own
 * `worktrees/` admin area, not inside the checkout), is shared across a repo's
 * worktrees (they share the common dir), is per-project (each repo has its own
 * `.git`), and is untracked. When a worktree vanishes without a clean teardown,
 * its entries are the orphan record — and the ONLY thing GC ever acts on, so GC can
 * never touch a resource discern did not create for THIS project.
 *
 * Safety invariants (each pins a way GC could otherwise destroy the wrong thing):
 *  - the ledger keys on the git admin-dir basename (`git_key`), never the path;
 *  - `destroy` is the command FROZEN (fully expanded) at create time — the worktree
 *    is gone at GC, so identity cannot be re-derived;
 *  - a frozen command still carrying an `@token@` is refused, never half-run;
 *  - an orphan whose identity is currently owned by a LIVE worktree is kept;
 *  - deletion is compare-and-swap, so a reused key's fresh entry is never dropped.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { z } from "@zod/zod";
import type { Logger } from "../../lib/log.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { GIT_ADMIN_STATE } from "../../shared/git_admin_state.ts";
import {
  type IdentitySettings,
  resourceForId,
  worktreeBase,
  type WorktreeIdentity,
} from "./identity.ts";
import { expandTokens, WORKTREE_TOKENS } from "./tokens.ts";
import type { TokenResolver, WorktreeToken } from "./tokens.ts";
import { runShellRouted } from "./shell.ts";
import { gitKeyIsLive, WorktreeGitError, writeWorktreeEnvVar } from "./git.ts";

/** The ledger entry format version (forward-compat: GC skips unknown majors). */
const LEDGER_SCHEMA = 1;

/** The most retries honoured for a flaky create/destroy (a runaway guard). */
const MAX_RETRIES = 5;

/** The minimal slice of the lifecycle context the resource layer needs (kept
 * structural so it never imports `LifecycleContext` — that would cycle). */
export interface ResourceContext {
  config: DiscernConfig;
  log: Logger;
  /** The directory commands run from (the worktree root, or main for GC). */
  cwd: string;
}

/** One declared `[worktree.resources.<name>]`. */
export interface ResourceSpec {
  name: string;
  /** Command run once at setup (empty = no-op). */
  create: string;
  /** Command run once at teardown (empty = nothing to tear down / GC). */
  destroy: string;
  /** Optional idempotent re-readiness, run at session start. */
  ensure: string;
  /** A failed `create` aborts setup (default true), or warns and continues. */
  required: boolean;
  /** Retries for create/destroy on a non-zero exit, with backoff (default 0). */
  retries: number;
  /** May orphan-GC reclaim this resource? (default true; opt out for data-loss-
   * sensitive resources so they are only torn down via explicit teardown). */
  gc: boolean;
}

/** The ledger entry shape AND its read-time validator — one source for both. A
 * file under the ledger dir is trusted only if it parses to this exact shape with a
 * recognised `schema` major; anything else (a corrupt write, a hand-edit, a future
 * format) is skipped, never half-read. */
const resourceEntrySchema = z.object({
  /** Entry-format major; a foreign/newer value fails validation and is skipped. */
  schema: z.literal(LEDGER_SCHEMA),
  /** Document-order index at creation — destroy runs in reverse. */
  seq: z.number(),
  project_slug: z.string(),
  /** PRIMARY key: the `<common>/worktrees/<git_key>` admin-dir basename. */
  git_key: z.string(),
  /** The resolved worktree id (diagnostic; may differ from git_key via overrides). */
  worktree_id: z.string(),
  /** Canonical worktree path at write time (secondary GC guard + label). */
  worktree_path: z.string(),
  resource_name: z.string(),
  /** The resource's handle (e.g. the db/container name) — the recycling-guard key. */
  resource_identity: z.string(),
  /** The `destroy` command FULLY EXPANDED at create time (authoritative for GC). */
  destroy_command: z.string(),
  /** Every `@token@` the create/destroy templates named, resolved (diagnostic). */
  token_map: z.record(z.string(), z.string()),
  /** Retries to honour when running destroy. */
  retries: z.number(),
  /** Whether orphan GC may reclaim this resource. */
  gc: z.boolean(),
  created_at: z.string(),
});

/** One ledger entry — the ownership proof + everything GC needs once the worktree
 * is gone. Inferred from {@link resourceEntrySchema}, so the entry shape and the
 * read-time validation can never drift apart. */
export type ResourceEntry = z.infer<typeof resourceEntrySchema>;

/** Read the declared resources in document order (the create/destroy order). */
export function readResourceSpecs(config: DiscernConfig): ResourceSpec[] {
  return Object.entries(config.worktree.resources).map(([name, r]) => ({
    name,
    create: r.create,
    destroy: r.destroy,
    ensure: r.ensure,
    required: r.required,
    retries: clampRetries(r.retries),
    gc: r.gc,
  }));
}

/** Clamp a configured retry count into `[0, MAX_RETRIES]`. */
function clampRetries(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.min(Math.floor(n), MAX_RETRIES);
}

/**
 * Build the token resolver for a resource command. `@db@`/`@site@`/`@port@` come
 * from the resolved identity, `@project_slug@` from the raw config slug, `@dir@`
 * from the worktree root, `@worktree@` from the base handle, and `@resource@` from
 * THIS resource's handle (empty when unbound, e.g. in `[worktree.setup].steps`).
 */
export function buildTokenResolver(
  identity: WorktreeIdentity,
  settings: IdentitySettings,
  config: DiscernConfig,
  worktreeRoot: string,
  resourceName?: string,
): TokenResolver {
  return (token: WorktreeToken): string => {
    switch (token) {
      case "db":
        return identity.db;
      case "site":
        return identity.site;
      case "port":
        return String(identity.port);
      case "project_slug":
        return config.project.slug;
      case "dir":
        return worktreeRoot;
      case "worktree":
        return worktreeBase(settings.slug, identity.id);
      case "resource":
        return resourceName === undefined
          ? ""
          : resourceForId(settings.slug, identity.id, resourceName);
    }
  };
}

/** The runtime-discovery env var name for a resource (`DISCERN_RESOURCE_<NAME>`). */
export function resourceEnvName(name: string): string {
  const tail = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
  return DISCERN_ENVIRONMENT_VARIABLES.resource.replace("<NAME>", tail);
}

// ── ledger I/O ──────────────────────────────────────────────────────────────

/** The ledger directory for this repo: `<common-git-dir>/discern/resources/`. */
export function resourcesDir(commonGitDir: string): string {
  return join(commonGitDir, GIT_ADMIN_STATE.resources.path);
}

/** A filesystem-safe component for an entry filename. */
function fsafe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_");
}

/** The entry file path for a (git_key, resource) pair. */
function entryPath(commonGitDir: string, gitKey: string, name: string): string {
  return join(
    resourcesDir(commonGitDir),
    `${fsafe(gitKey)}__${fsafe(name)}.json`,
  );
}

/** Write a ledger entry atomically (temp-in-dir + rename within the filesystem). */
export async function writeEntry(
  commonGitDir: string,
  entry: ResourceEntry,
): Promise<void> {
  const dir = resourcesDir(commonGitDir);
  await ensureDir(dir);
  const path = entryPath(commonGitDir, entry.git_key, entry.resource_name);
  const tmp = `${path}.${Deno.pid}.tmp`;
  await Deno.writeTextFile(tmp, `${JSON.stringify(entry, null, 2)}\n`);
  await Deno.rename(tmp, path);
}

/** Read one entry, tolerating a missing/corrupt/unknown-schema/malformed file
 * (→ undefined). The shape is validated against {@link resourceEntrySchema}, so a
 * file that parses as JSON but isn't a well-formed entry is skipped, not trusted. */
export async function readEntry(
  path: string,
): Promise<ResourceEntry | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const result = resourceEntrySchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** Every ledger entry for this repo (skipping unreadable/foreign files). */
export async function listEntries(
  commonGitDir: string,
): Promise<{ path: string; entry: ResourceEntry }[]> {
  const dir = resourcesDir(commonGitDir);
  const out: { path: string; entry: ResourceEntry }[] = [];
  let names: string[];
  try {
    names = [];
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".json")) {
        names.push(e.name);
      }
    }
  } catch {
    return out; // no ledger yet
  }
  for (const name of names) {
    const path = join(dir, name);
    const entry = await readEntry(path);
    if (entry !== undefined) {
      out.push({ path, entry });
    }
  }
  return out;
}

/** Remove an entry file, idempotently (a no-op when already gone). */
async function removeEntryFile(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // already gone — fine
  }
}

/**
 * Delete an entry file only if it still holds the entry GC acted on — a
 * compare-and-swap that refuses to drop a fresh entry a reused git_key wrote in
 * the meantime. Returns true when deleted (or already absent).
 */
async function deleteEntryCAS(
  path: string,
  expected: ResourceEntry,
): Promise<boolean> {
  const current = await readEntry(path);
  if (current === undefined) {
    return true; // already gone
  }
  if (sameEntry(expected, current)) {
    await removeEntryFile(path);
    return true;
  }
  return false; // a new tenant rewrote it — leave it alone
}

// ── command execution ─────────────────────────────────────────────────────────

/** Sleep for `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a resource command, retrying a non-zero exit up to `retries` times with a
 * short exponential backoff (for a transient external-manager hiccup). An empty
 * command is a clean success no-op. Returns whether it ultimately succeeded.
 */
async function runWithRetries(
  command: string,
  cwd: string,
  env: Record<string, string>,
  retries: number,
  log: Logger,
): Promise<boolean> {
  if (command.trim() === "") {
    return true;
  }
  for (let attempt = 0;; attempt++) {
    const code = await runShellRouted(command, { cwd, log, env });
    if (code === 0) {
      return true;
    }
    if (attempt >= retries) {
      return false;
    }
    await delay(250 * 2 ** attempt);
    log.warn(`  retrying (attempt ${attempt + 2} of ${retries + 1})…`);
  }
}

/** Canonicalize a path, returning it unchanged when it cannot be resolved. */
async function canonical(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return path;
  }
}

// ── setup: create ─────────────────────────────────────────────────────────────

/**
 * Create every declared resource in document order. For every MANAGED resource
 * (one declaring a `create` and/or a `destroy`), the ledger entry is written FIRST
 * — an intent-log, so a crash mid-create is still GC-able, AND the run-once marker
 * that makes a setup re-entry skip an already-provisioned resource — then `create`
 * runs. A create-only resource records an empty `destroy_command` (nothing to tear
 * down) but is still marked, so its non-idempotent create is never re-run. A failed
 * `create` aborts setup when `required` (the default), else warns and continues.
 * No-op for a resource with neither command.
 */
export async function createResources(
  ctx: ResourceContext,
  identity: WorktreeIdentity,
  settings: IdentitySettings,
  commonGitDir: string,
  gitKey: string,
): Promise<{ failed: string[] }> {
  const specs = readResourceSpecs(ctx.config);
  const worktreePath = await canonical(ctx.cwd);
  const failed: string[] = [];
  let seq = 0;
  for (const spec of specs) {
    const idx = seq++;
    if (spec.create === "" && spec.destroy === "") {
      continue; // an inert resource — nothing to manage
    }
    // Already provisioned? A ledger entry for this (worktree, resource) is the proof
    // `create` already ran — it is the intent-log written just before create. Re-
    // entering setup (a re-fired create hook, a recovered partial setup, an explicit
    // `discern worktree setup`) must NOT re-run create: a `createdb` / `docker run --name`
    // is not idempotent, and its "already exists" non-zero exit would abort an
    // already-good worktree. Skip it; session-start `ensure` re-readies it if asked.
    // The marker is written for EVERY managed resource (create-only included), so
    // the run-once guard covers all of them, not just the destroy-declaring subset.
    if (
      (await readEntry(entryPath(commonGitDir, gitKey, spec.name))) !==
        undefined
    ) {
      ctx.log.info(
        `Worktree resource '${spec.name}' already provisioned — skipping create.`,
      );
      continue;
    }
    const resolver = buildTokenResolver(
      identity,
      settings,
      ctx.config,
      ctx.cwd,
      spec.name,
    );
    const resourceIdentity = resourceForId(
      settings.slug,
      identity.id,
      spec.name,
    );

    // The intent-log / run-once marker: written FIRST for every managed resource
    // (past the inert-skip above, so create and/or destroy is non-empty). A
    // create-only resource records an empty `destroy_command` — nothing to tear
    // down or GC — but its presence is what stops a re-entry re-running create.
    await writeEntry(commonGitDir, {
      schema: LEDGER_SCHEMA,
      seq: idx,
      project_slug: ctx.config.project.slug,
      git_key: gitKey,
      worktree_id: identity.id,
      worktree_path: worktreePath,
      resource_name: spec.name,
      resource_identity: resourceIdentity,
      destroy_command: await expandTokens(spec.destroy, resolver),
      token_map: await captureTokenMap([spec.create, spec.destroy], resolver),
      retries: spec.retries,
      gc: spec.gc,
      created_at: new Date().toISOString(),
    });

    if (spec.create !== "") {
      ctx.log.info(`Creating worktree resource '${spec.name}'…`);
      const ok = await runWithRetries(
        await expandTokens(spec.create, resolver),
        ctx.cwd,
        resourceCommandEnv(spec.name, resourceIdentity, settings, identity),
        spec.retries,
        ctx.log,
      );
      if (!ok) {
        if (spec.required) {
          throw new WorktreeGitError(
            `Creating required worktree resource '${spec.name}' failed. Fix its ` +
              `configured create command or prerequisites, then re-run ` +
              `\`discern worktree setup\`.`,
          );
        }
        ctx.log.warn(
          `Worktree resource '${spec.name}' create failed (required = false) — continuing.`,
        );
        failed.push(spec.name);
      }
    }
  }
  return { failed };
}

/** Resolve every token a set of command templates names, for the ledger token_map. */
async function captureTokenMap(
  commands: string[],
  resolver: TokenResolver,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const token of WORKTREE_TOKENS) {
    const placeholder = `@${token}@`;
    if (commands.some((c) => c.includes(placeholder))) {
      map[token] = await resolver(token);
    }
  }
  return map;
}

/** The env a resource command runs with: its own handle + the worktree base. */
function resourceCommandEnv(
  name: string,
  resourceIdentity: string,
  settings: IdentitySettings,
  identity: WorktreeIdentity,
): Record<string, string> {
  return {
    [resourceEnvName(name)]: resourceIdentity,
    [DISCERN_ENVIRONMENT_VARIABLES.worktree]: worktreeBase(
      settings.slug,
      identity.id,
    ),
  };
}

/**
 * Record the worktree's resource handles into its env files
 * (`[worktree].env_files`) for runtime discovery — `DISCERN_WORKTREE` plus
 * `DISCERN_RESOURCE_<NAME>` per declared resource — each equal to what `create`
 * used. A no-op when nothing is declared or no env file exists (the handles stay
 * discoverable via `discern identity --resource`).
 */
export async function recordResourceEnv(
  ctx: ResourceContext,
  identity: WorktreeIdentity,
  settings: IdentitySettings,
): Promise<void> {
  const specs = readResourceSpecs(ctx.config).filter(
    (s) => s.create !== "" || s.destroy !== "",
  );
  if (specs.length === 0) {
    return;
  }
  const files = ctx.config.worktree.env_files;
  await writeWorktreeEnvVar(
    ctx.cwd,
    DISCERN_ENVIRONMENT_VARIABLES.worktree,
    worktreeBase(settings.slug, identity.id),
    files,
  );
  for (const spec of specs) {
    await writeWorktreeEnvVar(
      ctx.cwd,
      resourceEnvName(spec.name),
      resourceForId(settings.slug, identity.id, spec.name),
      files,
    );
  }
}

// ── teardown: destroy ─────────────────────────────────────────────────────────

/**
 * This worktree's ledger entries in DESTRUCTION order — every entry for `gitKey`,
 * sorted by reverse creation seq (so a dependency created first is destroyed
 * last). The read-only basis of both the teardown plan and `destroyResources`.
 */
export async function entriesForWorktree(
  commonGitDir: string,
  gitKey: string,
): Promise<LedgerItem[]> {
  return (await listEntries(commonGitDir))
    .filter((e) => e.entry.git_key === gitKey)
    .sort((a, b) => b.entry.seq - a.entry.seq);
}

/**
 * Tear down a worktree's resources — destroy each of the GIVEN ledger entries (the
 * teardown plan, already in reverse-creation order, so a dependency created first
 * is destroyed last). Runs the FROZEN destroy command (what was true at create),
 * best-effort and idempotent. The caller passes the entries it planned from, so
 * apply acts on exactly the previewed set — there is no re-read that could drift
 * from the plan. An entry is cleared only on success; a failed destroy keeps it so
 * a later `worktree prune` retries (self-healing). Returns which resources were
 * destroyed and which were kept-for-retry.
 */
export async function destroyResources(
  ctx: ResourceContext,
  entries: LedgerItem[],
): Promise<{ destroyed: string[]; failed: string[] }> {
  const destroyed: string[] = [];
  const failed: string[] = [];
  for (const { path, entry } of entries) {
    ctx.log.info(`Destroying worktree resource '${entry.resource_name}'…`);
    if (await runDestroyEntry(entry, ctx.cwd, ctx.log)) {
      await removeEntryFile(path);
      destroyed.push(entry.resource_name);
    } else {
      ctx.log.warn(
        `Worktree resource '${entry.resource_name}' destroy reported an error — keeping its ledger entry for prune to retry.`,
      );
      failed.push(entry.resource_name);
    }
  }
  return { destroyed, failed };
}

/**
 * Run a ledger entry's frozen destroy command. Refuses a command still carrying an
 * `@token@` (an unresolved capture — a half-run could be destructive). Best-effort,
 * with the entry's retry budget. Returns whether destroy succeeded.
 */
async function runDestroyEntry(
  entry: ResourceEntry,
  cwd: string,
  log: Logger,
): Promise<boolean> {
  const command = entry.destroy_command;
  if (command.trim() === "") {
    return true;
  }
  if (/@[a-z_]+@/.test(command)) {
    log.warn(
      `Worktree resource '${entry.resource_name}' has an unresolved token in its destroy command — skipping it.`,
    );
    return false;
  }
  return await runWithRetries(
    command,
    cwd,
    { [resourceEnvName(entry.resource_name)]: entry.resource_identity },
    entry.retries,
    log,
  );
}

// ── session start: ensure (drift reconciliation, R11) ─────────────────────────

/**
 * Re-ready any resource that declares an `ensure` command — the idempotent
 * reconcile point for a resource that died out-of-band (a host reboot stopped a
 * running instance). Run at session start once the worktree is already configured.
 * Best-effort; a no-op for resources with no `ensure`.
 */
export async function ensureResources(
  ctx: ResourceContext,
  identity: WorktreeIdentity,
  settings: IdentitySettings,
): Promise<void> {
  const specs = readResourceSpecs(ctx.config).filter((s) => s.ensure !== "");
  for (const spec of specs) {
    const resolver = buildTokenResolver(
      identity,
      settings,
      ctx.config,
      ctx.cwd,
      spec.name,
    );
    ctx.log.info(`Ensuring worktree resource '${spec.name}'…`);
    const ok = await runWithRetries(
      await expandTokens(spec.ensure, resolver),
      ctx.cwd,
      resourceCommandEnv(
        spec.name,
        resourceForId(settings.slug, identity.id, spec.name),
        settings,
        identity,
      ),
      spec.retries,
      ctx.log,
    );
    if (!ok) {
      ctx.log.warn(
        `Worktree resource '${spec.name}' ensure reported an error — continuing.`,
      );
    }
  }
}

// ── prune: orphan garbage-collection ──────────────────────────────────────────

/** Inputs for {@link gcOrphanResources}. */
export interface GcParams {
  /** The repo's common git dir (where the ledger lives). */
  commonGitDir: string;
  /** Where destroy commands run (the main checkout). */
  cwd: string;
  /** Live worktree keys (admin-dir basenames whose checkout still exists). */
  liveGitKeys: Set<string>;
  /** Canonical paths of currently-registered worktrees (secondary guard). */
  livePaths: Set<string>;
  /** Resource handles currently owned by live worktrees (recycling guard). */
  liveIdentities: Set<string>;
  /**
   * Re-check, against CURRENT disk state, whether a resource handle is owned by a
   * live worktree — the recycling guard re-evaluated right before each irreversible
   * destroy. The snapshot `liveIdentities` is taken once; a long GC loop can run for
   * seconds, during which a concurrent worktree-create can recycle this HANDLE under
   * a DIFFERENT git_key (so the `gitKeyIsLive` re-check alone misses it). Returns
   * true to KEEP the entry. Optional: when absent, only the snapshot guards it.
   */
  recheckIdentityLive?: (identity: string) => Promise<boolean>;
  /** Report what would be reclaimed without acting. */
  dryRun: boolean;
  log: Logger;
}

/** Inputs for applying an already-classified orphan-resource GC plan. */
export interface PlannedGcParams {
  /** The repo's common git dir (where the ledger lives). */
  commonGitDir: string;
  /** Where destroy commands run (the main checkout). */
  cwd: string;
  /** Ledger entries the plan classified as reclaimable. */
  reclaimable: LedgerItem[];
  /** Entries kept during the plan's classification. */
  kept: number;
  /**
   * Re-check, against CURRENT disk state, whether a resource handle is owned by a
   * live worktree — the recycling guard re-evaluated right before each irreversible
   * destroy. Returns true to KEEP the entry.
   */
  recheckIdentityLive?: (identity: string) => Promise<boolean>;
  log: Logger;
}

/** The outcome of an orphan-resource GC pass. */
export interface GcResult {
  /** Resource handles reclaimed (or that would be, in a dry run). */
  reclaimed: string[];
  /** Entries kept (live, guarded, or GC-opted-out). */
  kept: number;
  /** Whether any destroy failed (its entry is kept for a later retry). */
  failed: boolean;
}

/** A ledger entry paired with its on-disk path (the unit GC and the plan act on). */
export interface LedgerItem {
  path: string;
  entry: ResourceEntry;
}

/** The live-worktree snapshot the orphan classifier reasons against. */
export interface LiveWorktrees {
  /** Admin-dir basenames (`git_key`) whose checkout still exists. */
  gitKeys: Set<string>;
  /** Canonical paths of currently-registered worktrees. */
  paths: Set<string>;
  /** Resource handles currently owned by live worktrees (recycling guard). */
  identities: Set<string>;
}

/** A ledger split into the orphans GC may reclaim and a count of those it keeps. */
export interface OrphanClassification {
  /** Entries whose worktree is provably gone and that GC may reclaim. */
  reclaimable: LedgerItem[];
  /** Count of entries kept: live, path/handle-guarded, or `gc = false`. */
  kept: number;
}

/**
 * The PURE orphan-reclaim DECISION: given the ledger and the live-worktree
 * snapshot, which entries are orphans GC may reclaim and how many it keeps. An
 * entry is KEPT when its worktree is still live (by git_key, path, OR resource
 * handle — the recycling guard) or it opted out of GC (`gc = false`); everything
 * else is reclaimable. No I/O — the liveness sets and the ledger are passed in, so
 * this is unit-testable in microseconds and is the load-bearing safety logic the
 * effectful `gcOrphanResources` and the prune plan both build on (ADR 0027).
 */
export function classifyOrphans(
  entries: LedgerItem[],
  live: LiveWorktrees,
): OrphanClassification {
  const reclaimable: LedgerItem[] = [];
  let kept = 0;
  for (const item of entries) {
    const e = item.entry;
    const isLive = live.gitKeys.has(e.git_key) ||
      live.paths.has(e.worktree_path) ||
      live.identities.has(e.resource_identity);
    if (isLive || e.gc === false) {
      kept++;
      continue;
    }
    reclaimable.push(item);
  }
  return { reclaimable, kept };
}

/**
 * Reclaim resources whose worktree vanished without a clean teardown. CONSERVATIVE
 * by construction: it only ever runs a destroy command that is IN this project's
 * ledger, and only when the owning worktree is provably gone (its `git_key` is not
 * live) AND no live worktree still holds the path or the resource handle. A
 * `gc = false` entry is never reclaimed here (teardown-only). Deletion is
 * compare-and-swap. Best-effort: a failed destroy keeps the entry to retry.
 *
 * The liveness sets passed in are a SNAPSHOT; the destroy loop can run for
 * seconds, during which a concurrent worktree-create can recycle a freed git_key
 * (rewriting its ledger entry) OR recycle this resource's HANDLE under a different
 * git_key. So immediately before each destroy we re-validate AGAINST DISK on all
 * three axes — a fresh `gitKeyIsLive` check, an entry re-read, and a fresh
 * `recheckIdentityLive` handle check — and skip if any says the entry is now a live
 * tenant's. That closes the window where GC would otherwise destroy a fresh
 * worktree's live resource.
 */
export async function gcOrphanResources(p: GcParams): Promise<GcResult> {
  const { reclaimable, kept } = classifyOrphans(
    await listEntries(p.commonGitDir),
    {
      gitKeys: p.liveGitKeys,
      paths: p.livePaths,
      identities: p.liveIdentities,
    },
  );
  if (p.dryRun) {
    const result: GcResult = { reclaimed: [], kept, failed: false };
    for (const { entry } of reclaimable) {
      const label =
        `${entry.resource_name} (${entry.resource_identity}) from removed worktree ${entry.git_key}`;
      p.log.line(`  would reclaim ${label}`);
      result.reclaimed.push(entry.resource_identity);
    }
    return result;
  }
  return await gcPlannedOrphanResources({
    commonGitDir: p.commonGitDir,
    cwd: p.cwd,
    reclaimable,
    kept,
    ...(p.recheckIdentityLive !== undefined
      ? { recheckIdentityLive: p.recheckIdentityLive }
      : {}),
    log: p.log,
  });
}

/** Apply an already-classified orphan-resource GC plan, with per-entry rechecks. */
export async function gcPlannedOrphanResources(
  p: PlannedGcParams,
): Promise<GcResult> {
  const result: GcResult = { reclaimed: [], kept: p.kept, failed: false };
  for (const { path, entry } of p.reclaimable) {
    const label =
      `${entry.resource_name} (${entry.resource_identity}) from removed worktree ${entry.git_key}`;
    // Re-validate against disk right before destroying (see the doc comment): the
    // git_key must still be dead, the on-disk entry must still be the one we read,
    // AND no live worktree may now own this handle — else a concurrent create
    // recycled the key or the handle, and this is a live tenant.
    if (
      await gitKeyIsLive(p.commonGitDir, entry.git_key) ||
      !sameEntry(entry, await readEntry(path)) ||
      (p.recheckIdentityLive !== undefined &&
        await p.recheckIdentityLive(entry.resource_identity))
    ) {
      result.kept++;
      continue;
    }
    p.log.line(`  reclaiming ${label}…`);
    if (await runDestroyEntry(entry, p.cwd, p.log)) {
      if (await deleteEntryCAS(path, entry)) {
        result.reclaimed.push(entry.resource_identity);
      }
    } else {
      result.failed = true; // keep the entry for a later retry
    }
  }
  return result;
}

/** Whether `b` is the same ledger entry `a` was read as (the CAS identity:
 * git_key + resource_identity + created_at). False when `b` is missing/replaced. */
function sameEntry(a: ResourceEntry, b: ResourceEntry | undefined): boolean {
  return b !== undefined && b.git_key === a.git_key &&
    b.resource_identity === a.resource_identity &&
    b.created_at === a.created_at;
}
