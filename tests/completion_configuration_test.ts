import { assert, assertEquals } from "@std/assert";
import {
  CompletionPolicySchema,
  EnvironmentDeclarationSchema,
  planStandardInput,
  ProducerDeclarationSchema,
  StandardInputSchema,
} from "../src/engine/completion/configuration.ts";
import { parseConfig } from "../src/shared/config_schema.ts";

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

Deno.test("1A leaves unsupported completion configuration rejected by the live parser", () => {
  for (
    const text of [
      "[completion]\nlookahead = 1\n",
      "[execution.local]\nkind = 'borrowed'\n",
      "[standards.coverage]\ndirection = 'up'\nlimit = 90\nproducer = 'jobs.test'\nextract = 'read metrics'\n",
    ]
  ) {
    const result = parseConfig(text);
    assertEquals(result.config, undefined);
    assert(result.issues.length > 0);
  }
  const current = parseConfig(
    "[standards.coverage]\ndirection = 'up'\nlimit = 90\nrun = 'measure'\nmeasure = 'on-demand'\n",
  );
  assert(current.config !== undefined);
  assertEquals(current.config.standards.coverage?.run, "measure");
});
