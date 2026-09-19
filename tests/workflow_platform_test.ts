import { REPO_ROOT } from "./repo_authored_paths.ts";
import { coverageReporter } from "../scripts/coverage.ts";
/** Native macOS gates public changes and releases, whose Mac binaries are notarized. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { parseConfigOrThrow, toCommand } from "../src/shared/config_schema.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { jsonObjects, type LocatedObject } from "./json_objects.ts";
import { withTempDir } from "./temp_dir.ts";
import { readMetrics } from "../src/engine/validation/metrics.ts";

const DISCERN_TOML = new URL("../discern.toml", import.meta.url);
const GATE = new URL("../.github/workflows/gate.yml", import.meta.url);
const RELEASE = new URL("../.github/workflows/release.yml", import.meta.url);
const DVMRC = new URL("../.dvmrc", import.meta.url);
const WSL_GATE_ACTION = new URL(
  "../.github/actions/wsl-gate/action.yml",
  import.meta.url,
);
const MACOS_GATE_ACTION = new URL(
  "../.github/actions/macos-gate/action.yml",
  import.meta.url,
);
const ENTITLEMENTS = new URL(
  "../scripts/macos_release_entitlements.plist",
  import.meta.url,
);
const gateSource = await Deno.readTextFile(GATE);
const releaseSource = await Deno.readTextFile(RELEASE);
const dvmrcSource = await Deno.readTextFile(DVMRC);
const wslGateActionSource = await Deno.readTextFile(WSL_GATE_ACTION);
const macosGateActionSource = await Deno.readTextFile(MACOS_GATE_ACTION);
const entitlementsSource = await Deno.readTextFile(ENTITLEMENTS);

interface GithubYaml {
  path: string;
  mappings: LocatedObject[];
}

/** Parse every workflow or local action under `.github`; new YAML auto-enrols. */
async function githubYaml(files: readonly string[]): Promise<GithubYaml[]> {
  const documents: GithubYaml[] = [];
  for (const rel of files) {
    const source = await Deno.readTextFile(
      new URL(`../${rel}`, import.meta.url),
    );
    documents.push({
      path: rel,
      mappings: jsonObjects(parseYaml(source)),
    });
  }
  return documents;
}

/** Recognize workflow steps that invoke the full gate through supported command forms. */
function isFullGateCommand(value: unknown): boolean {
  return typeof value === "string" &&
    /(?:^|\s)(?:discern done|deno task (?:dev done|gate))(?:\s|$)/.test(
      value,
    );
}

/** Locate full-gate workflow steps that omit the JUnit test reporter that isolates diagnostic content. */
function missingJunitReporter(document: GithubYaml): string[] {
  return document.mappings
    .filter(({ value }) => isFullGateCommand(value.run))
    .filter(({ value }) => {
      const env = value.env;
      return env === null || typeof env !== "object" || Array.isArray(env) ||
        (env as Record<string, unknown>).DISCERN_GATE_TEST_REPORTER !==
          "junit";
    })
    .map(({ path }) =>
      `${document.path}:${path}.env.DISCERN_GATE_TEST_REPORTER`
    );
}

/** Recognize the locked install that serially converges Deno dependencies. */
function isFrozenDenoInstall(value: unknown): boolean {
  return typeof value === "string" &&
    /(?:^|\s)deno install --frozen(?:\s|$)/.test(value);
}

/** Locate full-gate steps reached before their job converges Deno dependencies. */
function missingFrozenInstall(document: GithubYaml): string[] {
  const offenders: string[] = [];
  for (const { path, value } of document.mappings) {
    if (!Array.isArray(value.steps)) {
      continue;
    }
    let dependenciesReady = false;
    for (const [index, step] of value.steps.entries()) {
      if (step === null || typeof step !== "object" || Array.isArray(step)) {
        continue;
      }
      const run = (step as Record<string, unknown>).run;
      if (isFullGateCommand(run) && !dependenciesReady) {
        offenders.push(`${document.path}:${path}.steps[${index}].run`);
      }
      if (isFrozenDenoInstall(run)) {
        dependenciesReady = true;
      }
    }
  }
  return offenders;
}

