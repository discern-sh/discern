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

/** Positive source ownership is required even when this checkout is idle and clean. */
export async function ownValidationEnvironment(
  root: string,
  config: DiscernConfig,
  source: SourceRevision,
  actor: Executor,
  declaration: EnvironmentDeclaration | null,
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
            (declaration?.resources ?? []).map(
              (name) => [name, resourceForId(settings.slug, identity.id, name)],
            ),
          ),
        },
      },
    }, declaration);
  }
  const enrolled = await requireEnvironment(root, environmentId);
  await releaseExecutionEnvironment(
    root,
    environmentId,
    enrolled.stamp,
    actor,
    declaration,
    { lifetime, workspace },
  );
  return { environmentId, workspace, lifetime };
}

/** Construct the canonical workspace adapter for an owned or released source. */
function validationWorkspace(
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
  }
> {
  root = await Deno.realPath(root);
  const current = await requireEnvironment(root, released.environment_id);
  const environment = current.record.data;
  if (
    current.stamp !== released.expected_stamp || environment.path !== root ||
    environment.ownership.kind !== "borrowed" ||
    !sameSource(environment.ownership.source, source) ||
    environment.release.kind !== "released" ||
    environment.state.kind !== "idle" ||
    environment.declaration !== await declarationIdentity(declaration)
  ) {
    throw new Error(
      "The exact source environment is no longer released and eligible; observe it again without taking authoring control.",
    );
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
