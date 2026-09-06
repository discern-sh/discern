import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import {
  artifactStamp,
  auditArtifacts,
  captureProducedArtifact,
  readArtifact,
  retainArtifact,
} from "../src/engine/validation/artifacts.ts";
import {
  readCompleteCapture,
  runCapturedCommands,
} from "../src/engine/jobs/captured.ts";
import {
  createValidationRuntime,
  observeCompletionRecords,
  observeValidationInputs,
} from "../src/engine/validation/runtime.ts";
import { createProducerEvaluator } from "../src/engine/validation/evaluator.ts";
import { CompletionRecordSchema } from "../src/engine/completion/records.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { artifactKey } from "../src/engine/validation/selection.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  ARTIFACT_EXTRACTOR,
  ARTIFACT_RECIPE,
  assemblyRecord,
  claimed,
  COMPLETION_CLOCK,
  completionId,
  CONDITIONS,
  obligations,
  snapshot,
} from "./completion_producers_fixtures.ts";

Deno.test("E04: input observation retains every Git filename including object member names", async () => {
  await withTempDir(async (root) => {
    const names = ["__proto__", "constructor", "toString", "ordinary.txt"];
    for (const name of names) {
      await Deno.writeTextFile(join(root, name), "input\n");
    }
    await gitInit(root);
    const before = await observeValidationInputs(root);
    assertEquals(Object.keys(before.files).sort(), [...names].sort());
    for (const name of names) {
      const prior = before.files[name];
      assert(prior !== undefined);
      await Deno.writeTextFile(join(root, name), "changed input\n");
      const after = await observeValidationInputs(root);
      assert(after.files[name]?.digest !== prior.digest, name);
    }
  });
});

Deno.test("E05: attempt artifacts reject unsafe paths, stale files, replacement, missing bytes and wrong digests", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "README.md"), "fixture\n");
    await gitInit(root);
    const subject = {
      attempt_id: completionId(50),
      candidate_id: completionId(1),
      context: "local",
    };
    const bytes = new TextEncoder().encode("measurements");
    for (
      const path of ["../escape", "/absolute", ".git/config", "a/../escape"]
    ) await assertRejects(() => retainArtifact(root, subject, path, bytes));
    await Deno.writeTextFile(join(root, "latest.txt"), "old result");
    const old = await artifactStamp(root, "latest.txt");
    await assertRejects(() =>
      captureProducedArtifact(root, subject, "latest.txt", old)
    );
    await assertRejects(() =>
      captureProducedArtifact(root, subject, "absent.txt", null)
    );
    await Deno.symlink(join(root, "latest.txt"), join(root, "link.txt"));
    await assertRejects(() => artifactStamp(root, "link.txt"));
    const retained = await retainArtifact(root, subject, "captured.txt", bytes);
    assertEquals(await readArtifact(root, retained), bytes);
    await assertRejects(() =>
      retainArtifact(root, subject, "captured.txt", bytes)
    );
    await assertRejects(() =>
      readArtifact(root, { ...retained, attempt_id: completionId(999) })
    );
    await assertRejects(() =>
      readArtifact(root, { ...retained, digest: "f".repeat(64) })
    );
    const directory = await gitAdminStatePath(root, "completionArtifacts");
    assert(directory !== undefined);
    await Deno.writeTextFile(
      join(directory, subject.attempt_id, "captured.txt"),
      "changed",
    );
    await assertRejects(() => readArtifact(root, retained));
    await assertRejects(() => readCompleteCapture(join(root, "latest.txt"), 1));
  });
});

Deno.test("E17: supervised captured commands pass binary stdin and keep stderr out of metrics", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "README.md"), "fixture\n");
    await gitInit(root);
    const bytes = new Uint8Array([0, 255, 1, 2]);
    const output = await runCapturedCommands({
      root,
      label: "extract",
      commands: ["cat; printf 'DISCERN_METRIC forged 999' >&2"],
      timeout: 30,
      signal: new AbortController().signal,
      environment: {},
      stdin: bytes,
    });
    assertEquals(output.result.status, "ok");
    assertEquals(output.stdout, bytes);
    assertEquals(output.capture_complete, true);
    assert(output.result.outputPath !== undefined);
    assert(
      (await Deno.readTextFile(output.result.outputPath)).includes("forged"),
    );
  });
});