/** Locate authoritative checkouts that omit the release tags used by schema guards. */
function missingReleaseTags(document: GithubYaml): string[] {
  return document.mappings
    .filter(({ value }) =>
      typeof value.uses === "string" &&
      value.uses.startsWith("actions/checkout@")
    )
    .filter(({ value }) => {
      const withValues = value.with;
      return withValues === null || typeof withValues !== "object" ||
        Array.isArray(withValues) ||
        (withValues as Record<string, unknown>)["fetch-tags"] !== true;
    })
    .map(({ path }) => `${document.path}:${path}.with.fetch-tags`);
}

/** Slice one named workflow job up to the next sibling for focused policy assertions. */
function job(source: string, name: string, next: string): string {
  const start = source.indexOf(`  ${name}:`);
  const end = source.indexOf(`  ${next}:`, start + 1);
  assert(start >= 0, `${name} job exists`);
  assert(end > start, `${next} job follows ${name}`);
  return source.slice(start, end);
}

Deno.test("new commits cancel superseded gate runs on the same ref", () => {
  assertStringIncludes(
    gateSource,
    "group: ${{ github.workflow }}-${{ github.ref }}",
  );
  assertStringIncludes(gateSource, "cancel-in-progress: true");
});

Deno.test("every hosted Deno setup consumes the one exact .dvmrc version", async () => {
  assert(
    /^\d+\.\d+\.\d+\n$/u.test(dvmrcSource),
    ".dvmrc contains one exact stable Deno version and a final newline",
  );
  const files = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#hosted-deno-version",
    universe: "authored-text",
    narrow: {
      reason: "This toolchain rule governs GitHub workflow and action YAML.",
      include: (rel) => rel.startsWith(".github/") && /\.ya?ml$/.test(rel),
    },
  });
  assertEquals(coverageReporter({ get: () => undefined }), "junit");
  assertEquals(coverageReporter({ get: () => "pretty" }), "pretty");
  const documents = await githubYaml(files);
  const setupSteps = documents.flatMap((document) =>
    document.mappings.filter(({ value }) =>
      typeof value.uses === "string" &&
      value.uses.startsWith("denoland/setup-deno@")
    ).map(({ path, value }) => ({ document: document.path, path, value }))
  );
  assert(setupSteps.length > 0, "hosted automation installs Deno");
  const offenders: string[] = [];
  for (const step of setupSteps) {
    const withValues = step.value.with;
    if (
      withValues === null || typeof withValues !== "object" ||
      Array.isArray(withValues) ||
      (withValues as Record<string, unknown>)["deno-version-file"] !==
        ".dvmrc" ||
      Object.hasOwn(withValues as Record<string, unknown>, "deno-version")
    ) {
      offenders.push(`${step.document}:${step.path}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `setup-deno steps must use deno-version-file: .dvmrc:\n${
      offenders.join("\n")
    }`,
  );
  assertStringIncludes(wslGateActionSource, "cat /home/gate/discern/.dvmrc");
  assertStringIncludes(wslGateActionSource, '"v${deno_version#v}"');
});

Deno.test("hosted runner labels are pinned rather than floating on latest", async () => {
  const files = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#hosted-runner-labels",
    universe: "authored-text",
    narrow: {
      reason: "This runner-image rule governs GitHub workflow YAML.",
      include: (rel) =>
        rel.startsWith(".github/workflows/") &&
        /\.ya?ml$/.test(rel),
    },
  });
  const offenders: string[] = [];
  for (const document of await githubYaml(files)) {
    for (const { path, value } of document.mappings) {
      const runner = value["runs-on"];
      if (typeof runner === "string" && /-latest$/u.test(runner)) {
        offenders.push(`${document.path}:${path}.runs-on=${runner}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `hosted runner labels must name an audited image:\n${offenders.join("\n")}`,
  );
});

