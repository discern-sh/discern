/** The release may publish only native-executed, smoke-tested build targets. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { BUILD_TARGETS, type BuildTarget } from "../scripts/build_targets.ts";
import { releasePlan } from "../scripts/release_plan.ts";
import { smokeReleaseBinary } from "../scripts/release_smoke.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  DISCERN_PROJECT_PAYLOAD_LICENSE,
  FIRST_PARTY_LEGAL_DOCUMENTS,
} from "../src/shared/license_registry.ts";
import { withTempDir } from "./helpers.ts";

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
        row.os === target.runner &&
        row.gateBeforeBuild === (target.gateBeforeBuild === true)
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
      gateBeforeBuild: false,
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
  docsRoot?: boolean;
  materializedLegalPath?: string;
  missingLicenseKey?: string;
  scaffoldMap?: boolean;
  truncatedLicenseKey?: string;
  version?: string;
}

/** Single-quote fixture paths safely for generated POSIX shell commands. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Model a release artifact cut off immediately after a required integrity marker. */
function truncateAfterMarker(text: string, marker: string): string {
  const markerIndex = text.indexOf(marker);
  assert(markerIndex >= 0, `fixture text is missing ${marker}`);
  return text.slice(0, markerIndex + marker.length);
}

/** Create an executable release binary fixture with controlled version, docs, and legal metadata. */
async function writeFakeDiscern(
  dir: string,
  options: FakeOptions = {},
): Promise<string> {
  const binary = join(dir, "fake-discern");
  const version = options.version ?? "1.2.3";
  const docs = options.docsRoot === false ? [] : [{ path: "docs/README.md" }];
  const documents = await Promise.all(
    FIRST_PARTY_LEGAL_DOCUMENTS
      .filter((document) => document.key !== options.missingLicenseKey)
      .map(async (document) => {
        const text = await Deno.readTextFile(
          new URL(`../${document.path}`, import.meta.url),
        );
        return {
          key: document.key,
          kind: document.kind,
          identifier: document.identifier,
          title: document.title,
          path: document.path,
          text: document.key === options.truncatedLicenseKey
            ? truncateAfterMarker(text, document.smokeMarker)
            : text,
        };
      }),
  );
  const licensesJson = JSON.stringify({
    ok: true,
    verb: "licenses",
    data: { documents, components: [] },
  });
  const thirdPartyNotices = await Deno.readTextFile(
    new URL("../THIRD_PARTY_NOTICES", import.meta.url),
  );
  const scaffoldMap = options.scaffoldMap === false
    ? ""
    : `mkdir -p ${SOURCE_PATHS.map.defaultPath}; printf '# Map\\n' > ${SOURCE_PATHS.map.defaultPath}README.md`;
  const materializeLegal = options.materializedLegalPath === undefined
    ? ""
    : `mkdir -p ${
      shellQuote(dirname(options.materializedLegalPath))
    }; printf 'fixture\\n' > ${shellQuote(options.materializedLegalPath)}`;
  await Deno.writeTextFile(
    binary,
    `#!/bin/sh
set -eu
case "$1" in
  --version)
    printf '%s\\n' 'discern ${version}'
    ;;
  docs)
    printf '%s\\n' '${
      JSON.stringify({ ok: true, verb: "docs", data: { docs } })
    }'
    ;;
  licenses)
    if [ "$#" -gt 1 ] && [ "$2" = "--json" ]; then
      printf '%s\\n' ${shellQuote(licensesJson)}
    else
      printf '%s' ${shellQuote(thirdPartyNotices)}
    fi
    ;;
  setup)
    mkdir -p discern
    printf '%s\\n' '[project]' > discern.toml
    printf '%s\\n' '# Instructions' > ${SOURCE_PATHS.instructions.defaultPath}
    ${scaffoldMap}
    ${materializeLegal}
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

Deno.test("release smoke proves version, licenses, bundled docs, and setup assets", async () => {
  await withTempDir(async (dir) => {
    await smokeReleaseBinary(await writeFakeDiscern(dir), "1.2.3");
  }, { prefix: "release-smoke-test-" });
});

Deno.test("release smoke rejects an unrelated future binary with the wrong version", async () => {
  await withTempDir(async (dir) => {
    const binary = await writeFakeDiscern(dir, { version: "9.9.9" });
    await assertRejects(
      () => smokeReleaseBinary(binary, "1.2.3"),
      Error,
      "does not match discern 1.2.3",
    );
  }, { prefix: "release-smoke-test-" });
});

Deno.test("release smoke rejects a binary missing licenses, docs, or templates", async () => {
  await withTempDir(async (dir) => {
    const noDocs = await writeFakeDiscern(dir, { docsRoot: false });
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

    const missingPayloadLicense = await writeFakeDiscern(dir, {
      missingLicenseKey: DISCERN_PROJECT_PAYLOAD_LICENSE.key,
    });
    await assertRejects(
      () => smokeReleaseBinary(missingPayloadLicense, "1.2.3"),
      Error,
      `missing ${DISCERN_PROJECT_PAYLOAD_LICENSE.key}`,
    );

    const truncatedPayloadLicense = await writeFakeDiscern(dir, {
      truncatedLicenseKey: DISCERN_PROJECT_PAYLOAD_LICENSE.key,
    });
    await assertRejects(
      () => smokeReleaseBinary(truncatedPayloadLicense, "1.2.3"),
      Error,
      `${DISCERN_PROJECT_PAYLOAD_LICENSE.key}.text differs`,
    );

    const materializedNotice = await writeFakeDiscern(dir, {
      materializedLegalPath: "NOTICE",
    });
    await assertRejects(
      () => smokeReleaseBinary(materializedNotice, "1.2.3"),
      Error,
      "materialized legal file NOTICE",
    );
  }, { prefix: "release-smoke-test-" });
});
