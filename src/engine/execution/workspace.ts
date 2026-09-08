import { SOURCE_OBSERVATION_FORMAT } from "./snapshot_schema.ts";
import { RECOVERY_MANIFEST_FORMAT } from "./snapshot_schema.ts";
import { RELEASE_OBSERVATION_FORMAT } from "./snapshot_schema.ts";
import { WORKSPACE_STATE_FORMAT } from "./workspace_state.ts";
import { copyRecoveryPayload } from "./payloads.ts";
import { observeSourceSnapshot } from "./source_snapshot.ts";
import { checkoutChangesMessage } from "../../shared/checkout_changes.ts";
/** Git/resource adapter. Its caller must supply the exclusive lifetime capability. */
import { globToRegExp } from "@std/path";
import { decodeBase64 } from "@std/encoding/base64";
import {
  atomicReplaceBytes,
  removeIfExists,
} from "../../shared/atomic_write.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { readTextIfExists, statIfExists } from "../../shared/fs_presence.ts";
import { splitNulRecords } from "../../shared/git_paths.ts";
import {
  deriveIdentity,
  deriveTrunkIdentity,
  type IdentitySettings,
  resolveWorktreeId,
  resourceForId,
  worktreeBase,
} from "../worktree/identity.ts";
import {
  captureWorktreeResourceLedger,
  inspectResourceEntry,
  resourceCommandEnv,
} from "../worktree/resources.ts";
import { expandTokens } from "../worktree/tokens.ts";
import {
  registeredWorktreeRecord,
  resolveCommonGitDir,
  worktreeGitKey,
} from "../worktree/git.ts";
import { spawnJob } from "../jobs/command.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";
import type { EnvironmentDeclaration } from "../../shared/config_schema.ts";
import type { ExecutionEnvironment } from "../completion/environment.ts";
import type { ClaimedExecution } from "../completion/protocol.ts";
import {
  ExecutionIdentitySettingsSchema,
  type WorkspaceState,
  WorkspaceStateSchema,
} from "./workspace_state.ts";
import { loadExecutionIntent } from "./intent.ts";
import { type GitSnapshot, SnapshotSchema } from "./snapshot_schema.ts";
import { readExecutionDocument } from "./artifact_read.ts";
import {
  type CaptureBounds,
  captureGitSnapshot,
  captureGitSnapshotLike,
  containedFile,
  executionGit,
  requireRestorableSnapshot,
  snapshotValue,
} from "./snapshot.ts";
import type {
  ExecutionRecipe,
  ExecutionWorkspace,
  WorkspaceSnapshot,
} from "./types.ts";
import { invalidateGitDiscovery } from "../../shared/git_discovery.ts";

export interface GitExecutionWorkspaceOptions {
  readonly root: string;
  readonly environmentId: string;
  readonly settings: IdentitySettings;
  readonly bounds: CaptureBounds;
  readonly commandTimeoutSeconds: number;
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
}

class GitExecutionWorkspace implements ExecutionWorkspace {
  constructor(readonly options: GitExecutionWorkspaceOptions) {
    if (
      !Number.isFinite(options.commandTimeoutSeconds) ||
      options.commandTimeoutSeconds <= 0
    ) {
      throw new TypeError(
        "Environment commands require a finite positive timeout.",
      );
    }
  }