Deno.test("hosted automation never exports a trunk override into project tests", async () => {
  const offenders: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#hosted-trunk-overrides",
    universe: "authored-text",
    narrow: {
      reason:
        "This environment boundary governs GitHub workflow and action YAML.",
      include: (rel) => rel.startsWith(".github/") && /\.ya?ml$/.test(rel),
    },
  });
  for (const document of await githubYaml(files)) {
    for (const { path, value } of document.mappings) {
      if (Object.hasOwn(value, "DISCERN_TRUNK")) {
        offenders.push(`${document.path}:${path}.DISCERN_TRUNK`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `hosted trunk overrides leak into descendant project commands:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("every authoritative checkout fetches release tags for compatibility baselines", async () => {
  const files = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#release-tag-checkouts",
    universe: "authored-text",
    narrow: {
      reason:
        "This release-baseline rule governs GitHub workflow and action YAML.",
      include: (rel) => rel.startsWith(".github/") && /\.ya?ml$/.test(rel),
    },
  });
  const offenders = (await githubYaml(files)).flatMap(missingReleaseTags);
  assertEquals(
    offenders,
    [],
    `every actions/checkout step must set fetch-tags: true:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("the release-tag guard catches a future shallow checkout", () => {
  const fixture: GithubYaml = {
    path: "future-workflow.yml",
    mappings: jsonObjects(parseYaml(`
jobs:
  contract_gate:
    steps:
      - uses: actions/checkout@deadbeef
`)),
  };
  assertEquals(missingReleaseTags(fixture), [
    "future-workflow.yml:$.jobs.contract_gate.steps[0].with.fetch-tags",
  ]);
});

Deno.test("the trunk-override guard catches a future nested workflow lane", () => {
  const fixture = parseYaml(`
jobs:
  unrelated_lane:
    steps:
      - name: Inspect another checkout
        env:
          DISCERN_TRUNK: elsewhere
        run: discern status
`);
  const paths = jsonObjects(fixture)
    .filter(({ value }) => Object.hasOwn(value, "DISCERN_TRUNK"))
    .map(({ path }) => `${path}.DISCERN_TRUNK`);
  assertEquals(paths, [
    "$.jobs.unrelated_lane.steps[0].env.DISCERN_TRUNK",
  ]);
});

Deno.test("local and hosted full gates select isolated JUnit output", async () => {
  const config = parseConfigOrThrow(await Deno.readTextFile(DISCERN_TOML));
  assertEquals(
    toCommand(config.jobs.test),
    "deno task coverage",
  );

  const documents = await githubYaml(
    await structuralGuardScope({
      guard: "tests/workflow_platform_test.ts#hosted-gate-reporters",
      universe: "authored-text",
      narrow: {
        reason: "This reporter rule governs GitHub workflow and action YAML.",
        include: (rel) => rel.startsWith(".github/") && /\.ya?ml$/.test(rel),
      },
    }),
  );
  const gateCommands = documents.flatMap(({ mappings }) =>
    mappings.filter(({ value }) => isFullGateCommand(value.run))
  );
  assert(
    gateCommands.length > 0,
    "hosted automation runs at least one full gate",
  );
  assertEquals(
    documents.flatMap(missingJunitReporter),
    [],
    "every hosted full-gate command must select the JUnit test reporter",
  );
});

Deno.test("the reporter guard catches a future full-gate container", () => {
  const fixture: GithubYaml = {
    path: "future-workflow.yml",
    mappings: jsonObjects(parseYaml(`
jobs:
  container_gate:
    container: denoland/deno:latest
    steps:
      - name: Run the gate
        run: discern done
`)),
  };
  assertEquals(missingJunitReporter(fixture), [
    "future-workflow.yml:$.jobs.container_gate.steps[0].env.DISCERN_GATE_TEST_REPORTER",
  ]);
  for (const { value } of fixture.mappings) {
    if (isFullGateCommand(value.run)) {
      value.env = { DISCERN_GATE_TEST_REPORTER: "pretty" };
    }
  }
  assertEquals(missingJunitReporter(fixture).length, 1);
});

Deno.test("the hosted reporter keeps test names and fixture output outside metric evidence", async () => {
  await withTempDir(async (dir) => {
    const fixture = join(dir, "diagnostic_test.ts");
    await Deno.writeTextFile(
      fixture,
      'Deno.test("example DISCERN_METRIC sample 40)", () => {\n' +
        '  console.log("DISCERN_METRIC coverage 1");\n' +
        '  console.error("DISCERN_METRIC sample NaN");\n' +
        "});\n",
    );
    const reporter = coverageReporter({ get: () => undefined });
    for (const selected of [reporter, "pretty"]) {
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "test",
          "--no-config",
          "--no-lock",
          "--no-check",
          `--reporter=${selected}`,
          fixture,
        ],
        cwd: dir,
        env: { NO_COLOR: "1" },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const output = [result.stdout, result.stderr].map((bytes) =>
        new TextDecoder().decode(bytes)
      ).join("\n");
      assert(result.success, output);
      const evidence = `${output}\nDISCERN_METRIC coverage 92.2\n` +
        "DISCERN_METRIC module_coverage_failures 0\n";
      if (selected === reporter) {
        assertEquals(readMetrics(evidence), {
          coverage: 92.2,
          module_coverage_failures: 0,
        });
      } else {
        assertThrows(() => readMetrics(evidence));
      }
    }
  });
});

Deno.test("hosted full gates converge locked Deno dependencies before parallel jobs", async () => {
  const documents = await githubYaml(
    await structuralGuardScope({
      guard: "tests/workflow_platform_test.ts#hosted-gate-dependencies",
      universe: "authored-text",
      narrow: {
        reason:
          "This dependency-convergence rule governs GitHub workflow and action YAML.",
        include: (rel) => rel.startsWith(".github/") && /\.ya?ml$/.test(rel),
      },
    }),
  );
  assertEquals(
    documents.flatMap(missingFrozenInstall),
    [],
    "every hosted full Gate must run deno install --frozen before its parallel jobs",
  );
});

Deno.test("the dependency guard catches a future cold full-gate container", () => {
  const fixture: GithubYaml = {
    path: "future-action.yml",
    mappings: jsonObjects(parseYaml(`
runs:
  using: composite
  steps:
    - name: Run a project helper
      run: deno task prepare-assets
    - name: Run the gate
      run: deno task dev done --ci
`)),
  };
  assertEquals(missingFrozenInstall(fixture), [
    "future-action.yml:$.runs.steps[1].run",
  ]);
});

/** The hosted gate lanes every run must execute, each on its exact runner. */
const REQUIRED_GATE_LANES = [
  { job: "macos", runner: "macos-15", action: "./.github/actions/macos-gate" },
  { job: "wsl", runner: "windows-2025", action: "./.github/actions/wsl-gate" },
] as const;

/** One job's block from gate.yml, bounded by the next job header. */
function gateJob(name: string): string {
  const jobs = gateSource.slice(gateSource.indexOf("\njobs:\n"));
  const headers = [...jobs.matchAll(/^ {2}([a-z]+):\n/gmu)];
  const index = headers.findIndex((header) => header[1] === name);
  assert(index >= 0, `gate.yml declares the ${name} job`);
  const start = headers[index]?.index ?? 0;
  const end = headers[index + 1]?.index ?? jobs.length;
  return jobs.slice(start, end);
}

Deno.test("the native macOS and WSL 2 gate lanes run unconditionally on exact runners", () => {
  for (const lane of REQUIRED_GATE_LANES) {
    const block = gateJob(lane.job);
    assert(
      !/^\s+if:/mu.test(block),
      `${lane.job}: the lane carries no condition`,
    );
    assertStringIncludes(block, `runs-on: ${lane.runner}`);
    assertStringIncludes(block, `uses: ${lane.action}`);
  }
});

Deno.test("no workflow or composite action conditions anything on repository visibility", async () => {
  const files = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#visibility-expressions",
    universe: {
      kind: "specialized",
      name: "github-workflow-yaml",
      reason: "GitHub workflow and composite-action syntax lives only in YAML",
      extensions: [".yml", ".yaml"],
    },
    narrow: {
      reason: "every hosted lane is declared beneath .github",
      include: (rel) => rel.startsWith(".github/"),
    },
  });
  assert(files.length > 0, "the guard scans the hosted workflows");
  const refusalInput =
    /^\s+REPOSITORY_PRIVATE: \$\{\{ github\.event\.repository\.private \}\}$/u;
  for (const rel of files) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const line of text.split("\n")) {
      if (!line.includes("repository.private")) continue;
      assert(
        refusalInput.test(line),
        `${rel}: repository visibility may only feed the release plan's refusal, never a condition: ${line.trim()}`,
      );
    }
  }
});

