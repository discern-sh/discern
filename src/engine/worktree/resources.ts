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
 *  - ownership, worktree handle, and `destroy` (fully expanded) are persisted as
 *    an `intent` before create; only a successful create advances it to `ready`;
 *  - a frozen command still carrying an `@token@` is refused, never half-run;
 *  - an orphan whose identity is currently owned by a LIVE worktree is kept;
 *  - deletion is compare-and-swap, so a reused key's fresh entry is never dropped.
 */
import { currentOperationSignal } from "../../shared/operation_signal.ts";
import { withResourceOwnership } from "../operation_lock.ts";

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { z } from "@zod/zod";
import type { Logger } from "../../lib/log.ts";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { GIT_ADMIN_STATE } from "../../shared/git_admin_state.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import {
  type IdentitySettings,
  resourceForId,
  worktreeBase,
  type WorktreeIdentity,
} from "./identity.ts";
import { expandTokens, WORKTREE_TOKENS } from "./tokens.ts";
import type { TokenResolver, WorktreeToken } from "./tokens.ts";
import { runShellRouted } from "./shell.ts";
import {
  gitKeyIsLive,
  resolveCommonGitDir,
  WorktreeGitError,
  writeWorktreeEnvVar,
} from "./git.ts";
import { type Clock, SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";

/** The resource-ledger format version. Registered with every durable format. */
export const RESOURCE_LEDGER_SCHEMA = ON_DISK_FORMATS.resourceLedger.version;

/** The minimal slice of the lifecycle context the resource layer needs (kept
 * structural so it never imports `LifecycleContext` — that would cycle). */
export interface ResourceContext {
  config: DiscernConfig;
  log: Logger;
  /** The directory commands run from (the worktree root, or main for GC). */
  cwd: string;
  /** Wall timestamp source for durable resource records. */
  clock?: Clock;
  /** Retry and child-lifecycle timer capability. */
  scheduler?: Scheduler;
  signal?: AbortSignal;
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

/** A required resource lifecycle command failed with its config identity intact. */
export class WorktreeResourceError extends WorktreeGitError {
  constructor(
    readonly resourceName: string,
    readonly operation: "create",
    message: string,
  ) {
    super(message);
    this.name = "WorktreeResourceError";
  }
}

/** The ledger entry shape AND its read-time validator — one source for both. A
 * file under the ledger dir is trusted only if it parses to this exact shape with a
 * recognised `schema` major. Corrupt content is skipped; forward skew is
 * classified separately so no older writer or cleanup can replace it. */
const resourceEntrySchema = z.object({
  /** Entry-format major supplied by the durable-format registry. */
  schema: z.literal(RESOURCE_LEDGER_SCHEMA),
  /** Create reconciliation phase: uncertain ownership intent or proven ready. */
  phase: z.enum(["intent", "ready"]),
  /** Document-order index at creation — destroy runs in reverse. */
  seq: z.number(),
  project_slug: z.string(),
  /** PRIMARY key: the `<common>/worktrees/<git_key>` admin-dir basename. */
  git_key: z.string(),
  /** The resolved worktree id (diagnostic; may differ from git_key via overrides). */
  worktree_id: z.string(),
  /** Frozen base handle supplied to create, ensure, and destroy commands. */
  worktree_handle: z.string(),
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
    retries: r.retries,
    gc: r.gc,
  }));
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
  const standing = await inspectResourceEntry(path);
  if (standing.status === "newer") {
    throw new Error(standing.reason);
  }
  await atomicReplaceJson(path, {
    ...entry,
    schema: ON_DISK_FORMATS.resourceLedger.version,
  }, {
    mode: 0o666,
    sync: false,
    space: 2,
    trailingNewline: true,
  });
}

export type ResourceEntryRead =
  | { readonly status: "recorded"; readonly entry: ResourceEntry }
  | { readonly status: "missing" | "malformed" }
  | { readonly status: "newer"; readonly reason: string };

/** Inspect one ledger entry without collapsing forward skew into corruption. */
export async function inspectResourceEntry(
  path: string,
): Promise<ResourceEntryRead> {
  const text = await readTextIfExists(path);
  if (text === undefined) return { status: "missing" };
  return parseResourceEntry(text);
}