  async state(
    environment: ExecutionEnvironment,
    declaration: EnvironmentDeclaration | null,
    frozen?: WorkspaceState,
    observation: "source" | "recovery" | "release" =
      frozen?.git?.format === RELEASE_OBSERVATION_FORMAT
        ? "release"
        : frozen?.git?.format === SOURCE_OBSERVATION_FORMAT ||
            declaration === null
        ? "source"
        : "recovery",
    signal?: AbortSignal,
  ): Promise<WorkspaceState> {
    signal?.throwIfAborted();
    const bounds = {
      ...this.options.bounds,
      ...(signal === undefined ? {} : { signal }),
    };
    const settings = frozen?.settings ?? this.options.settings;
    const borrowed = environment.ownership.kind === "borrowed"
      ? environment.ownership
      : null;
    const id = borrowed?.identity.worktree_id ??
      `execution-${this.options.environmentId}`;
    const identity = deriveIdentity(id, settings);
    const resources = frozen?.resources ?? borrowed?.identity.resources ??
      Object.fromEntries(
        (declaration?.resources ?? []).map((
          name,
        ) => [name, resourceForId(settings.slug, id, name)]),
      );
    const base = {
      format: WORKSPACE_STATE_FORMAT,
      settings: ExecutionIdentitySettingsSchema.parse(settings),
      worktree_id: id,
      seed: borrowed?.identity.seed ?? identity.seed,
      resources,
      lifecycle: frozen?.lifecycle ?? await this.freezeLifecycle(
        environment,
        declaration,
        id,
        resources,
      ),
    };
    const exists = await statIfExists(environment.path);
    const registration = await registeredWorktreeRecord(
      environment.path,
      this.options.root,
    );
    if (exists === undefined) {
      if (borrowed !== null || registration !== undefined) {
        throw new Error(
          "An owned checkout is missing; reconcile its Git registration before recovery.",
        );
      }
      return { ...base, git: null, ledger: [] };
    }
    if (!exists.isDirectory || registration === undefined) {
      throw new Error(
        "Environment path is not the explicitly owned registered checkout. Preserve it and reconcile ownership.",
      );
    }
    if (await Deno.realPath(environment.path) !== environment.path) {
      throw new Error(
        "Environment enrollment must use the canonical checkout path.",
      );
    }
    const git = observation === "source"
      ? await observeSourceSnapshot(environment.path, bounds)
      : await captureGitSnapshot(
        environment.path,
        bounds,
        undefined,
        { root: this.options.root, preserve: observation === "recovery" },
      );
    const common = await resolveCommonGitDir(environment.path);
    const expectedCommon = await resolveCommonGitDir(this.options.root);
    if (common === undefined || common !== expectedCommon) {
      throw new Error("The checkout belongs to another repository.");
    }
    const gitKey = await worktreeGitKey(environment.path);
    const sourceTipMain = declaration === null && borrowed !== null &&
      git.git_dir === common;
    if (!sourceTipMain && (gitKey === undefined || git.git_dir === common)) {
      throw new Error(
        "A temporary environment must be a positively identified linked checkout.",
      );
    }
    const ledger = [];
    if (borrowed !== null) {
      const actual = sourceTipMain
        ? deriveTrunkIdentity(settings).id
        : await resolveWorktreeId(
          settings,
          environment.path,
          { get: () => undefined },
        );
      if (
        actual !== id ||
        (sourceTipMain ? deriveTrunkIdentity(settings).seed : identity.seed) !==
          borrowed.identity.seed
      ) {
        throw new Error(
          "Worktree identity or seed changed; preserve the frozen source environment.",
        );
      }
      const entries = gitKey === undefined
        ? []
        : await captureWorktreeResourceLedger(common, gitKey, environment.path);
      for (const name of Object.keys(resources)) {
        const item = entries.find(({ entry }) => entry.resource_name === name);
        if (
          item === undefined || item.entry.phase !== "ready" ||
          item.entry.resource_identity !== resources[name] ||
          item.entry.worktree_path !== environment.path ||
          item.entry.worktree_id !== id
        ) {
          throw new Error(
            `Resource ${name} lacks current matching ready ownership evidence.`,
          );
        }
      }
      for (const { path, raw } of entries) ledger.push({ path, raw });
    }
    return { ...base, git, ledger };
  }

  async inspect(
    environment: ExecutionEnvironment,
    declaration: EnvironmentDeclaration | null,
    observation?: "source" | "recovery" | "release",
    signal?: AbortSignal,
  ): Promise<WorkspaceSnapshot> {
    const state = await this.state(
      environment,
      declaration,
      undefined,
      observation ??
        (environment.release.kind === "released" &&
            environment.release.retirement
          ? "recovery"
          : undefined),
      signal,
    );
    if (
      observation !== "release" &&
      state.git?.format !== SOURCE_OBSERVATION_FORMAT
    ) requireRestorableSnapshot(state.git);
    if (environment.ownership.kind === "borrowed") {
      const source = environment.ownership.source;
      if (
        state.git?.head !== source.head || state.git.tree !== source.tree ||
        state.git.branch !== source.branch || state.git.status !== ""
      ) {
        throw new Error(
          "Release requires the recorded clean source and index. Preserve authoring changes and release again after committing the intended source.",
        );
      }
    } else if (
      state.git !== null &&
      (state.git.branch !== null || state.git.status !== "")
    ) {
      throw new Error(
        "An isolated slot must have a clean detached checkout before reuse.",
      );
    }
    return await snapshotValue(state);
  }

