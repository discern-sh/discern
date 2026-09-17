/**
 * CLI tests for `discern config <subcommand>` (ADR 0005), run as subprocesses so
 * Cliffy parsing, the global flags, JSON output, and exit codes are exercised for
 * real. Each case edits a fresh install and asserts the resulting discern.toml
 * (including that comments survive); the cases that start from the plain
 * scaffold share one `setup begin` through pristine copies
 * (`withPristineInstalls`) instead of scaffolding per case.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { recordConfigPaths } from "../src/shared/config_codegen.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import {
  parseConfigOrThrow,
  RECORD_ENTRY_SCHEMAS,
} from "../src/shared/config_schema.ts";
import { HINTS } from "../src/shared/hints.ts";
import { RETIRED_CONFIG_KEY_REDIRECTS } from "../src/shared/vocabulary.ts";
import { withResultObserver } from "../src/shared/result_capture.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import { runConfigSet } from "../src/commands/config.ts";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { withPristineInstalls } from "./engine_surface_fixture.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { buildCli } from "../src/main.ts";

/** Require authored result text before testing its wording. */
function resultMessage(result: { message?: string | undefined }): string {
  assertExists(result.message);
  return result.message;
}

/** Scaffold a fresh install in `dir`. */
async function setup(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# Fixture\n");
  await gitInit(dir);
  const r = await runCli(
    [
      "setup",
      "begin",
      "--confirmed",
      "--slug",
      "demo",
      "--name",
      "Demo",
    ],
    dir,
  );
  assertEquals(r.code, 0, r.stderr);
}

/** Read the project's discern.toml. */
function readToml(dir: string): Promise<string> {
  return Deno.readTextFile(join(dir, "discern.toml"));
}