/** Decode the same frozen ledger bytes from common recovery without consulting new config. */
export function parseResourceEntry(text: string): ResourceEntryRead {
  const version = inspectOnDiskJsonVersion("resourceLedger", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("resourceLedger", version.found),
    };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const result = resourceEntrySchema.safeParse(parsed);
    return result.success
      ? { status: "recorded", entry: result.data }
      : { status: "malformed" };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: resource-ledger-decode-fallback
    return { status: "malformed" };
  }
}

/** Read one entry as an optional current record. Callers that mutate or report
 * state use {@link inspectResourceEntry} so forward skew remains explicit. */
export async function readEntry(
  path: string,
): Promise<ResourceEntry | undefined> {
  const read = await inspectResourceEntry(path);
  return read.status === "recorded" ? read.entry : undefined;
}

/** Every current ledger entry for this repo. */
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

/** Report whether the observed ledger entry was actually removed. */
async function removeEntryFile(path: string): Promise<boolean> {
  let removed = false;
  await bestEffort("resource-ledger-entry-remove", async () => {
    await Deno.remove(path);
    removed = true;
  });
  return removed;
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
  const read = await inspectResourceEntry(path);
  if (read.status === "missing") {
    return true; // already gone
  }
  if (read.status !== "recorded") {
    return false;
  }
  if (sameEntry(expected, read.entry)) {
    return await removeEntryFile(path);
  }
  return false; // a new tenant rewrote it — leave it alone
}

// ── command execution ─────────────────────────────────────────────────────────