  async frozen(snapshot: WorkspaceSnapshot): Promise<WorkspaceState> {
    if ((await snapshotValue(snapshot.value)).digest !== snapshot.digest) {
      throw new Error("Frozen workspace state failed its content digest.");
    }
    return WorkspaceStateSchema.parse(snapshot.value);
  }

  async verify(
    environment: ExecutionEnvironment,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const bounds = {
      ...this.options.bounds,
      ...(signal === undefined ? {} : { signal }),
    };
    const state = await this.frozen(snapshot);
    if (state.git === null) {
      if (
        await statIfExists(environment.path) !== undefined ||
        await registeredWorktreeRecord(environment.path, this.options.root) !==
          undefined
      ) {
        throw new Error(
          "The isolated slot was occupied after inspection; no checkout was adopted.",
        );
      }
      return;
    }
    if (
      JSON.stringify(
        await (state.git.format === SOURCE_OBSERVATION_FORMAT
          ? observeSourceSnapshot(environment.path, bounds)
          : captureGitSnapshotLike(
            environment.path,
            bounds,
            state.git,
            this.options.root,
          )),
      ) !== JSON.stringify(state.git)
    ) {
      throw new Error(
        "Checkout or index changed after inspection; capture and reconcile the conflicting writer before returning it.",
      );
    }
    await this.verifyLedger(state);
  }

  async verifyLedger(state: WorkspaceState): Promise<void> {
    for (const entry of state.ledger) {
      if (
        (await inspectResourceEntry(entry.path)).status !== "recorded" ||
        await readTextIfExists(entry.path) !== entry.raw
      ) {
        throw new Error(
          `Resource ownership changed: ${entry.path}. Keep its newer record and reconcile before reuse.`,
        );
      }
    }
  }

  async install(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    source: WorkspaceSnapshot,
  ): Promise<WorkspaceSnapshot> {
    const bounds = { ...this.options.bounds, signal: execution.signal };
    const original = await this.frozen(source);
    if (plan.action !== "source-tip") requireRestorableSnapshot(original.git);
    await this.verify(execution.environment, source, execution.signal);
    const { path } = execution.environment;
    if (original.git === null) {
      if (
        execution.environment.ownership.kind !== "isolated" ||
        plan.action !== "provision"
      ) {
        throw new Error(
          "Only a newly claimed isolated slot can provision a checkout.",
        );
      }
      await executionGit(this.options.root, [
        "worktree",
        "add",
        "--detach",
        path,
        execution.candidate.head,
      ], bounds);
    } else if (plan.action !== "source-tip") {
      await executionGit(
        path,
        ["switch", "--detach", execution.candidate.head],
        bounds,
      );
    }
    const current = plan.action === "source-tip"
      ? await observeSourceSnapshot(path, bounds)
      : await captureGitSnapshot(path, bounds, undefined, {
        root: this.options.root,
        preserve: true,
      });
    if (
      current.head !== execution.candidate.head ||
      current.tree !== execution.candidate.tree || current.status !== "" ||
      (plan.action !== "source-tip" && current.branch !== null)
    ) {
      throw new Error(
        "Installed checkout does not match the immutable candidate; preserve it for recovery.",
      );
    }
    return await snapshotValue(
      await this.state(
        execution.environment,
        plan.declaration,
        original,
        undefined,
        execution.signal,
      ),
    );
  }

