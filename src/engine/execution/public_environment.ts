import { worktreeGitKey } from "../worktree/git.ts";
import { errorReason, recoveryFor } from "./types.ts";
import type { ExecutionLifetime, ExecutionWorkspace } from "./types.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
/** The caller's own released environment is independent of queue membership or success. */
import type {
  DiscernConfig,
  EnvironmentDeclaration,
} from "../../shared/config_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import type { Executor, SourceRevision } from "../completion/identity.ts";
import { readCompletionRecord } from "../completion/store.ts";
import { createNativeExecutionLifetime } from "./lifetime.ts";
import { createGitExecutionWorkspace } from "./workspace.ts";
import { declarationIdentity } from "./subjects.ts";
import {
  environmentAvailabilityBlocker,
  registerExecutionEnvironment,
  releaseExecutionEnvironment,
  requireEnvironment,
  retireBorrowedEnrollment,
} from "./registry.ts";
import {
  loadIdentitySettings,
  resolveIdentity,
  resourceForId,
} from "../worktree/identity.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { observedRecords } from "../landing_queue/repository.ts";
import { sameSource } from "../landing_queue/model.ts";
import { readCompatibleCompletionRecord } from "../completion/compatibility.ts";

/** Positive source ownership is required even when this checkout is idle and clean. */
export async function ownValidationEnvironment(
  root: string,
  config: DiscernConfig,
  source: SourceRevision,
  actor: Executor,
  declaration: EnvironmentDeclaration | null,
  signal?: AbortSignal,
): Promise<
  {
    environmentId: string;
    workspace: ExecutionWorkspace;
    lifetime: ExecutionLifetime;
  } | CompletionBlocker
> {
  root = await Deno.realPath(root);
  const settings = await loadIdentitySettings(root);
  const identity = await resolveIdentity(root, root);
  if (
    identity.id !== source.effort_id ||
    actor.originating_effort !== source.effort_id
  ) {
    throw new Error(
      "Only the source owner can release this authoring environment.",
    );
  }
  const lifetime = createNativeExecutionLifetime(root);
  const activeEnvironment = observedRecords(
    await observeCompletionRecords(root),
  ).find((record) =>
    record.kind === "environment" && record.data.path === root &&
    record.data.state.kind !== "disposed"
  );
  if (
    activeEnvironment?.kind === "environment" &&
    activeEnvironment.data.state.kind !== "idle"
  ) {
    const pending = environmentAvailabilityBlocker(
      activeEnvironment.id,
      activeEnvironment.data,
      SYSTEM_CLOCK.wallNow(),
    );
    if (pending !== null) return pending;
  }
  let environmentId = activeEnvironment?.id ?? SYSTEM_SECURE_ENTROPY.uuid();
  if (
    activeEnvironment?.kind === "environment" &&
    (activeEnvironment.data.declaration !==
        await declarationIdentity(declaration) ||
      activeEnvironment.data.ownership.kind !== "borrowed" ||
      !sameSource(activeEnvironment.data.ownership.source, source))
  ) {
    await retireBorrowedEnrollment(
      root,
      activeEnvironment.id,
      (await requireEnvironment(root, activeEnvironment.id)).stamp,
      actor,
      lifetime,
    );
    environmentId = SYSTEM_SECURE_ENTROPY.uuid();
  }
  const workspace = validationWorkspace(root, config, environmentId, settings);
  const resources = declaration?.resources ??
    (await worktreeGitKey(root) === undefined
      ? []
      : Object.keys(config.worktree.resources));
  if (
    (await readCompletionRecord(root, {
      kind: "environment",
      id: environmentId,
    })).kind === "missing"
  ) {
    await registerExecutionEnvironment(root, environmentId, {
      path: root,
      ownership: {
        kind: "borrowed",
        source,
        identity: {
          worktree_id: identity.id,
          seed: identity.seed,
          resources: Object.fromEntries(
            resources.map(
              (
                name,
              ) => [name, resourceForId(settings.slug, identity.id, name)],
            ),
          ),
        },
      },
    }, declaration);
  }
  const enrolled = await requireEnvironment(root, environmentId);
  try {
    await releaseExecutionEnvironment(
      root,
      environmentId,
      enrolled.stamp,
      actor,
      declaration,
      { lifetime, workspace },
      { ...(signal === undefined ? {} : { signal }) },
    );
  } catch (error) {
    return {
      kind: "recovery-incomplete",
      record_id: environmentId,
      recovery: recoveryFor("capture", errorReason(error), root, [], true),
    };
  }
  return { environmentId, workspace, lifetime };
}

/** Construct the canonical workspace adapter for an owned or released source. */
export function validationWorkspace(
  root: string,
  config: DiscernConfig,
  environmentId: string,
  settings: Awaited<ReturnType<typeof loadIdentitySettings>>,
): ExecutionWorkspace {
  return createGitExecutionWorkspace({
    root,
    environmentId,
    settings,
    bounds: {
      maxFiles: 100_000,
      maxBytes: 1024 * 1024 * 1024,
      gitTimeoutMs: 60_000,
    },
    commandTimeoutSeconds: Math.max(1, config.gate.timeout),
  });
}

/** Bind capabilities to an existing owner release; this reader cannot enroll or release a peer. */
export async function releasedValidationEnvironment(
  root: string,
  config: DiscernConfig,
  source: SourceRevision,
  declaration: EnvironmentDeclaration | null,
  released: {
    readonly environment_id: string;
    readonly expected_stamp: string;
  },
): Promise<
  {
    environmentId: string;
    workspace: ExecutionWorkspace;
    lifetime: ExecutionLifetime;
  } | CompletionBlocker
> {
  root = await Deno.realPath(root);
  const current = await readCompatibleCompletionRecord(root, {
    kind: "environment",
    id: released.environment_id,
  });
  if (current.kind !== "recorded") return current;
  if (current.record.kind !== "environment") {
    throw new Error("Environment coordinate returned another record family.");
  }
  const environment = current.record.data;
  const changed = [
    current.stamp !== released.expected_stamp ? "record stamp" : null,
    environment.path !== root ? "checkout path" : null,
    environment.ownership.kind !== "borrowed"
      ? "borrowed ownership"
      : !sameSource(environment.ownership.source, source)
      ? "source revision"
      : null,
    environment.release.kind !== "released" ? "owner release" : null,
    environment.state.kind !== "idle" ? "environment state" : null,
    environment.declaration !== await declarationIdentity(declaration)
      ? "execution declaration"
      : null,
  ].filter((reason) => reason !== null);
  if (changed.length > 0) {
    return {
      kind: "environment-unavailable",
      reason: `The released source environment changed: ${
        changed.join(", ")
      }. Re-observe acceptance before retrying; preserve the source owner's release and any recovery record.`,
    };
  }
  return {
    environmentId: current.record.id,
    workspace: validationWorkspace(
      root,
      config,
      current.record.id,
      await loadIdentitySettings(root),
    ),
    lifetime: createNativeExecutionLifetime(root),
  };
}
