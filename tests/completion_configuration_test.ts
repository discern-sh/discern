import { assert, assertEquals } from "@std/assert";
import { applyConfigDoc, configDocFillPaths } from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  CompletionPolicySchema,
  EnvironmentDeclarationSchema,
  planStandardInput,
  ProducerDeclarationSchema,
  StandardInputSchema,
} from "../src/shared/config_schema.ts";
import {
  configDocSchema,
  governingConfigValue,
  parseConfig,
  validateConfigValue,
} from "../src/shared/config_schema.ts";

Deno.test("E17 run remains a producer and extract is a separate operation", () => {
  const inline = planStandardInput({
    run: "instrument tests",
    extract: "read metrics",
  });
  assertEquals(inline.producer, { kind: "inline", run: ["instrument tests"] });
  assertEquals(inline.extraction, {
    run: ["read metrics"],
    input: { kind: "output" },
  });
  const shared = planStandardInput({
    producer: "jobs.test",
    extract: "read metrics",
    artifact: "coverage/report.json",
  });
  assertEquals(shared.producer, { kind: "reference", selector: "jobs.test" });
  assertEquals(shared.extraction, {
    run: ["read metrics"],
    input: { kind: "artifact", path: "coverage/report.json" },
  });
  assertEquals(
    planStandardInput({ producer: "scopes.site.gate" }).extraction,
    null,
  );
  assertEquals(
    ProducerDeclarationSchema.parse({ run: "instrument tests" }).run,
    "instrument tests",
  );
  for (
    const input of [
      { run: "read metrics", producer: "jobs.test" },
      { producer: "jobs.test", artifact: "coverage/report.json" },
      { producer: "unknown.test", extract: "read metrics" },
      { extract: "read metrics" },
    ]
  ) assertEquals(StandardInputSchema.safeParse(input).success, false);
});

Deno.test("completion declarations require distinct contexts and executable return procedures", () => {
  assertEquals(CompletionPolicySchema.parse({}), {
    required_contexts: ["local"],
    concurrency: 1,
    lookahead: 0,
  });
  for (
    const policy of [
      { required_contexts: [] },
      { required_contexts: ["local", "local"] },
      { concurrency: 0 },
      { lookahead: -1 },
    ]
  ) {
    assertEquals(CompletionPolicySchema.safeParse(policy).success, false);
  }
  const common = {
    prepare: "prepare resources",
    reusable: true,
    resources: ["db"],
    ignored: ["cache/**"],
    inputs: ["scripts/**"],
    capacity: 1,
  };
  assertEquals(
    EnvironmentDeclarationSchema.safeParse({ ...common, kind: "borrowed" })
      .success,
    false,
  );
  assertEquals(
    EnvironmentDeclarationSchema.safeParse({
      ...common,
      kind: "borrowed",
      restore: "restore resources",
    }).success,
    true,
  );
  assertEquals(
    EnvironmentDeclarationSchema.safeParse({
      ...common,
      kind: "isolated",
      dispose: "dispose resources",
    }).success,
    false,
  );
  assertEquals(
    EnvironmentDeclarationSchema.safeParse({
      ...common,
      kind: "isolated",
      dispose: "dispose resources",
      reset: "reset resources",
    }).success,
    true,
  );
});

Deno.test("public completion refuses deferrals and preserves committed governing policy", () => {
  for (const measure of ["gate", "on-demand"]) {
    const text =
      `[standards.coverage]\ndirection = 'up'\nlimit = 90\nrun = 'measure'\nmeasure = '${measure}'\n`;
    assertEquals(parseConfig(text).config, undefined);
    const raw = {
      standards: {
        coverage: { direction: "up", limit: 90, run: "measure", measure },
      },
      checkpoints: {
        review: { question: "Review this change", paths: ["**"] },
      },
    };
    const governed = validateConfigValue(governingConfigValue(raw));
    assert(governed.config !== undefined);
    assertEquals(governed.config.standards.coverage?.limit, 90);
    assertEquals(
      governed.config.checkpoints.review?.question,
      "Review this change",
    );
    assertEquals(raw.standards.coverage.measure, measure);
  }
  assertEquals(
    validateConfigValue(
      governingConfigValue({
        standards: {
          m: { run: "measure", direction: "up", limit: 1, measure: "unknown" },
        },
      }),
    ).config,
    undefined,
  );
});

Deno.test("setup writes complete producer, consumer, policy and environment declarations", () => {
  const job = {
    run: "instrument tests",
    timeout: 120,
    inputs: ["src/**"],
    needs: ["jobs.build"],
    artifacts: ["dist/readings"],
    environment: ["CI"],
    toolchain: ["lockfile"],
    contexts: ["local", "remote"],
  };
  const declaration = {
    kind: "borrowed" as const,
    prepare: "prepare",
    restore: "restore",
    reusable: true,
    resources: [],
    ignored: ["dist/**"],
    inputs: ["**"],
    capacity: 1,
  };
  const doc = configDocSchema.parse({
    jobs: { test: job, build: "build" },
    standards: {
      coverage: {
        producer: "jobs.test",
        extract: "extract",
        artifact: "dist/readings",
        direction: "up",
        limit: 90,
      },
    },
    completion: {
      required_contexts: ["local", "remote"],
      concurrency: 2,
      lookahead: 1,
    },
    execution: { local: declaration },
  });
  const editor = new TomlEditor("");
  const report = applyConfigDoc(editor, doc);
  assertEquals(report.filled.toSorted(), configDocFillPaths(doc).toSorted());
  const configured = parseConfig(editor.toString());
  assert(configured.config !== undefined, JSON.stringify(configured.issues));
  assertEquals(configured.config.jobs.test, job);
  assertEquals(configured.config.execution.local, declaration);
  assertEquals(configured.config.completion, doc.completion);
  assertEquals(configured.config.standards.coverage?.producer, "jobs.test");
});

Deno.test("public producer declarations preserve omitted facts without leaking runtime defaults", () => {
  const parsed = parseConfig(
    "[jobs.check]\nstage='check'\nrun='check'\n[scopes.app]\npaths=['**']\ngate='verify'\n[standards.count]\ndirection='down'\nlimit=0\nrun='count'\n",
  );
  assert(parsed.config !== undefined);
  for (
    const value of [
      parsed.config.jobs.check,
      parsed.config.scopes.app,
      parsed.config.standards.count,
    ]
  ) {
    assert(typeof value === "object" && value !== null);
    for (const field of ["needs", "artifacts", "environment", "toolchain"]) {
      assertEquals(Object.hasOwn(value, field), false, field);
    }
  }
  assertEquals(ProducerDeclarationSchema.parse({ run: "produce" }).needs, []);
});
