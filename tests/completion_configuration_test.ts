import { configuredValidation } from "../src/engine/validation/configuration.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import { assert, assertEquals } from "@std/assert";
import { applyConfigDoc, configDocFillPaths } from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  loadConfig,
  planStandardInput,
  ProducerDeclarationSchema,
  StandardInputSchema,
} from "../src/shared/config_schema.ts";
import {
  commands,
  resolveProducerGraph,
} from "../src/engine/validation/catalog.ts";
import { fromFileUrl } from "@std/path";
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
  const unknown = {
    standards: {
      m: { run: "measure", direction: "up", limit: 1, measure: "unknown" },
    },
  };
  const governed = validateConfigValue(governingConfigValue(unknown));
  assert(governed.config !== undefined);
  assertEquals(governed.config.standards.m?.limit, 1);
  assertEquals(unknown.standards.m.measure, "unknown");
});

Deno.test("setup writes complete producer and consumer declarations", () => {
  const job = {
    run: "instrument tests",
    timeout: 120,
    inputs: ["src/**"],
    needs: ["jobs.build"],
    artifacts: ["dist/readings"],
    environment: ["CI"],
    toolchain: ["lockfile"],
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
  });
  const editor = new TomlEditor("");
  const report = applyConfigDoc(editor, doc);
  assertEquals(report.filled.toSorted(), configDocFillPaths(doc).toSorted());
  const configured = parseConfig(editor.toString());
  assert(configured.config !== undefined, JSON.stringify(configured.issues));
  assertEquals(configured.config.jobs.test, job);
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

Deno.test("test capacity never invents dependencies between independent check and measurement producers", async () => {
  for (const cap of [0, 1]) {
    const jobs = Object.entries(KNOWN_JOBS).filter(([, stage]) =>
      stage === "check" || stage === "test"
    ).map(([name]) => `${name} = "echo ${name}"`).join("\n");
    const parsed = parseConfig(
      `[gate]\nconcurrent_test_runs = ${cap}\n[jobs]\n${jobs}\n[jobs.independent_inspection]\nrun = 'echo inspect'\nstage = 'check'\n[jobs.future_verification]\nrun = 'echo verify'\nstage = 'test'\n[standards.reading]\nrun = 'echo DISCERN_METRIC reading 0'\ndirection = 'down'\nlimit = 0\n`,
    );
    assert(parsed.config !== undefined);
    const graph = await configuredValidation(parsed.config, []);
    const checks = [...graph.stages].filter(([, stage]) => stage === "check")
      .map(([selector]) => selector);
    for (const [selector, stage] of graph.stages) {
      if (stage !== "test" && stage !== "standards") continue;
      for (const check of checks) {
        assertEquals(
          graph.ordering.get(selector)?.includes(check) ?? false,
          false,
          `${selector} after ${check}, cap ${cap}`,
        );
      }
    }
  }
});

Deno.test("repository repeated commands have one declared producer owner", async () => {
  const config = await loadConfig(fromFileUrl(new URL("../", import.meta.url)));
  const configured = await configuredValidation(config, []);
  const graph = resolveProducerGraph(
    configured.producers,
    configured.obligations,
  );
  const owners = new Map<string, string>();
  for (const [selector, producer] of graph.producers) {
    const command = JSON.stringify(commands(producer.recipe.run));
    assertEquals(
      owners.get(command),
      undefined,
      `${selector} repeats ${owners.get(command)}`,
    );
    owners.set(command, selector);
  }
});