  async freezeLifecycle(
    environment: ExecutionEnvironment,
    declaration: EnvironmentDeclaration | null,
    id: string,
    handles: Record<string, string>,
  ): Promise<WorkspaceState["lifecycle"]> {
    const identity = deriveIdentity(id, this.options.settings);
    const handle = worktreeBase(this.options.settings.slug, id);
    const env: Record<string, string> = {
      [DISCERN_ENVIRONMENT_VARIABLES.projectSlug]: this.options.settings.slug,
      [DISCERN_ENVIRONMENT_VARIABLES.worktreeBranchPrefix]:
        this.options.settings.branchPrefix,
      [DISCERN_ENVIRONMENT_VARIABLES.worktreeId]: id,
      [DISCERN_ENVIRONMENT_VARIABLES.worktree]: handle,
    };
    for (const [name, resource] of Object.entries(handles)) {
      Object.assign(env, resourceCommandEnv(name, resource, handle));
    }
    const expand = (template: string): Promise<string> =>
      expandTokens(template, (token) => {
        switch (token) {
          case "db":
            return identity.db;
          case "site":
            return identity.site;
          case "port":
            return String(identity.port);
          case "project_slug":
            return this.options.settings.slug;
          case "dir":
            return environment.path;
          case "worktree":
            return handle;
          case "resource":
            throw new Error(
              "An environment procedure must use its named resource environment variables; no single resource is bound.",
            );
        }
      });
    const commands: WorkspaceState["lifecycle"]["commands"] = {
      prepare: [],
      restore: [],
      reset: [],
      dispose: [],
    };
    for (const phase of ["prepare", "restore", "reset", "dispose"] as const) {
      const configured = declaration?.[phase];
      commands[phase] = await Promise.all(
        (configured === undefined
          ? []
          : typeof configured === "string"
          ? [configured]
          : configured).map(expand),
      );
    }
    return { commands, env, timeout: this.options.commandTimeoutSeconds };
  }

  async run(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    phase: "prepare" | "restore" | "reset" | "dispose",
    signal: AbortSignal,
  ): Promise<void> {
    if (plan.declaration === null) return;
    const intent = await loadExecutionIntent(
      this.options.root,
      execution.fence.attempt_id,
      execution.environment_id,
    );
    const source = await this.frozen(intent.source);
    const { lifecycle } = source;
    if (lifecycle.commands[phase].length === 0) {
      throw new Error(`Environment declaration has no ${phase} procedure.`);
    }
    for (const command of lifecycle.commands[phase]) {
      signal.throwIfAborted();
      await this.verifyLedger(source);
      const result = await spawnJob(
        { label: `environment:${phase}`, command },
        {
          cwd: execution.environment.path,
          env: lifecycle.env,
          signal,
          stream: false,
          write: () => {},
          timeout: {
            seconds: lifecycle.timeout,
            key: "environment executor command budget",
          },
          protocolOutputMaxBytes: 64 * 1024,
          clock: this.options.clock ?? SYSTEM_CLOCK,
          scheduler: this.options.scheduler ?? SYSTEM_SCHEDULER,
        },
      );
      if (signal.aborted) {
        throw new Error(
          `Environment ${phase} was cancelled; preserve its frozen return contract for recovery.`,
        );
      }
      if (result.result.status !== "ok") {
        throw new Error(
          `Required environment ${phase} failed (exit ${result.result.code}): ${command}. ${
            new TextDecoder().decode(result.output)
          }`,
        );
      }
    }
  }

