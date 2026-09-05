/** Real Git and fake schema resources, with a deterministic lifetime test double. */
import { assert, assertExists } from "@std/assert";
import { join } from "@std/path";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  COMPLETION_DIGEST,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  type EnvironmentDeclaration,
  EnvironmentDeclarationSchema,
} from "../src/engine/completion/configuration.ts";
import type { Candidate } from "../src/engine/completion/candidate.ts";
import type {
  Executor,
  SourceRevision,
} from "../src/engine/completion/identity.ts";
import type {
  ClaimedExecution,
  EnvironmentExecutor,
  ValidationPlan,
} from "../src/engine/completion/protocol.ts";
import type { Clock } from "../src/shared/clock.ts";
import {
  deriveIdentity,
  resourceForId,
  worktreeBase,
} from "../src/engine/worktree/identity.ts";
import { writeEntry } from "../src/engine/worktree/resources.ts";
import {
  resolveCommonGitDir,
  worktreeGitKey,
} from "../src/engine/worktree/git.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { createGitExecutionWorkspace } from "../src/engine/execution/workspace.ts";
import {
  createEnvironmentExecutor,
  type EnvironmentExecutorOptions,
} from "../src/engine/execution/executor.ts";
import {
  registerExecutionEnvironment,
  releaseExecutionEnvironment,
  requireEnvironment,
} from "../src/engine/execution/registry.ts";
import type {
  ExecutionLifetime,
  ExecutionWorkspace,
} from "../src/engine/execution/types.ts";

/** This double asserts the required port contract; it is not a production lock. */
export class ControlledLifetime implements ExecutionLifetime {
  occupied = false;
  children = false;
  uncertain = false;
  async inspect(
    _path: string,
  ): Promise<{ quiescent: boolean; reason: string }> {
    await Promise.resolve();
    return {
      quiescent: !this.occupied && !this.children && !this.uncertain,
      reason: "controlled active use",
    };
  }
  async exclusive<T>(
    _path: string,
    _execution: { readonly attempt_id: string; readonly token: string },
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.occupied) {
      throw new Error("Another operation retains checkout exclusion.");
    }
    this.occupied = true;
    try {
      return await operation();
    } finally {
      this.occupied = false;
    }
  }
  async quiesce(_path: string, _attemptId: string): Promise<boolean> {
    await Promise.resolve();
    return !this.children && !this.uncertain;
  }
}

export interface EnvironmentFixture {
  readonly root: string;
  readonly path: string;
  readonly id: string;
  readonly source: SourceRevision;
  readonly candidate: Candidate;
  readonly actor: Executor;
  readonly declaration: EnvironmentDeclaration | null;
  readonly resourcePath: string;
  readonly lifetime: ControlledLifetime;
  readonly workspace: ExecutionWorkspace;
  readonly clock: Clock;
  readonly options: EnvironmentExecutorOptions;
  readonly executor: EnvironmentExecutor;
  plan(candidate?: Candidate): ValidationPlan;
  claim(
    plan?: ValidationPlan,
    executor?: EnvironmentExecutor,
  ): Promise<ClaimedExecution>;
  release(): Promise<void>;
}

