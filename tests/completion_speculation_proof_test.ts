/**
 * Early validation runs only in an environment `discern setup done` has proved
 * as it currently stands. The work-claim gate refuses a later effort inside
 * `lookahead` while its declaration is unproved, leaves the head effort and
 * exact source-tip validation alone, and the proof record decides what
 * "proved" means for one declaration.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine, writeConfig } from "./engine_helpers.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import { orderedEntries } from "../src/engine/landing_queue/model.ts";
import { workCapacity } from "../src/engine/landing_queue/claims.ts";
import {
  CompletionPolicySchema,
  loadConfig,
} from "../src/shared/config_schema.ts";
import {
  recordEnvironmentProof,
  unprovenSpeculationBlocker,
} from "../src/engine/execution/probe_record.ts";
import { declarationIdentity } from "../src/engine/execution/subjects.ts";

const UNPROVEN = {
  kind: "environment-unavailable",
  reason: "the declaration is unproved",
} as const;

Deno.test("an unproved declaration blocks early validation inside lookahead and nothing else", () => {
  const { queue } = queueExample(4);
  const entries = orderedEntries(queue);
  const policy = CompletionPolicySchema.parse({ concurrency: 3, lookahead: 1 });
  // The head effort validates whatever the proof record says.
  assertEquals(
    workCapacity(entries, "effort-0", policy, false, 0, UNPROVEN),
    undefined,
  );
  // An exact source-tip candidate needs no temporary environment.
  assertEquals(
    workCapacity(entries, "effort-1", policy, true, 0, UNPROVEN),
    undefined,
  );
  // Inside lookahead, a later effort would validate early: refused with the route.
  assertEquals(
    workCapacity(entries, "effort-1", policy, false, 0, UNPROVEN),
    UNPROVEN,
  );
  assertEquals(workCapacity(entries, "effort-1", policy), undefined);
  // Beyond lookahead the ordering rule speaks first.
  assertEquals(
    workCapacity(entries, "effort-2", policy, false, 0, UNPROVEN)?.kind,
    "capacity-unavailable",
  );
});

Deno.test("the proof record decides whether one declaration may validate early", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: [] });
    await writeConfig(
      dir,
      `[project]
slug = "proof"
agents = []
logbook = false
[jobs]
test = "true"
[execution.local]
kind = "borrowed"
prepare = "true"
restore = "true"
reusable = true
resources = []
ignored = []
inputs = ["**"]
capacity = 1
[execution.remote]
kind = "isolated"
prepare = "true"
dispose = "true"
reusable = false
resources = []
ignored = []
inputs = ["**"]
capacity = 1
`,
    );
    await gitInit(dir);
    const config = await loadConfig(dir);
    const local = config.execution.local;
    const remote = config.execution.remote;
    assert(local !== undefined && remote !== undefined);
    const before = await unprovenSpeculationBlocker(dir, "local", local);
    assert(before !== undefined);
    assertEquals(before.kind, "environment-unavailable");
    assert("reason" in before);
    assertStringIncludes(
      before.reason,
      "has not been proven by `discern setup done`",
    );
    assertStringIncludes(before.reason, "validate in order");
    // Isolated environments are provided outside setup; nothing to prove here.
    assertEquals(
      await unprovenSpeculationBlocker(dir, "remote", remote),
      undefined,
    );
    await recordEnvironmentProof(dir, {
      context: "local",
      declaration: await declarationIdentity(local),
      proven_at: 1,
      source: { branch: "refs/heads/main", head: "a".repeat(40) },
      exercised: ["success", "failure", "cancellation"],
    });
    assertEquals(
      await unprovenSpeculationBlocker(dir, "local", local),
      undefined,
    );
    const changed = await unprovenSpeculationBlocker(dir, "local", {
      ...local,
      restore: "echo restored",
    });
    assert(changed !== undefined && "reason" in changed);
    assertStringIncludes(
      changed.reason,
      "changed after `discern setup done` proved it",
    );
  });
});
