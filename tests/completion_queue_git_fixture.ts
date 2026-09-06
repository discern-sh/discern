import type { AGENT_NAMES } from "../src/shared/config_schema.ts";
/** Real Git source/predecessor snapshots with an explicitly simulated environment lease. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  COMPLETION_CLOCK,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import { compileInstructions } from "../src/engine/instructions.ts";
import { Logger } from "../src/lib/log.ts";
import { observeSource } from "../src/engine/landing_queue/composition.ts";
import { writeCompletionRecord } from "../src/engine/completion/store.ts";
import type { ClaimedExecution } from "../src/engine/completion/protocol.ts";
import {
  initializeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";

/** An isolated claimed test checkout composes two real branches with owned generated output. */
export async function compositionFixture(
  base: string,
  conflict: boolean,
  agents: readonly (typeof AGENT_NAMES)[number][] = [],
  beforeSourceCommit?: (root: string) => Promise<void>,
): Promise<
  {
    root: string;
    slot: string;
    execution: ClaimedExecution;
    predecessor: string;
  }
> {
  const root = join(base, "repo");
  await Deno.mkdir(root);
  await Deno.writeTextFile(
    join(root, "discern.toml"),
    `[project]\nslug = "queue-test"\nagents = ${
      JSON.stringify(agents)
    }\n[generated.data]\npaths = ["generated.txt"]\nrun = "sh generator.sh"\n`,
  );
  await Deno.writeTextFile(join(root, "a"), "a\n");
  await Deno.writeTextFile(join(root, "b"), "b\n");
  await Deno.writeTextFile(join(root, "generated.txt"), "a\nb\n");
  await Deno.writeTextFile(
    join(root, "generator.sh"),
    "cat a b > generated.txt\n",
  );
  await gitInit(root);
  await compileInstructions(root, new Logger({ json: true, noColor: true }));
  await beforeSourceCommit?.(root);
  await git(root, "add", ".");
  await git(
    root,
    "commit",
    "--allow-empty",
    "-m",
    "Declare generated ownership",
  );
  const author = join(base, "author");
  await git(root, "worktree", "add", "-b", "agent/source", author);
  await Deno.writeTextFile(join(author, "a"), "A\n");
  await Deno.writeTextFile(join(author, "generated.txt"), "A\nb\n");
  await git(author, "add", ".");
  await git(author, "commit", "-m", "Author source");
  const source = await observeSource(root, "source", "refs/heads/agent/source");
  await Deno.writeTextFile(join(root, conflict ? "a" : "b"), "B\n");
  await Deno.writeTextFile(join(root, "generated.txt"), "a\nB\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Author predecessor");
  const predecessor = await gitOut(root, "rev-parse", "HEAD");
  const slot = join(base, "slot");
  await git(root, "worktree", "add", "--detach", slot, source.head);
  const fixtures = completionFixtures();
  const attempt = COMPLETION_FAMILIES.attempt.schema.parse(fixtures.attempt);
  const environment = COMPLETION_FAMILIES.environment.schema.parse(
    fixtures.environment,
  );
  const candidate = COMPLETION_FAMILIES.candidate.schema.parse(
    fixtures.candidate,
  );
  assert(attempt.data.state.kind === "claimed");
  environment.data = {
    ...environment.data,
    path: slot,
    ownership: {
      kind: "isolated",
      owner_operation: attempt.data.identity.executor.operation_id,
      disposable: true,
    },
    state: {
      kind: "executing",
      attempt_id: attempt.id,
      candidate_id: candidate.id,
      release_id: completionId(22),
      claim: attempt.data.state.claim,
      phase: "validate",
    },
  };
  candidate.data = {
    ...candidate.data,
    source,
    head: source.head,
    tree: source.tree,
  };
  await initializeQueue(root, predecessor);
  const queue = COMPLETION_FAMILIES.queue.schema.parse(fixtures.queue).data;
  await replaceQueue(root, await requireQueue(root), {
    ...queue,
    trunk: predecessor,
    entries: queue.entries.map((entry) => ({
      ...entry,
      source,
      state: "active",
    })),
  }, COMPLETION_CLOCK);
  assertEquals(
    (await writeCompletionRecord(
      root,
      attempt,
      null,
      undefined,
      COMPLETION_CLOCK,
    )).kind,
    "written",
  );
  assertEquals(
    (await writeCompletionRecord(
      root,
      environment,
      null,
      undefined,
      COMPLETION_CLOCK,
    )).kind,
    "written",
  );
  const execution: ClaimedExecution = {
    fence: { attempt_id: attempt.id, token: attempt.data.state.claim.token },
    attempt: attempt.data,
    environment_id: environment.id,
    environment: environment.data,
    candidate_id: candidate.id,
    candidate: candidate.data,
    signal: new AbortController().signal,
  };
  return { root, slot, execution, predecessor };
}