/** An older source and newer candidate share no mutable resource handle. */
export async function environmentFixture(
  base: string,
  kind: "borrowed" | "isolated" | "undeclared" = "borrowed",
  reusable = true,
  overrides: Partial<EnvironmentDeclaration> = {},
): Promise<EnvironmentFixture> {
  const root = join(await Deno.realPath(base), "repo");
  await Deno.mkdir(root);
  await Deno.writeTextFile(join(root, "schema"), "1\n");
  await Deno.writeTextFile(join(root, "binary"), "original\n");
  await Deno.writeTextFile(join(root, ".gitignore"), "cache.dat\n");
  await gitInit(root);
  const sourceHead = await gitOut(root, "rev-parse", "HEAD");
  const sourceTree = await gitOut(root, "rev-parse", "HEAD^{tree}");
  const path = join(
    await Deno.realPath(base),
    kind === "isolated" ? "slot" : "effort-a",
  );
  if (kind !== "isolated") {
    await git(root, "worktree", "add", "-b", "agent/effort-a", path);
  }
  await Deno.writeTextFile(join(root, "schema"), "2\n");
  await git(root, "add", "schema");
  await git(root, "commit", "-m", "newer schema");
  const source: SourceRevision = {
    effort_id: "effort-a",
    branch: "refs/heads/agent/effort-a",
    head: sourceHead,
    tree: sourceTree,
  };
  const candidate: Candidate = {
    ...COMPLETION_FAMILIES.candidate.schema.parse(
      completionFixtures().candidate,
    ).data,
    source,
    head: await gitOut(root, "rev-parse", "HEAD"),
    tree: await gitOut(root, "rev-parse", "HEAD^{tree}"),
    expected_predecessor: { head: sourceHead, candidate_id: null },
  };
  const actor: Executor = {
    operation_id: completionId(20),
    originating_effort: source.effort_id,
    started_at: 10,
  };
  const id = completionId(50);
  const identityId = kind === "isolated" ? `execution-${id}` : source.effort_id;
  const settings = { slug: "sample", branchPrefix: "agent/", envFiles: [] };
  const identity = deriveIdentity(identityId, settings);
  const handle = resourceForId(settings.slug, identityId, "schema");
  const resourcesRoot = join(await Deno.realPath(base), "resources");
  await Deno.mkdir(resourcesRoot);
  const quote = (value: string): string =>
    `'${value.replaceAll("'", "'\\''")}'`;
  const resourceShell = `${quote(resourcesRoot)}/"$DISCERN_RESOURCE_SCHEMA"`;
  const resourcePath = join(resourcesRoot, handle);
  if (kind !== "isolated") await Deno.writeTextFile(resourcePath, "1\n");
  const declaration = kind === "undeclared"
    ? null
    : EnvironmentDeclarationSchema.parse({
      kind,
      reusable,
      capacity: 1,
      inputs: ["schema"],
      resources: ["schema"],
      ignored: ["cache.dat"],
      prepare:
        `old=0; if test -f ${resourceShell}; then old=$(cat ${resourceShell}); fi; test "$old" -le "$(cat schema)" && cat schema > ${resourceShell} && cat schema > cache.dat`,
      restore:
        `cat schema > ${resourceShell} && cat schema > cache.dat && test "$(cat ${resourceShell})" = "$(cat schema)"`,
      reset: `printf '0\\n' > ${resourceShell}`,
      dispose: `rm -f ${resourceShell}`,
      ...overrides,
    });
  if (kind !== "isolated") {
    const common = await resolveCommonGitDir(path);
    const key = await worktreeGitKey(path);
    assertExists(common);
    assertExists(key);
    await writeEntry(common, {
      schema: ON_DISK_FORMATS.resourceLedger.version,
      phase: "ready",
      seq: 0,
      project_slug: settings.slug,
      git_key: key,
      worktree_id: identityId,
      worktree_handle: worktreeBase(settings.slug, identityId),
      worktree_path: path,
      resource_name: "schema",
      resource_identity: handle,
      destroy_command: `rm -f ${quote(resourcePath)}`,
      token_map: {},
      retries: 0,
      gc: true,
      created_at: "2026-09-05T00:00:00Z",
    });
  }
  const lifetime = new ControlledLifetime();
  const clock: Clock = { wallNow: () => 100, monotonicNow: () => 10 };
  const workspace = createGitExecutionWorkspace({
    root,
    environmentId: id,
    settings,
    bounds: { maxFiles: 100, maxBytes: 1024 * 1024, gitTimeoutMs: 5000 },
    commandTimeoutSeconds: 5,
    clock,
  });
  await registerExecutionEnvironment(
    root,
    id,
    {
      path,
      ownership: kind === "isolated"
        ? {
          kind: "isolated",
          owner_operation: actor.operation_id,
          disposable: !reusable,
        }
        : {
          kind: "borrowed",
          source,
          identity: {
            worktree_id: identity.id,
            seed: identity.seed,
            resources: { schema: handle },
          },
        },
    },
    declaration,
    clock,
  );
  let sequence = 0;
  const options: EnvironmentExecutorOptions = {
    root,
    environmentId: id,
    declaration,
    workspace,
    lifetime,
    clock,
    leaseMs: 60000,
    reserveAttempt: (plan, executor) => {
      sequence++;
      return Promise.resolve({
        id: completionId(200 + sequence),
        candidate_id: plan.candidate_id,
        executor,
        sequence,
        rerun_of: null,
        started_at: clock.wallNow(),
      });
    },
    validationOutcome: (value) => value === true ? "passed" : "failed",
  };
  const executor = createEnvironmentExecutor(options);
  const plan = (subject: Candidate = candidate): ValidationPlan => ({
    candidate_id: completionId(1),
    candidate: subject,
    demand: {
      kind: "done",
      context: "local",
      mode: "strict",
      requirements: [],
    },
    producers: [],
    reused: [],
    blockers: [],
  });
  const release = async (): Promise<void> => {
    const record = await requireEnvironment(root, id);
    await releaseExecutionEnvironment(
      root,
      id,
      record.stamp,
      actor,
      declaration,
      { lifetime, workspace },
      { clock },
    );
  };
  await release();
  return {
    root,
    path,
    id,
    source,
    candidate,
    actor,
    declaration,
    resourcePath,
    lifetime,
    workspace,
    clock,
    options,
    executor,
    plan,
    release,
    claim: async (validation = plan(), runner = executor) => {
      const reading = await runner.observe(id);
      const selected = runner.plan({
        trunk: "main",
        observed_at: clock.wallNow(),
        records: [{ selector: { kind: "environment", id }, reading }],
      }, validation);
      assert(!("kind" in selected), JSON.stringify(selected));
      const claimed = await runner.claim(selected, actor);
      assert(!("kind" in claimed), JSON.stringify(claimed));
      return claimed;
    },
  };
}

/** Add one producer subject so the real evidence publication fence can be tested. */
export function planWithEvidence(plan: ValidationPlan): ValidationPlan {
  const applicability =
    COMPLETION_FAMILIES.evidence.schema.parse(completionFixtures().evidence)
      .data.applicability;
  return {
    ...plan,
    producers: [{
      selector: "jobs.test",
      recipe: {
        run: ":",
        needs: [],
        artifacts: [],
        environment: [],
        toolchain: [],
      },
      evidence_subjects: [{ ...applicability, policy: COMPLETION_DIGEST }],
      consumers: [],
    }],
  };
}