/** Sleep for `ms` milliseconds. */
function delay(
  ms: number,
  scheduler: Scheduler,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolveDelay) => {
    const finish = (): void => {
      scheduler.cancelTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolveDelay();
    };
    const timer = scheduler.scheduleTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
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
  scheduler: Scheduler,
  signal?: AbortSignal,
): Promise<boolean> {
  signal ??= currentOperationSignal();
  if (command.trim() === "") {
    return true;
  }
  for (let attempt = 0;; attempt++) {
    if (signal?.aborted) return false;
    const code = await runShellRouted(command, {
      cwd,
      log,
      env,
      scheduler,
      ...(signal === undefined ? {} : { signal }),
    });
    if (signal?.aborted) return false;
    if (code === 0) {
      return true;
    }
    if (attempt >= retries) {
      return false;
    }
    await delay(250 * 2 ** attempt, scheduler, signal);
    if (signal?.aborted) return false;
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
 * Create every declared resource in document order. A managed resource persists
 * complete ownership and cleanup intent before create. A successful create is the
 * only transition to `ready`; re-entry skips only `ready`. Re-entry seeing an
 * `intent` first runs its frozen destroy action and compare-and-swap removes the
 * uncertain state. Without a safe, successful cleanup action setup refuses rather
 * than rerunning a possibly non-idempotent create. No-op for an inert resource.
 */
export async function createResources(
  ctx: ResourceContext,
  identity: WorktreeIdentity,
  settings: IdentitySettings,
  commonGitDir: string,
  gitKey: string,
): Promise<{ failed: string[] }> {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const scheduler = ctx.scheduler ?? SYSTEM_SCHEDULER;
  const specs = readResourceSpecs(ctx.config);
  const worktreePath = await canonical(ctx.cwd);
  const failed: string[] = [];
  let seq = 0;
  for (const spec of specs) {
    const idx = seq++;
    if (spec.create === "" && spec.destroy === "") {
      continue; // an inert resource — nothing to manage
    }
    const path = entryPath(commonGitDir, gitKey, spec.name);
    await withResourceOwnership(
      resourcesDir(commonGitDir),
      resourceForId(settings.slug, identity.id, spec.name),
      async () => {
        const existingText = await readTextIfExists(path);
        const existingRead = await inspectResourceEntry(path);
        if (existingRead.status === "newer") {
          throw new WorktreeResourceError(
            spec.name,
            "create",
            `${existingRead.reason} Resource setup left the standing evidence unchanged.`,
          );
        }
        const existing = existingRead.status === "recorded"
          ? existingRead.entry
          : undefined;
        if (existingText !== undefined && existingRead.status === "malformed") {
          throw new WorktreeResourceError(
            spec.name,
            "create",
            `Worktree resource '${spec.name}' has unreadable ownership evidence at ${path}. ` +
              `Restore a valid ledger entry or prove and remove the stale file before retrying setup.`,
          );
        }
        if (existing?.phase === "ready") {
          ctx.log.info(
            `Worktree resource '${spec.name}' already provisioned — skipping create.`,
          );
          return;
        }
        if (existing?.phase === "intent") {
          ctx.log.warn(
            `Worktree resource '${spec.name}' has uncertain create intent — cleaning it before retry.`,
          );
          if (
            !(await cleanupUncertainIntent(
              path,
              existing,
              ctx.cwd,
              ctx.log,
              scheduler,
            ))
          ) {
            throw new WorktreeResourceError(
              spec.name,
              "create",
              `Worktree resource '${spec.name}' may have been partially created, and its frozen cleanup could not prove a safe reset. ` +
                `Repair or remove the external resource, then reconcile its ledger evidence before retrying setup.`,
            );
          }
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

        const intent: ResourceEntry = {
          schema: RESOURCE_LEDGER_SCHEMA,
          phase: "intent",
          seq: idx,
          project_slug: ctx.config.project.slug,
          git_key: gitKey,
          worktree_id: identity.id,
          worktree_handle: worktreeBase(settings.slug, identity.id),
          worktree_path: worktreePath,
          resource_name: spec.name,
          resource_identity: resourceIdentity,
          destroy_command: await expandTokens(spec.destroy, resolver),
          token_map: await captureTokenMap(
            [spec.create, spec.destroy],
            resolver,
          ),
          retries: spec.retries,
          gc: spec.gc,
          created_at: wallTimeIso(clock.wallNow()),
        };
        await writeEntry(commonGitDir, intent);

        if (spec.create !== "") {
          ctx.log.info(`Creating worktree resource '${spec.name}'…`);
          const ok = await runWithRetries(
            await expandTokens(spec.create, resolver),
            ctx.cwd,
            resourceCommandEnv(
              spec.name,
              resourceIdentity,
              worktreeBase(settings.slug, identity.id),
            ),
            spec.retries,
            ctx.log,
            scheduler,
          );
          if (!ok) {
            if (spec.required) {
              throw new WorktreeResourceError(
                spec.name,
                "create",
                `Creating required worktree resource '${spec.name}' failed. Fix its ` +
                  `configured create command or prerequisites, then re-run ` +
                  `\`discern worktree setup\`.`,
              );
            }
            ctx.log.warn(
              `Worktree resource '${spec.name}' create failed (required = false) — continuing.`,
            );
            failed.push(spec.name);
            return;
          }
        }
        await markResourceReady(path, commonGitDir, intent);
      },
    );
  }
  return { failed };
}

/** Advance exactly the intent this create run wrote to ready. */
async function markResourceReady(
  path: string,
  commonGitDir: string,
  intent: ResourceEntry,
): Promise<void> {
  if (!sameEntry(intent, await readEntry(path))) {
    throw new WorktreeResourceError(
      intent.resource_name,
      "create",
      `Worktree resource '${intent.resource_name}' ownership evidence changed during create; refusing to overwrite it.`,
    );
  }
  await writeEntry(commonGitDir, { ...intent, phase: "ready" });
}

/** Clean and remove one uncertain intent before create may be retried. */
async function cleanupUncertainIntent(
  path: string,
  entry: ResourceEntry,
  cwd: string,
  log: Logger,
  scheduler: Scheduler,
): Promise<boolean> {
  return await destroyRecordedEntry(path, entry, cwd, log, scheduler);
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
export function resourceCommandEnv(
  name: string,
  resourceIdentity: string,
  worktreeHandle: string,
): Record<string, string> {
  return {
    [resourceEnvName(name)]: resourceIdentity,
    [DISCERN_ENVIRONMENT_VARIABLES.worktree]: worktreeHandle,
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
 * apply acts on exactly the previewed set. Each effect and deletion rechecks that
 * the frozen ownership still matches. An entry is cleared only on success; a failed destroy keeps it so
 * a later `worktree prune` retries (self-healing). Returns which resources were
 * destroyed and which were kept-for-retry.
 */
export async function destroyResources(
  ctx: ResourceContext,
  entries: LedgerItem[],
): Promise<{ destroyed: string[]; failed: string[] }> {
  const scheduler = ctx.scheduler ?? SYSTEM_SCHEDULER;
  const destroyed: string[] = [];
  const failed: string[] = [];
  for (const { path, entry } of entries) {
    ctx.log.info(`Destroying worktree resource '${entry.resource_name}'…`);
    if (
      await destroyRecordedEntry(
        path,
        entry,
        ctx.cwd,
        ctx.log,
        scheduler,
        ctx.signal,
      )
    ) {
      destroyed.push(entry.resource_name);
    } else {
      ctx.log.warn(
        `Worktree resource '${entry.resource_name}' cleanup failed or its ownership evidence changed — keeping the standing ledger entry for reconciliation.`,
      );
      failed.push(entry.resource_name);
    }
  }
  return { destroyed, failed };
}

/** All resource cleanup rechecks frozen ownership before effects and deletion. */
async function destroyRecordedEntry(
  path: string,
  entry: ResourceEntry,
  cwd: string,
  log: Logger,
  scheduler: Scheduler,
  signal?: AbortSignal,
): Promise<boolean> {
  return await withResourceOwnership(
    dirname(path),
    entry.resource_identity,
    async () => {
      if (
        signal?.aborted || !sameEntry(entry, await readEntry(path))
      ) return false;
      if (!(await runDestroyEntry(entry, cwd, log, scheduler, signal))) {
        return false;
      }
      return await deleteEntryCAS(path, entry);
    },
  );
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
  scheduler: Scheduler,
  signal?: AbortSignal,
): Promise<boolean> {
  const command = entry.destroy_command;
  if (command.trim() === "") {
    if (entry.phase === "ready") return true;
    log.warn(
      `Worktree resource '${entry.resource_name}' has uncertain create intent but no frozen destroy command — cleanup cannot be proved safe.`,
    );
    return false;
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
    resourceCommandEnv(
      entry.resource_name,
      entry.resource_identity,
      entry.worktree_handle,
    ),
    entry.retries,
    log,
    scheduler,
    signal,
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
  options: { readonly required?: boolean } = {},
): Promise<void> {
  const specs = readResourceSpecs(ctx.config).filter((s) => s.ensure !== "");
  if (specs.length === 0) return;
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    throw new WorktreeGitError(
      "Resource convergence requires the repository's ownership ledger.",
    );
  }
  const scheduler = ctx.scheduler ?? SYSTEM_SCHEDULER;
  for (const spec of specs) {
    await withResourceOwnership(
      resourcesDir(commonGitDir),
      resourceForId(settings.slug, identity.id, spec.name),
      async () => {
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
            worktreeBase(settings.slug, identity.id),
          ),
          spec.retries,
          ctx.log,
          scheduler,
        );
        if (!ok) {
          if (options.required) {
            throw new WorktreeGitError(
              `Required resource '${spec.name}' did not converge; preserve its ownership and repair its ensure command.`,
            );
          }
          ctx.log.warn(
            `Worktree resource '${spec.name}' ensure reported an error — continuing.`,
          );
        }
      },
    );
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
  /** Retry and child-lifecycle timer capability. */
  scheduler?: Scheduler;
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
  /** Retry and child-lifecycle timer capability. */
  scheduler?: Scheduler;
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

/** Whether two ordered ledger snapshots carry the same paths and entries. */
export function sameLedgerItems(
  planned: LedgerItem[],
  current: LedgerItem[],
): boolean {
  return planned.length === current.length && planned.every((item, index) => {
    const now = current[index];
    return now !== undefined && item.path === now.path &&
      sameEntry(item.entry, now.entry);
  });
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
    ...(p.scheduler === undefined ? {} : { scheduler: p.scheduler }),
    log: p.log,
  });
}

/** Apply an already-classified orphan-resource GC plan, with per-entry rechecks. */
export async function gcPlannedOrphanResources(
  p: PlannedGcParams,
): Promise<GcResult> {
  const result: GcResult = { reclaimed: [], kept: p.kept, failed: false };
  for (const { path, entry } of p.reclaimable) {
    await withResourceOwnership(
      dirname(path),
      entry.resource_identity,
      async () => {
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
          return;
        }
        p.log.line(`  reclaiming ${label}…`);
        if (
          await destroyRecordedEntry(
            path,
            entry,
            p.cwd,
            p.log,
            p.scheduler ?? SYSTEM_SCHEDULER,
          )
        ) {
          result.reclaimed.push(entry.resource_identity);
        } else {
          result.failed = true; // keep the entry for a later retry
        }
      },
    );
  }
  return result;
}

/** Whether `b` is the exact ledger entry `a` was read as. */
function sameEntry(a: ResourceEntry, b: ResourceEntry | undefined): boolean {
  return b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}