Deno.test("the shared native macOS action runs the full clean-tree gate", () => {
  assertStringIncludes(macosGateActionSource, "run: deno task vale:sync");
  assertStringIncludes(macosGateActionSource, "run: deno task dev done");
  assertStringIncludes(macosGateActionSource, "run: git diff --exit-code");
});

Deno.test("one native release row runs the full gate before compilation", () => {
  assertEquals(
    BUILD_TARGETS.filter((target) => target.gateBeforeBuild).map((target) => ({
      runner: target.runner,
      target: target.triple,
    })),
    [{
      runner: "macos-15",
      target: "aarch64-apple-darwin",
    }],
  );

  const build = job(releaseSource, "build", "release");
  const fetch = build.indexOf("- name: Fetch the actual gate policy base");
  const gate = build.indexOf("- name: Run the full gate on native macOS");
  const compile = build.indexOf("- name: Compile");
  assert(fetch >= 0, "the release gate fetches its event policy baseline");
  assert(gate > fetch, "the release gate follows its policy fetch");
  assert(compile > gate, "compilation waits for the release gate");

  const releaseGate = build.slice(fetch, compile);
  assertEquals(
    [
      ...releaseGate.matchAll(
        /if: \$\{\{ matrix\.gateBeforeBuild \}\}/g,
      ),
    ].length,
    2,
  );
  assertStringIncludes(
    releaseGate,
    "uses: ./.github/actions/macos-gate",
  );
  assertStringIncludes(
    releaseGate,
    "uses: ./.github/actions/policy-base",
  );
});

