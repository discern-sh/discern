/** The release may publish only native-executed, smoke-tested build targets. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { BUILD_TARGETS, type BuildTarget } from "../scripts/build_targets.ts";
import { releasePlan } from "../scripts/release_plan.ts";
import { smokeReleaseBinary } from "../scripts/release_smoke.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";

const RELEASE = new URL("../.github/workflows/release.yml", import.meta.url);
const releaseSource = await Deno.readTextFile(RELEASE);

Deno.test("release validation completes before any build or publication", () => {
  const plan = releaseSource.indexOf("  plan:");
  const build = releaseSource.indexOf("  build:");
  const publish = releaseSource.indexOf("  release:");
  assert(plan >= 0, "release.yml has a pre-publication plan job");
  assert(plan < build, "the plan job precedes the build job");
  assert(plan < publish, "the plan job precedes the publication job");
  assertStringIncludes(releaseSource, "needs: plan");
  assertStringIncludes(releaseSource, "RELEASE_TAG: ${{ github.ref_name }}");
});

Deno.test("every build target auto-enrols in the native release matrix", () => {
  const plan = releasePlan("v1.2.3", "1.2.3");
  assertEquals(plan.matrix.include.length, BUILD_TARGETS.length);
  for (const target of BUILD_TARGETS) {
    assert(
      plan.matrix.include.some((row) =>
        row.target === target.triple && row.output === target.output &&
        row.os === target.runner
      ),
      `${target.triple} is absent from the release matrix`,
    );
  }

  const future: BuildTarget = {
    triple: "riscv64-example-os",
    output: "discern-riscv64-example-os",
    runner: "example-native-runner",
  };
  assertEquals(
    releasePlan("v1.2.3", "1.2.3", [future]).matrix.include,
    [{
      target: future.triple,
      output: future.output,
      os: future.runner,
    }],
  );
});

Deno.test("a tag/package mismatch is refused before the matrix exists", () => {
  assertThrows(
    () => releasePlan("v1.2.4", "1.2.3"),
    Error,
    "release tag v1.2.4 does not match package version v1.2.3",
  );
});

Deno.test("the compiled release smoke gates artifact upload", () => {
  const compile = releaseSource.indexOf("deno task build ${{ matrix.target }}");
  const smoke = releaseSource.indexOf("scripts/release_smoke.ts");
  const notarize = releaseSource.indexOf("- name: Notarize");
  const checksum = releaseSource.indexOf("- name: Checksum");
  const upload = releaseSource.indexOf("- name: Upload build artifacts");
  assert(compile >= 0, "the release compiles its matrix target");
  assert(smoke > compile, "the compiled binary is smoked after compilation");
  assert(
    notarize > smoke,
    "macOS notarization follows the compiled binary smoke",
  );
  assert(checksum > smoke, "checksums are made only after the smoke passes");
  assert(upload > checksum, "artifact upload follows the checksum");
  assertStringIncludes(releaseSource, '"dist/${{ matrix.output }}"');
  assertStringIncludes(
    releaseSource,
    '"${{ needs.plan.outputs.version }}"',
  );
});

interface FakeOptions {
  helpRoot?: boolean;
  scaffoldMap?: boolean;
  version?: string;
}

async function writeFakeDiscern(
  dir: string,
  options: FakeOptions = {},
): Promise<string> {
  const binary = join(dir, "fake-discern");
  const version = options.version ?? "1.2.3";
  const docs = options.helpRoot === false ? [] : [{ path: "docs/README.md" }];
  const scaffoldMap = options.scaffoldMap === false
    ? ""
    : `mkdir -p ${SOURCE_PATHS.map.defaultPath}; printf '# Map\\n' > ${SOURCE_PATHS.map.defaultPath}README.md`;
  await Deno.writeTextFile(
    binary,
    `#!/bin/sh
set -eu
case "$1" in
  --version)
    printf '%s\\n' 'discern ${version}'
    ;;
  help)
    printf '%s\\n' '${
      JSON.stringify({ ok: true, verb: "help", data: { docs } })
    }'
    ;;
  setup)
    mkdir -p discern
    printf '%s\\n' '[project]' > discern.toml
    printf '%s\\n' '# Guidance' > ${SOURCE_PATHS.guidance.defaultPath}
    ${scaffoldMap}
    printf '%s\\n' '${JSON.stringify({ ok: true, verb: "setup" })}'
    ;;
  *)
    exit 64
    ;;
esac
`,
  );
  await Deno.chmod(binary, 0o755);
  return binary;
}

Deno.test("release smoke proves version, bundled help, and bundled setup assets", async () => {
  const dir = await Deno.makeTempDir({ prefix: "release-smoke-test-" });
  try {
    await smokeReleaseBinary(await writeFakeDiscern(dir), "1.2.3");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("release smoke rejects an unrelated future binary with the wrong version", async () => {
  const dir = await Deno.makeTempDir({ prefix: "release-smoke-test-" });
  try {
    const binary = await writeFakeDiscern(dir, { version: "9.9.9" });
    await assertRejects(
      () => smokeReleaseBinary(binary, "1.2.3"),
      Error,
      "does not match discern 1.2.3",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("release smoke rejects a binary missing embedded docs or templates", async () => {
  const dir = await Deno.makeTempDir({ prefix: "release-smoke-test-" });
  try {
    const noDocs = await writeFakeDiscern(dir, { helpRoot: false });
    await assertRejects(
      () => smokeReleaseBinary(noDocs, "1.2.3"),
      Error,
      "missing docs/README.md",
    );

    const noMap = await writeFakeDiscern(dir, { scaffoldMap: false });
    await assertRejects(
      () => smokeReleaseBinary(noMap, "1.2.3"),
      Error,
      `did not scaffold ${SOURCE_PATHS.map.defaultPath}README.md`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