/** Active assignment keys inside one section, in written order. */
function sectionKeys(text: string, section: string): string[] {
  const lines = text.split("\n");
  const header = lines.findIndex((l) => l.trim() === `[${section}]`);
  assert(header !== -1, `missing [${section}]`);
  const keys: string[] = [];
  for (const line of lines.slice(header + 1)) {
    if (/^\s*\[/.test(line)) break;
    const key = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

/** Byte offset of a section's header line, wherever the depth indent put it. */
function headerOffset(text: string, section: string): number {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\n\\s*\\[${escaped}\\]\\n`).exec(text);
  assert(match !== null, `missing [${section}]`);
  return match.index;
}

Deno.test("config set-job cases run over pristine copies of one scaffolded install", async (t) => {
  await withPristineInstalls(t, setup, [
    [
      "config set-job fills a known job and preserves comments",
      async (dir) => {
        const r = await runCli(
          ["config", "set-job", "test", "vitest run", "--json"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, true);
        assertEquals(result.verb, "config");
        assertResultDataKey(result, "edits");
        assert(
          result.data.edits.some((e: { key: string }) => e.key === "jobs.test"),
        );

        const toml = await readToml(dir);
        assertStringIncludes(toml, 'test = "vitest run"');
        // A section comment from the template survives the edit.
        assertStringIncludes(
          toml,
          generatedArtifactMarker(ARTIFACT_PROVENANCE_SOURCES.config),
        );
        await assertDiscernTomlTidy(dir, "config set-job");
      },
    ],
    [
      "config set-job names an empty command as deferred, on both surfaces",
      async (dir) => {
        // `set-job <name> ""` silently meant "deferred" — present but a no-op the
        // gate skips. The success output must say so, or a silent success reads as "wired".
        const r = await runCli(
          ["config", "set-job", "test", "", "--json"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, true);
        assertResultDataKey(result, "edits");
        const expected = assertHasHint(
          result,
          HINTS["config-job-deferred"],
          { name: "test" },
        );

        const human = await runCli(["config", "set-job", "test", ""], dir);
        assertEquals(human.code, 0, human.stderr);
        assertTerminalTextIncludes(human.stderr + human.stdout, expected);

        // A real command carries no such hint.
        const wired = await runCli(
          ["config", "set-job", "test", "vitest run", "--json"],
          dir,
        );
        assertLacksHint(
          decodeCliResult(wired.stdout, "config"),
          HINTS["config-job-deferred"],
          { name: "test" },
        );
      },
    ],
    [
      "config set-job round-trips the smoke known job (ADR 0090)",
      async (dir) => {
        // `smoke` is a first-class known job (stage: test), so set-job accepts
        // it and the written line re-parses cleanly — the same path every known job takes.
        const r = await runCli(
          // `true` is a real, PATH-resolvable stand-in for a boot check (so doctor stays
          // green); the point is that `smoke` takes the same accept→write→load path as any
          // known job.
          ["config", "set-job", "smoke", "true", "--json"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, true);
        assertResultDataKey(result, "edits");
        assert(
          result.data.edits.some((e: { key: string }) =>
            e.key === "jobs.smoke"
          ),
        );
        assertStringIncludes(await readToml(dir), 'smoke = "true"');
        // The install still loads cleanly with smoke wired.
        const doctor = await runCli(["doctor", "--json"], dir);
        assertEquals(decodeCliResult(doctor.stdout, "doctor").ok, true);
      },
    ],
    [
      "every known job accepts an ordered --run list from the canonical set",
      async (dir) => {
        for (
          const name of Object.keys(KNOWN_JOBS) as Array<
            keyof typeof KNOWN_JOBS
          >
        ) {
          const first = `${name} first  --literal='* ? [ ]'`;
          const second = `  ${name} second && printf '%s' "$VALUE"  `;
          const result = await runCli(
            [
              "config",
              "set-job",
              name,
              "--run",
              first,
              "--run",
              second,
              "--json",
            ],
            dir,
          );
          assertEquals(
            result.code,
            0,
            `${name}: ${result.stdout}${result.stderr}`,
          );
          const config = parseConfigOrThrow(await readToml(dir));
          assertEquals(
            config.jobs[name],
            [first, second],
            `${name} did not preserve command order and literal bytes`,
          );
        }
      },
    ],
    [
      "config set-job replaces scalar and list forms without stale values and is idempotent",
      async (dir) => {
        const scalar = await runCli(
          ["config", "set-job", "lint", "deno lint"],
          dir,
        );
        assertEquals(scalar.code, 0, scalar.stderr);
        assertEquals(
          parseConfigOrThrow(await readToml(dir)).jobs.lint,
          "deno lint",
        );

        const listArgs = [
          "config",
          "set-job",
          "lint",
          "--run",
          "deno lint",
          "--run",
          "deno fmt --check",
        ];
        const list = await runCli(listArgs, dir);
        assertEquals(list.code, 0, list.stderr);
        const once = await readToml(dir);
        assertEquals(parseConfigOrThrow(once).jobs.lint, [
          "deno lint",
          "deno fmt --check",
        ]);

        const repeated = await runCli(listArgs, dir);
        assertEquals(repeated.code, 0, repeated.stderr);
        assertEquals(await readToml(dir), once);

        const back = await runCli(
          ["config", "set-job", "lint", "deno lint --compact"],
          dir,
        );
        assertEquals(back.code, 0, back.stderr);
        assertEquals(
          parseConfigOrThrow(await readToml(dir)).jobs.lint,
          "deno lint --compact",
        );
      },
    ],
    [
      "config set-job ordered dry-run reports one array edit and writes nothing",
      async (dir) => {
        const before = await readToml(dir);
        const result = await runCli(
          [
            "config",
            "set-job",
            "format",
            "--run",
            "prettier --write .",
            "--run",
            "discern tidy",
            "--dry-run",
            "--json",
          ],
          dir,
        );
        assertEquals(result.code, 0, result.stderr);
        const envelope = decodeCliResult(result.stdout, "config");
        assertEquals(envelope.dry_run, true);
        assertResultDataKey(envelope, "edits");
        assertEquals(envelope.data.edits, [{
          key: "jobs.format",
          literal: '["prettier --write .", "discern tidy"]',
        }]);
        assertEquals(await readToml(dir), before);
      },
    ],
    [
      "config set-job refuses ambiguous, empty, and serialized-list forms without writing",
      async (dir) => {
        const cases: Array<{ args: string[]; includes: string }> = [
          {
            args: [
              "config",
              "set-job",
              "format",
              "prettier --write .",
              "--run",
              "discern tidy",
            ],
            includes: "cannot combine",
          },
          {
            args: ["config", "set-job", "format", "--run", ""],
            includes: "non-empty command",
          },
          {
            args: [
              "config",
              "set-job",
              "format",
              "--run",
              "prettier --write .",
              "--run",
              "   ",
            ],
            includes: "non-empty command",
          },
          {
            args: [
              "config",
              "set-job",
              "format",
              '["prettier --write .", "discern tidy"]',
            ],
            includes: "one literal command",
          },
          {
            args: [
              "config",
              "set-job",
              "format",
              "--stage",
              "fix",
              "--run",
              "prettier --write .",
            ],
            includes: "remove --stage",
          },
        ];

        for (const testCase of cases) {
          const before = await readToml(dir);
          const result = await runCli([...testCase.args, "--json"], dir);
          assertEquals(
            result.code,
            1,
            `${testCase.args.join(" ")}: ${result.stdout}${result.stderr}`,
          );
          const envelope = decodeCliResult(result.stdout, "config");
          assertStringIncludes(resultMessage(envelope), testCase.includes);
          assertStringIncludes(
            resultMessage(envelope),
            "discern config set-job",
          );
          assertStringIncludes(resultMessage(envelope), "--run");
          assertEquals(await readToml(dir), before);
        }
      },
    ],
    [
      "config set-job parser refusals preserve the file and serve the ordered syntax",
      async (dir) => {
        const cases = [
          {
            args: ["config", "set-job", "format", "--run", "--json"],
            correction: "discern config set-job format --run '<command>'",
          },
          {
            args: ["config", "set-job", "format", "first", "second", "--json"],
            correction:
              "discern config set-job format --run '<command>' --run '<next-command>'",
          },
        ];
        for (const { args, correction } of cases) {
          const before = await readToml(dir);
          const result = await runCli(args, dir);
          assert(result.code !== 0, `${args.join(" ")} unexpectedly succeeded`);
          const envelope = decodeCliResult(result.stdout, "config");
          assertEquals(envelope.error, "invalid_arguments");
          assertStringIncludes(
            resultMessage(envelope),
            correction,
          );
          assertEquals(await readToml(dir), before);
        }
      },
    ],
    [
      "config set-job removes known-job-only options without changing the requested applicability action",
      async (dir) => {
        for (const option of ["--stage", "--provides"] as const) {
          const before = await readToml(dir);
          const result = await runCli(
            [
              "config",
              "set-job",
              "build",
              option,
              option === "--stage" ? "build" : "artifact",
              "--not-applicable",
              "--json",
            ],
            dir,
          );
          assertEquals(result.code, 1);
          assertTerminalTextIncludes(
            resultMessage(decodeCliResult(result.stdout, "config")),
            "discern config set-job build --not-applicable",
          );
          assertEquals(await readToml(dir), before);
        }
      },
    ],
    [
      "record-setting flags write every supported schema knob",
      async (dir) => {
        const job = await runCli([
          "config",
          "set-job",
          "audit",
          "--stage",
          "check",
          "--run",
          ":",
          "--provides",
          "contract",
          "--timeout",
          "12",
        ], dir);
        assertEquals(job.code, 0, job.stderr);
        const scope = await runCli([
          "config",
          "set-scope",
          "api",
          "src/**",
          "--neutral",
          "--preview",
          "git diff",
          "--gate",
          "deno check src/main.ts",
          "--timeout",
          "30",
        ], dir);
        assertEquals(scope.code, 0, scope.stderr);
        const standard = await runCli([
          "config",
          "set-standard",
          "density",
          "--direction",
          "down",
          "--limit",
          "4",
          "--run",
          "measure",
          "--metric",
          "words",
          "--per",
          "lines=src/**",
          "--scale",
          "1000",
          "--margin",
          "0.1",
          "--extract",
          "extract metrics",
          "--inputs",
          "src/**",
          "--inputs",
          "tests/**",
          "--timeout",
          "60",
        ], dir);
        assertEquals(standard.code, 0, standard.stderr);

        const parsed = parseConfigOrThrow(await readToml(dir));
        assertEquals(parsed.jobs.audit, {
          stage: "check",
          run: ":",
          provides: "contract",
          timeout: 12,
        });
        assertEquals(parsed.scopes.api, {
          paths: ["src/**"],
          neutral: true,
          preview: "git diff",
          gate: "deno check src/main.ts",
          timeout: 30,
        });
        assertEquals(parsed.standards.density, {
          metric: "words",
          direction: "down",
          limit: 4,
          run: "measure",
          per: { lines: "src/**" },
          scale: 1000,
          margin: 0.1,
          extract: "extract metrics",
          inputs: ["src/**", "tests/**"],
          timeout: 60,
        });
      },
    ],
    [
      "config set-job marks and unmarks known-job applicability through the canonical set",
      async (dir) => {
        const configPath = join(dir, "discern.toml");
        await Deno.writeTextFile(
          configPath,
          (await Deno.readTextFile(configPath)).replace(
            /^\s*format\s*=.*\n/m,
            "",
          ),
        );

        for (
          const name of Object.keys(KNOWN_JOBS) as Array<
            keyof typeof KNOWN_JOBS
          >
        ) {
          const marked = await runCli(
            ["config", "set-job", name, "--not-applicable", "--json"],
            dir,
          );
          assertEquals(
            marked.code,
            0,
            `${name}: ${marked.stdout}${marked.stderr}`,
          );
          assert(
            parseConfigOrThrow(await readToml(dir)).setup.not_applicable
              .includes(name),
            `${name} was not recorded as not applicable`,
          );

          const beforeRepeat = await readToml(dir);
          const repeated = await runCli(
            ["config", "set-job", name, "--not-applicable"],
            dir,
          );
          assertEquals(repeated.code, 0, repeated.stderr);
          assertEquals(await readToml(dir), beforeRepeat);

          const unmarked = await runCli(
            ["config", "set-job", name, "--applicable"],
            dir,
          );
          assertEquals(unmarked.code, 0, unmarked.stderr);
          assert(
            !parseConfigOrThrow(await readToml(dir)).setup.not_applicable
              .includes(name),
            `${name} remained not applicable`,
          );
        }
      },
    ],
    [
      "config set-job refuses applicability contradictions and auto-unmarks when a command is set",
      async (dir) => {
        await runCli(["config", "set-job", "build", "--not-applicable"], dir);

        const beforeDryRun = await readToml(dir);
        const preview = await runCli(
          [
            "config",
            "set-job",
            "build",
            "--run",
            "deno task build",
            "--dry-run",
            "--json",
          ],
          dir,
        );
        assertEquals(preview.code, 0, preview.stderr);
        const previewResult = decodeCliResult(preview.stdout, "config");
        assertResultDataKey(previewResult, "edits");
        assertEquals(previewResult.data.edits, [
          { key: "jobs.build", literal: '["deno task build"]' },
          { key: "setup.not_applicable", literal: "[]" },
        ]);
        assertEquals(await readToml(dir), beforeDryRun);

        const set = await runCli(
          ["config", "set-job", "build", "--run", "deno task build"],
          dir,
        );
        assertEquals(set.code, 0, set.stderr);
        const configured = parseConfigOrThrow(await readToml(dir));
        assertEquals(configured.jobs.build, ["deno task build"]);
        assert(!configured.setup.not_applicable.includes("build"));

        const beforeConfiguredMark = await readToml(dir);
        const contradiction = await runCli(
          ["config", "set-job", "build", "--not-applicable", "--json"],
          dir,
        );
        assertEquals(contradiction.code, 1);
        assertStringIncludes(
          resultMessage(decodeCliResult(contradiction.stdout, "config")),
          "configured",
        );
        assertEquals(await readToml(dir), beforeConfiguredMark);

        const custom = await runCli(
          ["config", "set-job", "deploy", "--not-applicable", "--json"],
          dir,
        );
        assertEquals(custom.code, 1);
        assertTerminalTextIncludes(
          resultMessage(decodeCliResult(custom.stdout, "config")),
          "known job",
        );
        assertEquals(await readToml(dir), beforeConfiguredMark);
      },
    ],
    [
      "config set-job requires the table form for a custom name",
      async (dir) => {
        const r = await runCli(
          ["config", "set-job", "deploy", "deploy.sh", "--json"],
          dir,
        );
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(resultMessage(result), "table form");
        assertStringIncludes(resultMessage(result), "--stage");
      },
    ],
    [
      "config set-job writes a custom job table",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-job",
            "licenses",
            "--stage",
            "check",
            "--run",
            "license-scan",
            "--provides",
            "license-audit",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, true);
        assertResultDataKey(result, "edits");
        assert(
          result.data.edits.some((e: { key: string }) =>
            e.key === "jobs.licenses.run"
          ),
        );
        const toml = await readToml(dir);
        assertStringIncludes(toml, "[jobs.licenses]");
        assertStringIncludes(toml, 'stage = "check"');
        assertStringIncludes(toml, 'run = "license-scan"');
        assertStringIncludes(toml, 'provides = "license-audit"');
        assert(
          toml.indexOf("# [jobs]") < headerOffset(toml, "jobs.licenses") &&
            headerOffset(toml, "jobs.licenses") <
              toml.indexOf("# [scopes.<name>]"),
          "the first custom job should land inside the jobs region",
        );
        assertEquals(sectionKeys(toml, "jobs.licenses"), [
          "stage",
          "run",
          "provides",
        ]);
      },
    ],
    [
      "config set-job rejects an unknown stage",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-job",
            "x",
            "--stage",
            "deploy",
            "--run",
            "y",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(resultMessage(result), "unknown stage");
      },
    ],
    [
      "config set-job forbids --stage on a known name",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-job",
            "test",
            "--stage",
            "test",
            "--run",
            "vitest run",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 1);
        assertTerminalTextIncludes(
          resultMessage(decodeCliResult(r.stdout, "config")),
          "derives stage",
        );
      },
    ],
  ]);
});

Deno.test("config set-job writes two formatter commands that the Gate executes in order", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const marker = await Deno.makeTempFile({
      prefix: "discern-ordered-format-",
    });
    const quotedMarker = `'${marker.replaceAll("'", "'\\''")}'`;
    try {
      const configured = await runCli(
        [
          "config",
          "set-job",
          "format",
          "--run",
          `printf 'first\\n' >> ${quotedMarker}`,
          "--run",
          `printf 'second\\n' >> ${quotedMarker}`,
        ],
        dir,
      );
      assertEquals(configured.code, 0, configured.stderr);

      const prepared = await runAgent(dir, ["prepare", "--json"]);
      assertEquals(prepared.code, 0, prepared.output);
      assertEquals(await Deno.readTextFile(marker), "first\nsecond\n");
    } finally {
      await Deno.remove(marker).catch(() => undefined);
    }
  });
});

Deno.test("config set-job help teaches ordered commands and applicability from the live registry", async () => {
  await withTempDir(async (dir) => {
    const help = await runCli(["config", "set-job", "--help"], dir);
    assertEquals(help.code, 0, help.stderr);
    assertTerminalTextIncludes(help.stdout, "repeatable ordered --run");
    assertTerminalTextIncludes(help.stdout, "--run <command>");
    assertTerminalTextIncludes(help.stdout, "repeat to preserve order");
    assertStringIncludes(help.stdout, "--not-applicable");
    assertStringIncludes(help.stdout, "--applicable");
  });
});

Deno.test("record-setting command options stay in parity with their entry schemas", () => {
  const root = buildCli(false);
  const config = root.getCommand("config", true);
  assert(config !== undefined);
  const bindings: Readonly<
    Record<
      string,
      | {
        command: string;
        positional: readonly string[];
        commandOnly: readonly string[];
      }
      | { command: null; reason: string }
    >
  > = {
    jobs: {
      command: "set-job",
      positional: [],
      commandOnly: ["not_applicable", "applicable", "dry_run"],
    },
    scopes: {
      command: "set-scope",
      positional: ["paths"],
      commandOnly: ["dry_run"],
    },
    generated: {
      command: null,
      reason: "generated groups use config set <dotted.key>",
    },
    standards: {
      command: "set-standard",
      positional: [],
      commandOnly: ["dry_run"],
    },
    checkpoints: {
      command: null,
      reason: "checkpoints use config set <dotted.key>",
    },
    "worktree.resources": {
      command: null,
      reason: "resources use config set <dotted.key>",
    },
  };
  assertEquals(
    Object.keys(bindings).sort(),
    Object.keys(RECORD_ENTRY_SCHEMAS).sort(),
    "a new record family must choose a dedicated command or a documented generic-set route",
  );
  const globalOptionKeys = new Set(
    root.getOptions(false).map((option) => option.name.replaceAll("-", "_")),
  );
  for (const [family, schema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    const binding = bindings[family];
    assert(binding !== undefined);
    if (binding.command === null) {
      assertStringIncludes(binding.reason, "config set <dotted.key>");
      continue;
    }
    const command = config.getCommand(binding.command, true);
    assert(command !== undefined, binding.command);
    const optionKeys = command.getOptions(false).map((option) =>
      option.name.replaceAll("-", "_")
    ).filter((key) =>
      !binding.commandOnly.includes(key) && !globalOptionKeys.has(key)
    );
    assertEquals(
      [...new Set([...binding.positional, ...optionKeys])].sort(),
      Object.keys(schema.shape).sort(),
      `${family} flags drifted from its record schema`,
    );
  }
  const description = config.getDescription();
  for (const word of ["generated", "checkpoints", "resources", "dotted.key"]) {
    assertStringIncludes(description, word);
  }
});

Deno.test("config set, dry-run, and read cases run over pristine copies of one scaffolded install", async (t) => {
  await withPristineInstalls(t, setup, [
    [
      "config set refuses an unknown key at write time (no bricked config)",
      async (dir) => {
        const before = await readToml(dir);
        const r = await runCli(
          ["config", "set", "project.frobnicate", "hello", "--json"],
          dir,
        );
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertEquals(result.error, "unknown_key");
        assertStringIncludes(resultMessage(result), "unknown config key");
        // The config is untouched — the bad key was never written.
        assertEquals(await readToml(dir), before);
        // And the install still loads cleanly.
        const doctor = await runCli(["doctor", "--json"], dir);
        assertEquals(decodeCliResult(doctor.stdout, "doctor").ok, true);
      },
    ],
    [
      "config set redirects a synthetic retired key to its successor",
      async (dir) => {
        const before = await readToml(dir);
        assertEquals(RETIRED_CONFIG_KEY_REDIRECTS, {});
        const redirects = { legacy_standards: "standards" } as const;
        const observed: DiscernResult[] = [];
        const code = await withResultObserver(
          (result) => observed.push(result),
          () =>
            runConfigSet(
              "legacy_standards.coverage.limit",
              "80",
              {
                json: true,
                noColor: true,
                dryRun: false,
                cwd: dir,
              },
              redirects,
            ),
        );
        assertEquals(code, 1);
        const envelope = observed[0];
        assertExists(envelope);
        assertEquals(envelope.error, "renamed_config_key");
        assertStringIncludes(
          resultMessage(envelope),
          "standards.coverage.limit",
        );
        assertEquals(await readToml(dir), before);
      },
    ],
    [
      "config set allows a valid-but-incomplete path (incremental table build)",
      async (dir) => {
        // Setting one key of a standard table before its siblings is legitimate.
        const r = await runCli(
          ["config", "set", "standards.coverage.limit", "80"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        assertStringIncludes(await readToml(dir), "limit = 80");
      },
    ],
    [
      "config set infers types (number / bool / string)",
      async (dir) => {
        await runCli(["config", "set", "standards.coverage.limit", "80"], dir);
        await runCli(["config", "set", "worktree.export_port", "false"], dir);
        await runCli(["config", "set", "repository.trunk", "trunk"], dir);
        const toml = await readToml(dir);
        assertStringIncludes(toml, "limit = 80"); // number (inferred)
        assertStringIncludes(toml, "export_port = false"); // bool (inferred)
        assertStringIncludes(toml, 'trunk = "trunk"'); // string (inferred)
      },
    ],
    [
      "config set renders the schema's type, not the value's spelling",
      async (dir) => {
        // The type at a path comes from the config schema, never from how the value
        // happens to look: a numeric-looking slug stays a string, a single agent name
        // lands as a one-element array, and JS-only exponent spelling is normalized.
        // Pre-fix, `slug = 2048` and `agents = "claude_code"` were written verbatim
        // with ok:true — and every later verb failed on the invalid config.
        const slug = await runCli(
          ["config", "set", "project.slug", "2048"],
          dir,
        );
        assertEquals(slug.code, 0, slug.stderr);
        const agents = await runCli(
          ["config", "set", "project.agents", "claude_code"],
          dir,
        );
        assertEquals(agents.code, 0, agents.stderr);
        const timeout = await runCli(
          ["config", "set", "gate.timeout", "0100"],
          dir,
        );
        assertEquals(timeout.code, 0, timeout.stderr);

        const toml = await readToml(dir);
        assertStringIncludes(toml, 'slug = "2048"'); // string key: quoted
        assertStringIncludes(toml, 'agents = ["claude_code"]'); // array key: wrapped
        assertStringIncludes(toml, "timeout = 100"); // integer key: valid TOML

        // A TOML-array-shaped value reaches an array key as the full array.
        const list = await runCli(
          ["config", "set", "project.agents", '["claude_code", "codex"]'],
          dir,
        );
        assertEquals(list.code, 0, list.stderr);
        assertStringIncludes(
          await readToml(dir),
          'agents = ["claude_code", "codex"]',
        );

        // The install still loads cleanly after every one of those writes.
        const doctor = await runCli(["doctor", "--json"], dir);
        assertEquals(
          decodeCliResult(doctor.stdout, "doctor").ok,
          true,
          doctor.stdout,
        );
      },
    ],
    [
      "config set refuses a value the next read would reject, leaving the file untouched",
      async (dir) => {
        const before = await readToml(dir);
        const cases: {
          args: string[];
          includes: string;
          error?: string;
        }[] = [
          // An enum-typed key names its closed vocabulary.
          {
            args: ["config", "set", "jobs.x.stage", "bogus"],
            includes: "must be one of: ",
          },
          // A non-number for a number key.
          {
            args: ["config", "set", "gate.timeout", "soon"],
            includes: "holds a number",
          },
          // A section path is not a settable key.
          {
            args: ["config", "set", "worktree.setup", "x"],
            includes: "is a section",
          },
          // A type flag that contradicts the schema.
          {
            args: ["config", "set", "project.slug", "5", "--number"],
            includes: "holds a string",
          },
          // The write-boundary backstop: well-typed but schema-invalid (map.dir
          // must stay inside the repository) is caught before anything is written.
          {
            args: ["config", "set", "map.dir", "../escape"],
            includes: "refusing this edit",
            error: "invalid_value",
          },
        ];
        for (const c of cases) {
          const r = await runCli([...c.args, "--json"], dir);
          assertEquals(
            r.code,
            1,
            `${c.args.join(" ")}: ${r.stdout}${r.stderr}`,
          );
          const result = decodeCliResult(r.stdout, "config");
          assertEquals(result.ok, false);
          assertStringIncludes(resultMessage(result), c.includes);
          if (c.error !== undefined) {
            assertEquals(result.error, c.error);
          }
          assertEquals(
            await readToml(dir),
            before,
            `${c.args.join(" ")} modified the file despite failing`,
          );
        }
      },
    ],
    [
      "config set refuses a non-canonical project slug",
      async (dir) => {
        const before = await readToml(dir);
        const result = await runCli([
          "config",
          "set",
          "project.slug",
          "Bad Slug",
          "--dry-run",
          "--json",
        ], dir);
        assertEquals(result.code, 1);
        const decoded = decodeCliResult(result.stdout, "config");
        assertEquals(decoded.ok, false);
        assertStringIncludes(resultMessage(decoded), "slug must be");
        assertEquals(await readToml(dir), before);
      },
    ],
    [
      "config set preserves the edited line's inline comment",
      async (dir) => {
        // Give a scalar line an inline comment, then edit it through the CLI: the
        // comment must ride along with the rewritten value.
        const path = join(dir, "discern.toml");
        await Deno.writeTextFile(
          path,
          (await Deno.readTextFile(path)).replace(
            "export_port = false",
            "export_port = false   # deterministic dev-server port",
          ),
        );
        const r = await runCli([
          "config",
          "set",
          "worktree.export_port",
          "true",
        ], dir);
        assertEquals(r.code, 0, r.stderr);
        assertStringIncludes(
          await readToml(dir),
          "export_port = true # deterministic dev-server port",
        );
      },
    ],
    [
      "config set --string forces a numeric-looking value to a string",
      async (dir) => {
        await runCli(["config", "set", "project.slug", "123", "--string"], dir);
        assertStringIncludes(await readToml(dir), 'slug = "123"');
      },
    ],
    [
      "config --dry-run writes nothing",
      async (dir) => {
        const before = await readToml(dir);
        const r = await runCli(
          [
            "config",
            "set-job",
            "test",
            "vitest run",
            "--dry-run",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        assertEquals(decodeCliResult(r.stdout, "config").dry_run, true);
        assertEquals(await readToml(dir), before); // unchanged
      },
    ],
    [
      "config set rejects a key without a section",
      async (dir) => {
        const r = await runCli(["config", "set", "slug", "x", "--json"], dir);
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(resultMessage(result), "key must be section.key");
      },
    ],
    [
      "config set rejects more than one type flag",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set",
            "project.slug",
            "1",
            "--number",
            "--bool",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(resultMessage(result), "at most one of");
      },
    ],
    [
      "config set --bool forces a boolean and rejects a non-boolean",
      async (dir) => {
        // Valid: "true"/"false" pass through tomlBool.
        const ok = await runCli(
          ["config", "set", "gate.stream_output", "true", "--bool"],
          dir,
        );
        assertEquals(ok.code, 0, ok.stderr);
        assertStringIncludes(await readToml(dir), "stream_output = true");

        // Invalid: a non-boolean value for a boolean key is refused.
        const bad = await runCli(
          ["config", "set", "gate.stream_output", "yes", "--bool", "--json"],
          dir,
        );
        assertEquals(bad.code, 1);
        const result = decodeCliResult(bad.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(resultMessage(result), "holds a boolean");
      },
    ],
    [
      "config set --number forces a numeric literal and rejects non-numbers",
      async (dir) => {
        // Valid: preserves the written form.
        const ok = await runCli(
          ["config", "set", "standards.coverage.limit", "0.0", "--number"],
          dir,
        );
        assertEquals(ok.code, 0, ok.stderr);
        assertStringIncludes(await readToml(dir), "limit = 0.0");

        // Invalid: --number with a non-number is rejected (tomlNumber throws).
        const bad = await runCli(
          [
            "config",
            "set",
            "standards.coverage.limit",
            "lots",
            "--number",
            "--json",
          ],
          dir,
        );
        assertEquals(bad.code, 1);
        assertEquals(decodeCliResult(bad.stdout, "config").ok, false);
      },
    ],
    [
      "config set prints a human success line without --json",
      async (dir) => {
        const r = await runCli(
          ["config", "set", "repository.trunk", "trunk"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        // Non-JSON path: the green summary goes to stderr; the edit line to stdout.
        assertTerminalTextIncludes(r.stderr, "Set repository.trunk.");
        assertTerminalTextIncludes(r.stdout, 'repository.trunk = "trunk"');
        assertStringIncludes(await readToml(dir), 'trunk = "trunk"');
      },
    ],
    [
      "config --dry-run prints the edit without --json and writes nothing",
      async (dir) => {
        const before = await readToml(dir);
        const r = await runCli(
          ["config", "set", "repository.trunk", "trunk", "--dry-run"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        // Human dry-run path: the "Dry run" notice goes to stderr (log.info), the
        // would-be edit line to stdout (log.line).
        assertTerminalTextIncludes(r.stderr, "Dry run");
        assertTerminalTextIncludes(r.stdout, 'repository.trunk = "trunk"');
        assertEquals(await readToml(dir), before); // unchanged
      },
    ],
    [
      "config set --dry-run --json reports the edit and writes nothing",
      async (dir) => {
        const before = await readToml(dir);
        const r = await runCli(
          ["config", "set", "project.slug", "renamed", "--dry-run", "--json"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.dry_run, true);
        assertResultDataKey(result, "edits");
        assertEquals(result.data.operation, "edit");
        assertEquals(result.data.file, "discern.toml");
        assert(
          result.data.edits.some((e) =>
            e.key === "project.slug" && e.literal === '"renamed"'
          ),
        );
        assertEquals(await readToml(dir), before); // unchanged
      },
    ],
    [
      "config reads keep bare shell output and use a discriminated envelope under --json",
      async (dir) => {
        const rawGet = await runCli(["config", "get", "project.slug"], dir);
        assertEquals(rawGet.code, 0, rawGet.stderr);
        assertEquals(rawGet.stdout, "demo\n");

        const rawMissing = await runCli(["config", "has", "missing.key"], dir);
        assertEquals(
          rawMissing.code,
          1,
          rawMissing.stdout + rawMissing.stderr,
        );
        assertEquals(rawMissing.stdout, "");

        const cases = [
          {
            args: ["config", "get", "project.slug"],
            operation: "get",
            check: (data: object) => {
              assert("value" in data);
              assertEquals(data.value, "demo");
            },
          },
          {
            args: ["config", "array", "project.slug"],
            operation: "array",
            check: (data: object) => {
              assert("values" in data);
              assertEquals(data.values, ["demo"]);
            },
          },
          {
            args: ["config", "has", "missing.key"],
            operation: "has",
            check: (data: object) => {
              assert("present" in data);
              assertEquals(data.present, false);
            },
          },
          {
            args: ["config", "subsections", "scopes"],
            operation: "subsections",
            check: (data: object) => {
              assert("values" in data);
              assert(Array.isArray(data.values));
            },
          },
          {
            args: ["config", "keys", "project"],
            operation: "keys",
            check: (data: object) => {
              assert("values" in data);
              assert(
                Array.isArray(data.values) && data.values.includes("slug"),
              );
            },
          },
        ] as const;

        for (const testCase of cases) {
          const result = await runCli([...testCase.args, "--json"], dir);
          assertEquals(
            result.code,
            0,
            `${testCase.args.join(" ")}: ${result.stdout}${result.stderr}`,
          );
          assertEquals(result.stderr, "");
          assertEquals(result.stdout.trim().includes("\n"), false);
          const envelope = decodeCliResult(result.stdout, "config");
          assertEquals(envelope.ok, true);
          assertEquals(envelope.verb, "config");
          assertResultDataKey(envelope, "operation");
          assertResultDataKey(envelope, "key");
          assertEquals(envelope.data.operation, testCase.operation);
          assertEquals(envelope.data.key, testCase.args[2]);
          testCase.check(envelope.data);
        }
      },
    ],
    [
      "bare config and malformed config reads are controlled JSON argument refusals",
      async (dir) => {
        for (
          const args of [
            ["config", "--json"],
            ["config", "get", "--json"],
          ]
        ) {
          const result = await runCli(args, dir);
          assert(
            result.code !== 0,
            `${args.join(" ")} should refuse: ${result.stdout}${result.stderr}`,
          );
          assertEquals(result.stderr, "");
          assertEquals(result.stdout.trim().includes("\n"), false);
          const envelope = decodeCliResult(result.stdout, "config");
          assertEquals(envelope.ok, false);
          assertEquals(envelope.verb, "config");
          assertEquals(envelope.error, "invalid_arguments");
          assert(
            Array.isArray(envelope.hints) && envelope.hints.length > 0,
            "the argument refusal should include registered recovery",
          );
        }
      },
    ],
  ]);
});

Deno.test("config set-scope and set-standard cases run over pristine copies of one scaffolded install", async (t) => {
  await withPristineInstalls(t, setup, [
    [
      "config set-scope sets a paths array",
      async (dir) => {
        const r = await runCli(
          ["config", "set-scope", "native", "native/**", "native/lib/**"],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const toml = await readToml(dir);
        assertStringIncludes(toml, "[scopes.native]");
        assertStringIncludes(toml, 'paths = ["native/**", "native/lib/**"]');
      },
    ],
    [
      "config set-scope folds in executable --preview and --gate actions",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-scope",
            "native",
            "native/**",
            "--preview",
            "make -C native preview",
            "--gate",
            "make -C native check",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const toml = await readToml(dir);
        assertStringIncludes(toml, 'preview = "make -C native preview"');
        assertStringIncludes(toml, 'gate = "make -C native check"');
      },
    ],
    [
      "config set-scope rejects the retired Boolean --previewable flag",
      async (dir) => {
        const result = await runCli(
          ["config", "set-scope", "native", "native/**", "--previewable"],
          dir,
        );
        assertEquals(result.code, 1, `${result.stdout}${result.stderr}`);
        assertTerminalTextIncludes(
          `${result.stdout}${result.stderr}`,
          "--preview <cmd>",
        );
      },
    ],
    [
      "config set-standard writes a named standard table",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "bundle",
            "--limit",
            "500000",
            "--direction",
            "down",
            "--run",
            "measure-bundle",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const toml = await readToml(dir);
        assertStringIncludes(toml, "[standards.bundle]");
        assertStringIncludes(toml, "limit = 500000");
        assertStringIncludes(toml, 'direction = "down"');
        assertStringIncludes(toml, 'run = "measure-bundle"');
        assert(
          toml.indexOf("# [standards]") <
              headerOffset(toml, "standards.bundle") &&
            headerOffset(toml, "standards.bundle") < headerOffset(toml, "gate"),
          "the first standard should land inside the standards region",
        );
        assertEquals(sectionKeys(toml, "standards.bundle"), [
          "metric",
          "direction",
          "limit",
          "run",
        ]);
      },
    ],
    [
      "config set-standard treats 'coverage' as an ordinary standard name",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "coverage",
            "--limit",
            "80",
            "--direction",
            "up",
            "--run",
            "measure-cov",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const toml = await readToml(dir);
        assertStringIncludes(toml, "[standards.coverage]");
        assertStringIncludes(toml, "limit = 80");
        assertStringIncludes(toml, 'run = "measure-cov"');
      },
    ],
    [
      "config set-standard requires a --run",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "bundle",
            "--direction",
            "down",
            "--limit",
            "100",
          ],
          dir,
        );
        assert(r.code !== 0); // Cliffy rejects the missing required option
      },
    ],
    [
      "config set-standard requires a --direction",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "bundle",
            "--limit",
            "100",
            "--run",
            "measure-bundle",
          ],
          dir,
        );
        assertEquals(r.code, 2);
        assertTerminalTextIncludes(r.stderr, "Missing required option");
        assertStringIncludes(r.stderr, "--direction");
      },
    ],
    [
      "config set-scope: Cliffy rejects zero globs before the handler",
      async (dir) => {
        // `<globs...>` is a required variadic, so Cliffy fails (exit 2) before the
        // handler's own globs.length===0 guard can run — see findings.
        const r = await runCli(["config", "set-scope", "native"], dir);
        assertEquals(r.code, 2);
        assertTerminalTextIncludes(r.stderr, "Missing argument");
      },
    ],
    [
      "config set-standard rejects an invalid --direction",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "bundle",
            "--limit",
            "80",
            "--run",
            "m",
            "--direction",
            "sideways",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(
          resultMessage(result),
          '--direction must be "up" or "down"',
        );
      },
    ],
    [
      "config set-standard rejects a non-numeric --limit",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "bundle",
            "--limit",
            "lots",
            "--direction",
            "down",
            "--run",
            "m",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 1);
        const result = decodeCliResult(r.stdout, "config");
        assertEquals(result.ok, false);
        assertStringIncludes(resultMessage(result), "--limit must be a number");
      },
    ],
    [
      "config set-standard with a JS-only numeric --limit still writes parseable TOML",
      async (dir) => {
        // `--limit .5` is JS-numeric but not TOML: emitted verbatim it corrupted the
        // whole discern.toml (every later command, doctor included, died on a syntax
        // error). The limit must land in a form the config parser reads back.
        const r = await runCli(
          [
            "config",
            "set-standard",
            "prose",
            "--direction",
            "down",
            "--limit",
            ".5",
            "--run",
            "measure-prose",
            "--json",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        assertEquals(decodeCliResult(r.stdout, "config").ok, true);
        assertStringIncludes(await readToml(dir), "limit = 0.5");
        // The install still loads cleanly — the file cannot have been bricked.
        const doctor = await runCli(["doctor", "--json"], dir);
        assertEquals(
          decodeCliResult(doctor.stdout, "doctor").ok,
          true,
          doctor.stdout,
        );
      },
    ],
    [
      "config set-standard defaults metric to the name with explicit direction",
      async (dir) => {
        const r = await runCli(
          [
            "config",
            "set-standard",
            "cov",
            "--limit",
            "80",
            "--direction",
            "up",
            "--run",
            "measure-cov",
          ],
          dir,
        );
        assertEquals(r.code, 0, r.stderr);
        const toml = await readToml(dir);
        // No --metric given: it falls back to the standard name.
        assertStringIncludes(toml, 'metric = "cov"');
        assertStringIncludes(toml, 'direction = "up"');
      },
    ],
  ]);
});

Deno.test("config errors cleanly when not initialized", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(
      ["config", "set", "project.slug", "x", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    assertEquals(decodeCliResult(r.stdout, "config").error, "not_initialized");
  });
});

Deno.test("config errors to stderr (not JSON) when not initialized", async () => {
  await withTempDir(async (dir) => {
    // No --json: the message lands on stderr and stdout stays empty.
    const r = await runCli(["config", "set", "project.slug", "x"], dir);
    assertEquals(r.code, 1);
    assertEquals(r.stdout, "");
    assertTerminalTextIncludes(r.stderr, "no discern install here");
  });
});

Deno.test("config set-<record> rejects a malformed name in every record section", async (t) => {
  // Every `config set-<record>` subcommand validates its <name> through the same
  // rule. Sections derive from the schema SSOT (recordConfigPaths); the args differ
  // per subcommand (scope takes globs, job takes --stage/--run, standard takes
  // --limit/--run), so a fixture arg-list is mapped per kind and asserted to cover
  // exactly the sections — a new record section forces an entry here (or an
  // exemption). Generated groups are carried by the template and config documents,
  // worktree.resources has no `set-resource` subcommand, and a checkpoint's
  // question is paragraph prose better authored in the file (or a config
  // document) than through CLI flags: all three are self-checking
  // exemptions from the CLI record-writer set.
  const SET_RECORD_ARGS: Record<string, string[]> = {
    job: ["--stage", "check", "--run", "x"],
    scope: ["src/**"],
    standard: ["--direction", "up", "--limit", "80", "--run", "m"],
  };
  const EXEMPT = new Set([
    "generated",
    "checkpoints",
    "worktree.resources",
  ]);
  const all = recordConfigPaths();
  for (const p of EXEMPT) {
    assert(all.includes(p), `EXEMPT lists "${p}", no longer a record section`);
  }
  const kinds = all.filter((p) => !EXEMPT.has(p)).map((p) =>
    p.replace(/s$/, "")
  );
  assertEquals(
    Object.keys(SET_RECORD_ARGS).sort(),
    [...kinds].sort(),
    "SET_RECORD_ARGS must cover exactly the record-section set-<kind> subcommands",
  );

  // Every kind refuses against its own pristine copy of one scaffolded install.
  await withPristineInstalls(
    t,
    setup,
    Object.entries(SET_RECORD_ARGS).map(([kind, extra]) =>
      [
        `config set-${kind} rejects a malformed name`,
        async (dir: string): Promise<void> => {
          const r = await runCli(
            ["config", `set-${kind}`, "bad name", ...extra, "--json"],
            dir,
          );
          assertEquals(r.code, 1, r.stderr);
          const result = decodeCliResult(r.stdout, "config");
          assertEquals(result.ok, false);
          assertEquals(result.error, "invalid_arguments");
          assertStringIncludes(resultMessage(result), `${kind} name must be`);
        },
      ] as const
    ),
  );
});