Deno.test("macOS release binaries are signed before smoke and notarized before checksum", () => {
  const build = job(releaseSource, "build", "release");
  const compile = build.indexOf("- name: Compile");
  const install = build.indexOf("- name: Install Apple release credentials");
  const sign = build.indexOf("- name: Sign ${{ matrix.output }}");
  const smoke = build.indexOf("- name: Smoke compiled binary");
  const notarize = build.indexOf("- name: Notarize ${{ matrix.output }}");
  const checksum = build.indexOf("- name: Checksum");
  const upload = build.indexOf("- name: Upload build artifacts");
  const cleanup = build.indexOf("- name: Remove Apple release credentials");

  assert(compile >= 0, "the target is compiled");
  assert(install > compile, "credentials are installed after compilation");
  assert(
    sign > install,
    "Developer ID signing follows credential installation",
  );
  assert(smoke > sign, "the signed binary is smoked");
  assert(notarize > smoke, "the working signed binary is notarized");
  assert(
    checksum > notarize,
    "the published bytes are checksummed after notarization",
  );
  assert(upload > checksum, "the checked artifact is uploaded");
  assert(cleanup > upload, "credentials are removed after artifact handling");

  assertStringIncludes(build, "if: ${{ runner.os == 'macOS' }}");
  assertStringIncludes(build, "codesign --force --timestamp --options runtime");
  assertStringIncludes(build, "--identifier sh.discern.cli");
  assertStringIncludes(
    build,
    "--entitlements scripts/macos_release_entitlements.plist",
  );
  assertStringIncludes(build, "xcrun notarytool submit");
  assertStringIncludes(build, "--keychain-profile discern-release");
  assertStringIncludes(build, "--wait");
  assertStringIncludes(build, '-R="notarized" --check-notarization');
  for (
    const secret of [
      "APPLE_DEVELOPER_ID_P12_BASE64",
      "APPLE_DEVELOPER_ID_P12_PASSWORD",
      "APPLE_NOTARY_APPLE_ID",
      "APPLE_NOTARY_PASSWORD",
      "APPLE_TEAM_ID",
    ]
  ) {
    assertStringIncludes(build, `secrets.${secret}`);
  }
  assertStringIncludes(
    build,
    "if: ${{ always() && runner.os == 'macOS' }}",
  );
});

