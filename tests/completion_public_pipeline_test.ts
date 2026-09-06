import {
  type CompletionObservationFact,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
/** Native public integration runs each producer once and publishes only complete candidates. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { addWorktree, git, gitInit } from "./engine_helpers.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { withPublicCompletion } from "../src/engine/landing_queue/public_completion.ts";
import { executePublicValidation } from "../src/engine/validation/public_run.ts";
import { configuredValidation } from "../src/engine/validation/configuration.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { requireQueue } from "../src/engine/landing_queue/repository.ts";

/** Exercise native candidate selection, producer execution and admission without presentation. */
async function complete(
  root: string,
  context = "local",
): ReturnType<typeof withPublicCompletion<Readonly<Record<string, number>>>> {
  return await withPublicCompletion(
    root,
    { context, mode: "strict" },
    async (session) => {
      const config = await loadConfig(root);
      const configured = await configuredValidation(config, []);
      const validation = await executePublicValidation({
        root,
        config,
        scopes: [],
        claimed: session.execution,
        demand: {
          kind: "done",
          context,
          mode: "strict",
          requirements: configured.obligations.map((entry) =>
            entry.requirement
          ),
        },
        bindComposition: true,
      });
      assertEquals(
        validation.outcome.blockers,
        [],
        JSON.stringify(validation.outcome),
      );
      return {
        value: validation.producer_executions,
        passed: validation.outcome.blockers.length === 0,
        validation,
      };
    },
  );
}

/** Declare two standard consumers of the same produced artifact. */
async function project(
  root: string,
  contexts: readonly string[] = ["local"],
): Promise<string> {
  await Deno.writeTextFile(
    `${root}/discern.toml`,
    `[project]\nslug = 'sample'\nagents = []\nlogbook = false\n[repository]\nbranch_prefix = 'agent/'\n[completion]\nrequired_contexts = ${
      JSON.stringify(contexts)
    }\n[jobs]\ntest = { run = "printf 'x\\n' >> executions; printf 'DISCERN_METRIC coverage 93\\n' > readings", artifacts = ['readings'], inputs = ['**'] }\n[standards.coverage]\nproducer = 'jobs.test'\nextract = 'cat'\nartifact = 'readings'\ninputs = ['**']\ndirection = 'up'\nlimit = 90\n[standards.second]\nproducer = 'jobs.test'\nextract = 'cat'\nartifact = 'readings'\ninputs = ['**']\nmetric = 'coverage'\ndirection = 'up'\nlimit = 90\n`,
  );
  await Deno.writeTextFile(`${root}/.gitignore`, "executions\nreadings\n");
  await gitInit(root);
  return await addWorktree(root, "pipeline");
}

Deno.test("complete source-tip pipeline shares producer and preserves standalone ignored outputs", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const facts: CompletionObservationFact[] = [];
    const result = await withCompletionObserver((fact) => {
      facts.push(fact);
    }, () => complete(path));
    assertEquals(result.kind, "completed", JSON.stringify(result));
    assert(result.kind === "completed");
    assertEquals(result.blockers, []);
    assert(result.proof_id !== undefined);
    assertEquals(result.value, { "jobs.test": 1 });
    assert(
      facts.some((fact) =>
        fact.kind === "progress" && fact.progress.phase === "producer" &&
        fact.progress.state === "running"
      ),
    );
    const uses = facts.filter((fact) =>
      fact.kind === "event" && fact.event.fact.kind === "producer"
    );
    assertEquals(uses.length, 3);
    assert(
      uses.every((fact) =>
        fact.kind === "event" && fact.event.candidate_id === result.candidate_id
      ),
    );
    assert(
      facts.some((fact) =>
        fact.kind === "event" && fact.event.fact.kind === "restoration" &&
        fact.event.fact.outcome === "restored"
      ),
    );
    assertEquals(await Deno.readTextFile(`${path}/executions`), "x\n");
    const records = await observeCompletionRecords(path);
    const proof = records.records.find((entry) =>
      entry.selector.kind === "proof"
    )?.reading;
    assert(proof?.kind === "recorded" && proof.record.kind === "proof");
    assertEquals(proof.record.data.receipts.length, 3);
    assertEquals(
      (await requireQueue(path)).record.data.entries[0]?.state,
      "provisional",
    );
    facts.length = 0;
    const again = await withCompletionObserver((fact) => {
      facts.push(fact);
    }, () => complete(path));
    assert(again.kind === "completed", JSON.stringify(again));
    assertEquals(again.candidate_id, result.candidate_id);
    assertEquals(again.value, {});
    assertEquals(
      facts.filter((fact) =>
        fact.kind === "event" && fact.event.fact.kind === "producer" &&
        fact.event.fact.use === "reused"
      ).length,
      3,
    );
    assertEquals(await Deno.readTextFile(`${path}/executions`), "x\n");
  });
});

Deno.test("E13 distinct declared contexts assemble only after every context supplies evidence", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local", "remote"]);
    const first = await complete(path);
    assert(first.kind === "completed", JSON.stringify(first));
    assertEquals(first.proof_id, undefined);
    assert(
      first.blockers.some((blocker) => blocker.kind === "missing-evidence"),
    );
    const second = await complete(path, "remote");
    assert(second.kind === "completed", JSON.stringify(second));
    assertEquals(second.candidate_id, first.candidate_id);
    assertEquals(second.blockers, []);
    assert(second.proof_id !== undefined);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "x\nx\n");
    await Deno.writeTextFile(`${path}/new-source`, "new\n");
    await git(path, "add", "new-source");
    await git(path, "commit", "-m", "Change source");
    const replaced = await complete(path);
    assert(replaced.kind === "completed", JSON.stringify(replaced));
    assert(replaced.candidate_id !== second.candidate_id);
    assertEquals(replaced.proof_id, undefined);
  });
});