Deno.test("E02 E05 E12: real producer/extractor and frozen store assemble evidence and reuse pin decisions", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, ".gitignore"), "reports/\n");
    await gitInit(root);
    const baseline = await snapshot();
    const head = await gitOut(root, "rev-parse", "HEAD");
    const tree = await gitOut(root, "rev-parse", "HEAD^{tree}");
    const declarations = obligations().filter((o) =>
      o.requirement.id !== "gaps"
    ).map((o) =>
      o.standard === undefined ? { ...o, input: { producer: "jobs.test" } } : {
        ...o,
        input: {
          producer: "jobs.test",
          extract: ARTIFACT_EXTRACTOR,
          artifact: "reports/counts.txt",
        },
        inputs: [".gitignore"],
      }
    );
    const snap = await snapshot({
      candidate: {
        ...baseline.candidate,
        attempt_id: completionId(101),
        head,
        tree,
      },
      producers: { "jobs.test": ARTIFACT_RECIPE },
      obligations: declarations,
      inputs: await observeValidationInputs(root),
    });
    const conditions = CONDITIONS[0];
    assert(conditions !== undefined);
    let verificationQueries = 0;
    let observedVerificationQueries = 0;
    const runtime = createValidationRuntime({
      root,
      conditions,
      environment: { MODE: "test" },
      inheritedEnvironment: { get: () => undefined },
      timeout: 30,
      verifyConditions: () => {
        observedVerificationQueries = verificationQueries;
        return Promise.resolve();
      },
      clock: COMPLETION_CLOCK,
    });
    const evaluator = createProducerEvaluator({
      snapshot: snap,
      root,
      observe: () => observeCompletionRecords(root, COMPLETION_CLOCK),
      runtime,
      clock: COMPLETION_CLOCK,
    });
    const before = await evaluator.observe(snap.candidate_id);
    const plan = evaluator.plan(before, {
      kind: "done",
      context: "local",
      mode: "strict",
      requirements: snap.requirements,
    }, snap.candidate_id);
    const fake = claimed(snap, plan);
    const execution = {
      ...fake,
      environment: { ...fake.environment, path: root },
    };
    const attempt = CompletionRecordSchema.parse({
      version: ON_DISK_FORMATS.completionRecord.version,
      revision: 1,
      kind: "attempt",
      id: execution.attempt.identity.id,
      data: execution.attempt,
    });
    const environment = CompletionRecordSchema.parse({
      version: ON_DISK_FORMATS.completionRecord.version,
      revision: 1,
      kind: "environment",
      id: execution.environment_id,
      data: execution.environment,
    });
    for (const record of [attempt, environment]) {
      assertEquals(
        (await writeCompletionRecord(
          root,
          record,
          null,
          undefined,
          COMPLETION_CLOCK,
        )).kind,
        "written",
      );
    }
    assertEquals(
      (await writeCompletionRecord(
        root,
        CompletionRecordSchema.parse({
          version: ON_DISK_FORMATS.completionRecord.version,
          revision: 1,
          kind: "candidate",
          id: snap.candidate_id,
          data: snap.candidate,
        }),
        null,
        execution.fence,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const Command = Deno.Command;
    Deno.Command = class extends Command {
      /** Count native administration discovery without replacing its result. */
      constructor(command: string | URL, options?: Deno.CommandOptions) {
        super(command, options);
        if (options?.args?.includes("--git-common-dir")) {
          verificationQueries += 1;
        }
      }
    };
    try {
      await runtime.verify(execution);
      assertEquals(
        observedVerificationQueries,
        1,
        "one record inventory per verification",
      );
    } finally {
      Deno.Command = Command;
    }
    const result = await evaluator.execute(plan, execution);
    assertEquals(result.blockers, []);
    assertEquals(result.evidence.length, 2);
    for (const [index, data] of result.evidence.entries()) {
      assertEquals(
        (await writeCompletionRecord(
          root,
          CompletionRecordSchema.parse({
            version: ON_DISK_FORMATS.completionRecord.version,
            revision: 1,
            kind: "evidence",
            id: completionId(500 + index),
            data,
          }),
          null,
          execution.fence,
          COMPLETION_CLOCK,
        )).kind,
        "written",
      );
    }
    const current = await readCompletionRecord(root, attempt);
    assert(current.kind === "recorded");
    assertEquals(
      (await writeCompletionRecord(
        root,
        CompletionRecordSchema.parse({
          ...attempt,
          revision: 2,
          data: {
            ...execution.attempt,
            state: { kind: "finished", outcome: "passed", finished_at: 110 },
          },
        }),
        current.stamp,
        execution.fence,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const assembler = assemblyRecord(snap);
    assertEquals(
      (await writeCompletionRecord(
        root,
        assembler,
        null,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const after = await evaluator.observe(snap.candidate_id);
    const records = after.records.flatMap(({ reading }) =>
      reading.kind === "recorded" ? [reading.record] : []
    );
    const assembled = evaluator.assemble(
      snap.candidate_id,
      snap.candidate,
      snap.requirements,
      records,
      "strict",
    );
    assert(assembled.kind === "complete");
    assert(assembler.data.state.kind === "claimed");
    assertEquals(
      (await writeCompletionRecord(
        root,
        CompletionRecordSchema.parse({
          version: ON_DISK_FORMATS.completionRecord.version,
          revision: 1,
          kind: "proof",
          id: completionId(800),
          data: assembled.proof,
        }),
        null,
        { attempt_id: assembler.id, token: assembler.data.state.claim.token },
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const audit = await auditArtifacts(root, result.evidence);
    assert(
      result.evidence.every((e) =>
        e.artifacts.every((a) => audit.has(artifactKey(a)))
      ),
    );
    assertEquals(
      evaluator.plan(after, {
        kind: "standards",
        context: "local",
        mode: "strict",
        requirements: snap.requirements,
      }, snap.candidate_id).producers.length,
      1,
    );
    for (const kind of ["pin", "proposal"] as const) {
      assertEquals(
        evaluator.plan(after, {
          kind,
          context: "local",
          mode: "strict",
          requirements: snap.requirements,
        }, snap.candidate_id).producers,
        [],
      );
    }
  });
});