Deno.test("the hardened runtime grants only Deno's required JIT entitlement", () => {
  assertStringIncludes(
    entitlementsSource,
    "<key>com.apple.security.cs.allow-jit</key>",
  );
  const enabled = [...entitlementsSource.matchAll(/<true\/>/g)];
  assert(
    enabled.length === 1,
    `expected one enabled entitlement, found ${enabled.length}`,
  );
});

/**
 * The step keys GitHub's runner accepts inside a composite action. Workflow
 * job steps take more (`timeout-minutes`, `continue-on-error` aside), and the
 * runner rejects a composite action at load time for any other key, so the
 * lane that uses it fails before its first command.
 */
const COMPOSITE_STEP_KEYS = new Set([
  "id",
  "if",
  "name",
  "run",
  "shell",
  "working-directory",
  "env",
  "uses",
  "with",
  "continue-on-error",
]);

Deno.test("every composite action step uses only keys the runner accepts", async () => {
  const actions = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#composite-step-keys",
    universe: "authored-text",
    narrow: {
      reason: "composite actions live only beneath .github/actions",
      include: (rel) =>
        rel.startsWith(".github/actions/") && /\/action\.ya?ml$/.test(rel),
    },
  });
  assert(actions.length > 0, "the guard scans the composite actions");
  for (const rel of actions) {
    const manifest = parseYaml(
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ) as { runs?: { using?: unknown; steps?: unknown } };
    assertEquals(manifest.runs?.using, "composite", rel);
    const steps = manifest.runs?.steps;
    assert(Array.isArray(steps) && steps.length > 0, `${rel}: declares steps`);
    steps.forEach((step, index) => {
      const keys = Object.keys(step as Record<string, unknown>);
      const rejected = keys.filter((key) => !COMPOSITE_STEP_KEYS.has(key));
      assertEquals(
        rejected,
        [],
        `${rel}: step ${
          index + 1
        } carries keys the runner rejects in a composite action`,
      );
    });
  }
});

Deno.test("every hosted full gate declares its report scope and fetched policy base", async () => {
  const documents = await githubYaml(
    await structuralGuardScope({
      guard: "tests/workflow_platform_test.ts#complete-hosted-gates",
      universe: "authored-text",
      narrow: {
        reason:
          "This gate invocation rule governs GitHub workflow and action YAML.",
        include: (rel) => rel.startsWith(".github/") && /\.ya?ml$/.test(rel),
      },
    }),
  );
  for (const document of documents) {
    for (
      const { path, value } of document.mappings.filter(({ value }) =>
        isFullGateCommand(value.run)
      )
    ) {
      const run = String(value.run);
      for (
        const flag of [
          "--ci",
          "--standalone",
          "--policy-base refs/discern/ci-policy-base",
        ]
      ) assertStringIncludes(run, flag, `${document.path}:${path}`);
    }
    if (!document.path.startsWith(".github/workflows/")) continue;
    for (const { path, value } of document.mappings) {
      if (!Array.isArray(value.steps)) continue;
      let fetched = false;
      for (const step of value.steps as Record<string, unknown>[]) {
        if (step.uses === "./.github/actions/policy-base") {
          const input = step.with as Record<string, unknown>;
          assertStringIncludes(
            String(input.base),
            "github.event.pull_request.base.sha || github.event.before",
          );
          fetched = true;
        }
        if (
          isFullGateCommand(step.run) ||
          ["./.github/actions/macos-gate", "./.github/actions/wsl-gate"]
            .includes(String(step.uses))
        ) {
          assert(
            fetched,
            `${document.path}:${path} fetches policy before validation`,
          );
        }
      }
    }
  }
});

