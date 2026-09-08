/** Reusing valid Proof still settles the owning checkout's requested lifetime. */
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { readCompletionRecord } from "../completion/store.ts";
import { createNativeExecutionLifetime } from "../execution/lifetime.ts";
import {
  ownValidationEnvironment,
  validationWorkspace,
} from "../execution/public_environment.ts";
import {
  releaseExecutionEnvironment,
  replaceEnvironment,
  requireEnvironment,
} from "../execution/registry.ts";
import { enrolledDeclaration } from "../execution/subjects.ts";
import { acceptancePending } from "../landing_queue/public_result.ts";
import { observeSource } from "../landing_queue/composition.ts";
import { sameSource } from "../landing_queue/model.ts";
import { observedRecords } from "../landing_queue/repository.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { loadIdentitySettings, resolveIdentity } from "../worktree/identity.ts";

/** Caller holds checkout exclusion across Proof inspection and this transition. */
export async function settleReviewedCheckout(
  root: string,
  proof: CompletionProofPointer,
  retain: boolean,
  dryRun = false,
  signal?: AbortSignal,
): Promise<void> {
  root = await Deno.realPath(root);
  const candidate = await readCompletionRecord(root, {
    kind: "candidate",
    id: proof.candidate_id,
  });
  if (candidate.kind !== "recorded" || candidate.record.kind !== "candidate") {
    throw new Error(
      "The proven candidate is unavailable; preserve the checkout and inspect completion recovery.",
    );
  }
  const identity = await resolveIdentity(root, root);
  const source = await observeSource(
    root,
    identity.id,
    candidate.record.data.source.branch,
  );
  if (!sameSource(source, candidate.record.data.source)) {
    throw new Error(
      "The checkout no longer matches the proven source; run done on the intended committed source.",
    );
  }
  const environment = observedRecords(await observeCompletionRecords(root))
    .find((record) =>
      record.kind === "environment" && record.data.path === root &&
      record.data.state.kind !== "disposed"
    );
  if (
    environment?.kind !== "environment" ||
    environment.data.state.kind !== "idle" ||
    environment.data.ownership.kind !== "borrowed" ||
    !sameSource(environment.data.ownership.source, source)
  ) {
    throw new Error(
      "The source environment is unavailable or still in use; finish its operation or reported recovery before changing checkout ownership.",
    );
  }
  const config = await loadConfig(root);
  const declaration = await enrolledDeclaration(
    environment.data,
    Object.values(config.execution),
  );
  const current = await requireEnvironment(root, environment.id);
  const lifetime = createNativeExecutionLifetime(root);
  const workspace = validationWorkspace(
    root,
    config,
    environment.id,
    await loadIdentitySettings(root),
  );
  const actor = {
    operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
    originating_effort: identity.id,
    started_at: SYSTEM_CLOCK.wallNow(),
  };
  if (!retain) {
    if (dryRun) {
      const use = await lifetime.inspect(root);
      if (!use.quiescent) throw new Error(use.reason);
      return;
    }
    const configured = config.execution.local;
    const releaseDeclaration = declaration ??
      (configured?.kind === "borrowed" ? configured : null);
    const release = releaseDeclaration === declaration
      ? { environmentId: environment.id, lifetime, workspace }
      : await ownValidationEnvironment(
        root,
        config,
        source,
        actor,
        releaseDeclaration,
        signal,
      );
    if ("kind" in release) throw new Error(acceptancePending(release).reason);
    const released = release.environmentId === environment.id
      ? current
      : await requireEnvironment(root, release.environmentId);
    await releaseExecutionEnvironment(
      root,
      release.environmentId,
      released.stamp,
      actor,
      releaseDeclaration,
      release,
      { retirement: true, ...(signal === undefined ? {} : { signal }) },
    );
    return;
  }
  const use = await lifetime.inspect(root);
  if (!use.quiescent) throw new Error(use.reason);
  if (current.record.data.release.kind === "held") return;
  const snapshot = await workspace.inspect(
    current.record.data,
    declaration,
    undefined,
    signal,
  );
  await workspace.verify(current.record.data, snapshot, signal);
  await withCompletionPublication(
    root,
    () =>
      replaceEnvironment(root, current, {
        ...current.record.data,
        release: { kind: "held" },
      }, SYSTEM_CLOCK),
  );
}