  async capture(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
  ): Promise<WorkspaceSnapshot> {
    const intent = await loadExecutionIntent(
      this.options.root,
      execution.fence.attempt_id,
      execution.environment_id,
    );
    const original = await this.frozen(intent.source);
    const state = await this.state(
      execution.environment,
      plan.declaration,
      original,
      undefined,
      execution.signal,
    );
    if (plan.action !== "source-tip") requireRestorableSnapshot(state.git);
    if (
      execution.environment.ownership.kind === "isolated" && state.git !== null
    ) {
      let registered = original.git;
      if (registered === null) {
        try {
          const installed = await this.frozen(
            SnapshotSchema.parse(
              await readExecutionDocument(
                this.options.root,
                execution.fence.attempt_id,
                "installed",
              ),
            ),
          );
          registered = installed.git;
        } catch (error) {
          throw new Error(
            `The isolated installation receipt environment/installed.json is missing or invalid for attempt ${execution.fence.attempt_id}. Preserve ${execution.environment.path}; restore the recorded receipt before retrying, or have operation ${execution.attempt.identity.executor.operation_id} reconcile the retained checkout and frozen cleanup. ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          );
        }
      }
      if (
        registered === null || registered.git_dir !== state.git.git_dir ||
        registered.index_path !== state.git.index_path
      ) {
        throw new Error(
          "The isolated Git registration differs from its recorded installation. Preserve the replacement checkout and reconcile its ownership before cleanup.",
        );
      }
    }
    return await snapshotValue(state);
  }

  async unprovisioned(
    execution: ClaimedExecution,
    source: WorkspaceSnapshot,
    captured: WorkspaceSnapshot,
  ): Promise<boolean> {
    if (
      execution.environment.ownership.kind !== "isolated" ||
      execution.environment.state.kind !== "executing" ||
      execution.environment.state.phase !== "install" ||
      (await this.frozen(source)).git !== null ||
      (await this.frozen(captured)).git !== null
    ) return false;
    await this.verify(execution.environment, captured, execution.signal);
    try {
      await readExecutionDocument(
        this.options.root,
        execution.fence.attempt_id,
        "installed",
      );
      return false;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return true;
      throw error;
    }
  }

  async restore(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    source: WorkspaceSnapshot,
    captured: WorkspaceSnapshot,
  ): Promise<void> {
    const bounds = { ...this.options.bounds, signal: execution.signal };
    const original = await this.frozen(source);
    const drift = await this.frozen(captured);
    const current = drift.git;
    if (plan.action !== "source-tip") requireRestorableSnapshot(current);
    const { environment, candidate } = execution;
    if (current === null) {
      if (original.git !== null) {
        throw new Error("The source checkout disappeared; retain recovery.");
      }
      return;
    }
    await this.verify(environment, captured, execution.signal);
    if (
      original.git !== null &&
      (original.git.git_dir !== current.git_dir ||
        original.git.index_path !== current.index_path ||
        JSON.stringify(original.ledger) !== JSON.stringify(drift.ledger))
    ) {
      throw new Error(
        "Checkout registration or resource ownership changed from the frozen source. Preserve the current records and reconcile ownership before cleanup.",
      );
    }
    if (plan.action === "source-tip") {
      if (current.status !== "") {
        throw new Error(
          checkoutChangesMessage(current.status) +
            " No source changes were removed.",
        );
      }
      if (current.head !== candidate.head) {
        throw new Error(
          `Source HEAD changed during validation (expected ${candidate.head}, observed ${current.head}); preserve the checkout and reconcile the intended revision before retrying.`,
        );
      }
      return;
    }
    const borrowed = environment.ownership.kind === "borrowed"
      ? environment.ownership
      : null;
    if (
      borrowed !== null && current.branch === borrowed.source.branch &&
      current.status !== ""
    ) {
      throw new Error(
        checkoutChangesMessage(current.status) +
          " Reconcile with the source owner before recovery. No source writes were removed.",
      );
    }
    if (
      current.head !== candidate.head && current.head !== original.git?.head
    ) {
      throw new Error(
        "Checkout moved to an unfamiliar revision; no cleanup ran.",
      );
    }
    if (current.branch !== null && current.branch !== borrowed?.source.branch) {
      throw new Error(
        "Checkout is attached to an unfamiliar branch; no cleanup ran.",
      );
    }
    if (borrowed !== null) {
      const head = (await executionGit(environment.path, [
        "rev-parse",
        `${borrowed.source.branch}^{commit}`,
      ], bounds)).trim();
      if (head !== borrowed.source.head) {
        throw new Error(
          "The authoring branch moved during execution; preserve the detached checkout and its drift.",
        );
      }
    }
    // Every removed leaf is in the just-verified complete capture. Git does not
    // receive a force/clean/reset command or an unknown directory to delete.
    const tracked = new Set(
      splitNulRecords(current.index_entries).map((entry) =>
        entry.slice(entry.indexOf("\t") + 1)
      ),
    );
    for (const file of current.files) {
      execution.signal.throwIfAborted();
      if (file.kind === "missing" || file.ignored || tracked.has(file.path)) {
        continue;
      }
      await Deno.remove(await containedFile(environment.path, file.path));
    }
    await executionGit(environment.path, [
      "restore",
      `--source=${current.head}`,
      "--staged",
      "--worktree",
      "--",
      ".",
    ], bounds);
    if (borrowed !== null && original.git !== null) {
      await executionGit(environment.path, [
        "switch",
        borrowed.source.branch.slice("refs/heads/".length),
      ], bounds);
      const indexLock = `${original.git.index_path}.lock`;
      const lock = await Deno.open(indexLock, {
        createNew: true,
        write: true,
        mode: 0o600,
      });
      try {
        if (original.git.format === RECOVERY_MANIFEST_FORMAT) {
          await copyRecoveryPayload(
            this.options.root,
            original.git.index,
            indexLock,
          );
          await lock.sync();
          await Deno.rename(indexLock, original.git.index_path);
        } else {
          await atomicReplaceBytes(
            original.git.index_path,
            decodeBase64(original.git.index),
            { mode: 0o600, sync: true },
          );
        }
      } finally {
        lock.close();
        await removeIfExists(indexLock);
      }
    }
    // The restored checkout is a fresh observation for later discovery.
    invalidateGitDiscovery();
  }

  async verifyReturned(
    execution: ClaimedExecution,
    plan: ExecutionRecipe,
    source: WorkspaceSnapshot,
  ): Promise<void> {
    const original = await this.frozen(source);
    const current = await this.state(
      execution.environment,
      plan.declaration,
      original,
      original.git?.format === SOURCE_OBSERVATION_FORMAT
        ? "source"
        : original.git?.format === RELEASE_OBSERVATION_FORMAT
        ? "release"
        : "recovery",
      execution.signal,
    );
    const git = current.git;
    if (plan.action !== "source-tip") requireRestorableSnapshot(git);
    if (git === null) throw new Error("The environment has no ready checkout.");
    if (git.status !== "") {
      throw new Error(
        "The declared return procedure left checkout or index changes; retain recovery.",
      );
    }
    if (execution.environment.ownership.kind === "borrowed") {
      if (
        original.git === null || git.head !== original.git.head ||
        git.branch !== original.git.branch ||
        git.index_entries !== original.git.index_entries ||
        (plan.action !== "source-tip" && git.index !== original.git.index) ||
        JSON.stringify(current.ledger) !== JSON.stringify(original.ledger)
      ) {
        throw new Error(
          "The returned source, index, or frozen resource ownership does not match its original state.",
        );
      }
      // Ordinary source-tip execution leaves its own ignored outputs in place; no temporary state was installed.
      if (plan.action === "source-tip") return;
      const declared = (plan.declaration?.ignored ?? []).map((pattern) =>
        globToRegExp(pattern)
      );
      const protectedIgnored = (snapshot: GitSnapshot): unknown =>
        snapshot.files.filter((file) =>
          file.ignored && !declared.some((pattern) => pattern.test(file.path))
        );
      if (
        JSON.stringify(protectedIgnored(git)) !==
          JSON.stringify(protectedIgnored(original.git))
      ) {
        throw new Error(
          "Ignored state outside the declaration changed. Preserve the artifact and reconcile those files before returning the checkout.",
        );
      }
    } else if (git.branch !== null || git.head !== execution.candidate.head) {
      throw new Error(
        "Isolated reset changed its candidate attachment; retain recovery.",
      );
    }
  }

  async dispose(
    execution: ClaimedExecution,
    _plan: ExecutionRecipe,
    captured: WorkspaceSnapshot,
  ): Promise<void> {
    if (
      execution.environment.ownership.kind !== "isolated" ||
      !execution.environment.ownership.disposable
    ) throw new Error("This environment has no isolated disposal ownership.");
    await this.verify(execution.environment, captured, execution.signal);
    const state = await this.frozen(captured);
    if (state.git === null) return;
    requireRestorableSnapshot(state.git);
    if (
      state.git.status !== "" || state.git.branch !== null ||
      state.git.head !== execution.candidate.head
    ) {
      throw new Error(
        "Isolated checkout contains captured drift; retain it for explicit reconciliation before disposal.",
      );
    }
    await executionGit(this.options.root, [
      "worktree",
      "remove",
      execution.environment.path,
    ], { ...this.options.bounds, signal: execution.signal });
    if (await statIfExists(execution.environment.path) !== undefined) {
      throw new Error(
        "Checkout disposal is incomplete; retain the environment record.",
      );
    }
  }
}

/** This adapter supplies filesystem effects, not the caller's exclusion authority. */
export function createGitExecutionWorkspace(
  options: GitExecutionWorkspaceOptions,
): ExecutionWorkspace {
  return new GitExecutionWorkspace(options);
}