Deno.test("instrumented producer and nested hosted gates fit their containing budgets", () => {
  const config = parseConfigOrThrow(Deno.readTextFileSync(DISCERN_TOML));
  assert(
    typeof config.jobs.test === "object" && !Array.isArray(config.jobs.test),
  );
  const producer = config.jobs.test.timeout;
  assert(producer !== undefined && producer >= 10800);
  const actions = new Map([
    ["./.github/actions/macos-gate", parseYaml(macosGateActionSource)],
    ["./.github/actions/wsl-gate", parseYaml(wslGateActionSource)],
  ]);
  for (const source of [gateSource, releaseSource]) {
    for (const { value } of jsonObjects(parseYaml(source))) {
      if (!Array.isArray(value.steps)) {
        continue;
      }
      for (const step of value.steps as Record<string, unknown>[]) {
        if (isFullGateCommand(step.run)) {
          assert(Number(value["timeout-minutes"]) * 60 > producer);
        }
        const action = actions.get(String(step.uses));
        if (action === undefined) continue;
        const nested = jsonObjects(action).filter(({ value }) =>
          isFullGateCommand(value.run)
        );
        assert(nested.length > 0);
        // A composite step cannot bound itself (the runner rejects
        // `timeout-minutes` there), so the calling job's budget is the one
        // that contains the nested gate.
        assert(
          Number(value["timeout-minutes"]) * 60 > producer,
          `${
            String(step.uses)
          }: the calling job's budget contains the nested gate`,
        );
      }
    }
  }
});

/** The WSL 2 action's steps, in order. */
function wslGateSteps(): Record<string, unknown>[] {
  const action = parseYaml(wslGateActionSource) as {
    runs: { steps: Record<string, unknown>[] };
  };
  return action.runs.steps;
}

/** The directory the WSL 2 lane's steps write and its artifact upload reads. */
const WSL_VM_SAMPLES = "wsl-vm-samples";

Deno.test("the WSL 2 lane samples its VM beside the gate and keeps the samples on every outcome", () => {
  const steps = wslGateSteps();
  const gate = steps.find((step) => isFullGateCommand(step.run));
  assert(gate !== undefined, "the action runs the full gate");
  const run = String(gate.run);
  // The sampler brackets the gate, and the gate's own status survives the
  // sampler's stop and summary: a failed gate must still fail the step.
  const order = [
    "vm-samples.sh",
    `start "$samples" 20 "$PWD/${WSL_VM_SAMPLES}"`,
    "set +e",
    "deno task dev done",
    "gate_status=$?",
    'stop "$samples"',
    `${WSL_VM_SAMPLES}/`,
    'exit "$gate_status"',
  ];
  let cursor = -1;
  for (const marker of order) {
    const index = run.indexOf(marker, cursor + 1);
    assert(index > cursor, `the gate step reaches ${marker} in order`);
    cursor = index;
  }
  const upload = steps.find((step) =>
    String(step.uses).startsWith("actions/upload-artifact@")
  );
  assert(upload !== undefined, "the action keeps the samples as an artifact");
  assertStringIncludes(String(upload.if), "always()");
  const input = upload.with as Record<string, unknown>;
  assertEquals(input.name, WSL_VM_SAMPLES);
  assertEquals(input.path, WSL_VM_SAMPLES);
  assert(
    steps.some((step) =>
      step.shell === "pwsh" &&
      String(step.run).includes(`${WSL_VM_SAMPLES}/host.txt`)
    ),
    "a host-side step records the WSL configuration beside the samples",
  );
});

Deno.test("release publication downloads only the binary artifacts", () => {
  const download = jsonObjects(parseYaml(releaseSource)).find(({ value }) =>
    String(value.uses).startsWith("actions/download-artifact@")
  );
  assert(download !== undefined, "the release job downloads the binaries");
  const input = download.value.with as Record<string, unknown>;
  assertEquals(input.pattern, "discern-*");
  for (const target of BUILD_TARGETS) {
    assert(
      target.output.startsWith("discern-"),
      `${target.output} matches the release download pattern`,
    );
  }
});

Deno.test("CI shellchecks every tracked shell script", async () => {
  const scripts = await structuralGuardScope({
    guard: "tests/workflow_platform_test.ts#shellcheck-coverage",
    universe: {
      kind: "specialized",
      name: "shell-scripts",
      reason:
        "shell scripts are neither TypeScript nor Markdown, so no canonical authored universe holds them",
      extensions: [".sh"],
    },
  });
  assert(scripts.length > 0, "the guard scans the shell scripts");
  const lint = jsonObjects(parseYaml(gateSource)).find(({ value }) =>
    typeof value.run === "string" && value.run.startsWith("shellcheck ")
  );
  assert(lint !== undefined, "the Ubuntu lane runs shellcheck");
  const linted = String(lint.value.run).split(/\s+/).slice(1);
  for (const script of scripts) {
    assert(linted.includes(script), `${script} is shellchecked in CI`);
  }
});

/** The hosted windows-2025 runner's memory, and what Windows holds before WSL starts. */
const WSL_RUNNER_MEMORY_GB = 16;
const WSL_HOST_RESERVE_GB = 5;

Deno.test("the WSL 2 lane sizes its VM above WSL's default before provisioning boots it", () => {
  const steps = wslGateSteps();
  const sizing = steps.findIndex((step) =>
    String(step.run).includes(".wslconfig") &&
    /memory=\d+GB/u.test(String(step.run))
  );
  const provisioning = steps.findIndex((step) =>
    String(step.uses).startsWith("Vampire/setup-wsl@")
  );
  assert(sizing >= 0, "the action writes a .wslconfig");
  assert(
    provisioning > sizing,
    "the VM is sized before the provisioning step boots it",
  );
  const run = String(steps[sizing]?.run);
  const memory = Number(/memory=(\d+)GB/u.exec(run)?.[1]);
  const swap = Number(/swap=(\d+)GB/u.exec(run)?.[1]);
  assert(
    memory > WSL_RUNNER_MEMORY_GB / 2,
    "the VM gets more than WSL's default half of the runner",
  );
  assert(
    memory <= WSL_RUNNER_MEMORY_GB - WSL_HOST_RESERVE_GB,
    "the VM leaves Windows what it holds before WSL starts",
  );
  assert(swap >= memory / 4, "swap is at least WSL's default quarter");
});

Deno.test("the WSL 2 lane provisions the locale and the pinned Chromium the suite expects", () => {
  const steps = wslGateSteps();
  const provisioning = steps.findIndex((step) =>
    String(step.run).includes("locale-gen en_US.UTF-8")
  );
  const gate = steps.findIndex((step) => isFullGateCommand(step.run));
  assert(provisioning >= 0, "the action generates the captures' locale");
  assert(provisioning < gate, "provisioning precedes the gate");
  const run = String(steps[provisioning]?.run);
  assertStringIncludes(run, "install-deps chromium");
  assertStringIncludes(run, "install chromium");
  // The browser package pin has one home, deno.json; the action reads it.
  assertStringIncludes(run, "imports['playwright-core']");
  assert(
    !/playwright-core@\d/u.test(run),
    "the action never hard-codes the browser package version",
  );
  const packages = String(
    (steps.find((step) => String(step.uses).startsWith("Vampire/setup-wsl@"))
      ?.with as Record<string, unknown>)["additional-packages"],
  );
  assertStringIncludes(packages, "locales");
});
