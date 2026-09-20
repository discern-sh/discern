/**
 * The release may publish only native-executed, smoke-tested build targets.
 *
 * Guards: boundary:application-independent-binary
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, join } from "@std/path";
import {
  BUILD_TARGETS,
  type BuildTarget,
  releaseArtifactPaths,
} from "../scripts/build_targets.ts";
import {
  type ReleasePlan,
  releasePlan as validatedReleasePlan,
  type ReleasePlanOptions,
} from "../scripts/release_plan.ts";
import { parseReleaseRecords } from "../site/releases/records.ts";
import { DISCERN_VERSION, humanVersion } from "../src/lib/version.ts";

/** Matrix controls provide a valid authored record; publication cases live in releases_test. */
function releasePlan(
  tag: string,
  options: Omit<ReleasePlanOptions, "records" | "published" | "ancestors">,
): ReleasePlan {
  const version = options.version ?? DISCERN_VERSION;
  const records = tag === "vnext" ? [] : parseReleaseRecords([{
    path: `${version}.md`,
    markdown:
      "---\nsummary: Native release fixture\n---\nVerified native artifacts.",
  }]);
  return validatedReleasePlan(tag, {
    ...options,
    records,
    published: [],
    ancestors: [],
  });
}
import {
  assertNoReleasePathLeaks,
  releasePathLeaks,
  smokeReleaseBinary,
} from "../scripts/release_smoke.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  DISCERN_PROJECT_PAYLOAD_LICENSE,
  FIRST_PARTY_LEGAL_DOCUMENTS,
} from "../src/shared/license_registry.ts";
import { withTempDir } from "./helpers.ts";
import { canonicalDocTarget, discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { stripManualSourceComments } from "../scripts/build.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { createWorkflowChecksum } from "./release_workflow_fixture.ts";

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
  assertStringIncludes(
    releaseSource,
    "REPOSITORY_PRIVATE: ${{ github.event.repository.private }}",
  );
});

Deno.test("every build target auto-enrols in the native release matrix", () => {
  const plan = releasePlan("v1.2.3", {
    repositoryPrivate: false,
    version: "1.2.3",
  });
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
    installer: {
      os: "Linux",
      operatingSystem: "GNU/Linux",
      architectures: ["riscv64"],
    },
  };
  assertEquals(
    releasePlan("v1.2.3", {
      repositoryPrivate: false,
      version: "1.2.3",
      targets: [future],
    }).matrix.include,
    [{
      gateBeforeBuild: false,
      target: future.triple,
      output: future.output,
      os: future.runner,
    }],
  );
});

Deno.test("release targets ship no native Windows executable or build path", () => {
  for (const target of BUILD_TARGETS) {
    assertEquals(target.triple.includes("windows"), false, target.triple);
    assertEquals(target.output.endsWith(".exe"), false, target.output);
    assertEquals(
      target.installer.os === "Darwin" || target.installer.os === "Linux",
      true,
    );
  }
  assertStringIncludes(releaseSource, "deno task build ${{ matrix.target }}");
  assertEquals(releaseSource.match(/deno task build /gu)?.length, 1);
});

Deno.test("a tag/package mismatch is refused before the matrix exists", () => {
  assertThrows(
    () =>
      releasePlan("v1.2.4", {
        repositoryPrivate: false,
        version: "1.2.3",
      }),
    Error,
    "release tag v1.2.4 does not match package version v1.2.3",
  );
});

Deno.test("every private v* tag is refused with no release-plan override", () => {
  for (const tag of ["v1.2.3", "v1.2.3-beta.1", "vnext"]) {
    assertThrows(
      () =>
        releasePlan(tag, {
          repositoryPrivate: true,
          version: tag.slice(1),
        }),
      Error,
      "cannot run while the repository is private",
    );
  }
  assertEquals(releaseSource.includes("workflow_dispatch"), false);
});

Deno.test("release stability derives prerelease and latest behavior from the package version", () => {
  const stable = releasePlan("v1.2.3", {
    repositoryPrivate: false,
    version: "1.2.3",
  });
  assertEquals(stable.prerelease, false);
  assertEquals(stable.makeLatest, true);
  const prerelease = releasePlan("v1.2.3-rc.1", {
    repositoryPrivate: false,
    version: "1.2.3-rc.1",
  });
  assertEquals(prerelease.prerelease, true);
  assertEquals(prerelease.makeLatest, false);
  assertStringIncludes(
    releaseSource,
    "prerelease: ${{ steps.publication-plan.outputs.prerelease }}",
  );
  assertStringIncludes(
    releaseSource,
    "make_latest: ${{ steps.publication-plan.outputs.make_latest }}",
  );
});

Deno.test("release artifacts and provenance subjects keep binary-sidecar parity", () => {
  const expected = BUILD_TARGETS.flatMap(releaseArtifactPaths);
  assertEquals(expected.length, BUILD_TARGETS.length * 2);
  assertEquals(new Set(expected).size, expected.length);
  const checksum = releaseSource.indexOf("- name: Checksum");
  const attest = releaseSource.indexOf("- name: Attest build provenance");
  const upload = releaseSource.indexOf("- name: Upload build artifacts");
  const cleanup = releaseSource.indexOf("- name: Remove Apple");
  assert(attest > checksum, "provenance follows checksum creation");
  assert(upload > attest, "upload follows provenance");
  for (
    const block of [
      releaseSource.slice(attest, upload),
      releaseSource.slice(upload, cleanup),
    ]
  ) {
    assertStringIncludes(block, "dist/${{ matrix.output }}");
    assertStringIncludes(block, "dist/${{ matrix.output }}.sha256");
  }
  assert(
    !releaseSource.slice(attest, upload).includes("if:"),
    "the attestation step runs for every tag",
  );
});

Deno.test("the workflow checksum command produces the installer sidecar fixture", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "dist"));
    const output = BUILD_TARGETS[0]?.output;
    assert(output !== undefined);
    await Deno.writeTextFile(join(root, "dist", output), "release fixture\n");
    const sidecar = await createWorkflowChecksum(root, output);
    const text = await Deno.readTextFile(sidecar);
    assertStringIncludes(text, `  ${output}\n`);
    const checked = await new Deno.Command("shasum", {
      args: ["-a", "256", "-c", `${output}.sha256`],
      cwd: join(root, "dist"),
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(checked.success, new TextDecoder().decode(checked.stderr));
  }, { prefix: "release-checksum-test-" });
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
  /** Emit the authored page instead of the public projection the build embeds. */
  authoredDocsSource?: boolean;
  docsRoot?: boolean;
  docsRootOnly?: boolean;
  embeddedLeak?: string;
  materializedLegalPath?: string;
  missingLicenseKey?: string;
  scaffoldMap?: boolean;
  truncatedLicenseKey?: string;
  version?: string;
  versionOutput?: string;
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
  const manualDir = resolveRepositoryManualDir(REPO_ROOT).abs;
  const manualTree = await discoverDocs({ cwd: REPO_ROOT, dir: manualDir });
  assert(manualTree !== undefined);
  const manual = await buildManualProjection(manualTree.entries);
  const completeDocs = manual.pages.map((page) => ({
    target: canonicalDocTarget(page.entry),
    path: `docs/${page.entry.relToDocs}`,
    page_id: page.id,
    manual_kind: page.kind,
  }));
  const docs = options.docsRoot === false
    ? []
    : options.docsRootOnly === true
    ? completeDocs.slice(0, 1)
    : completeDocs;
  const docsJson = JSON.stringify({
    ok: true,
    verb: "docs",
    data: { count: docs.length, docs },
  });
  const authoredConfigReference = await Deno.readTextFile(
    join(manualDir, "30-reference/config-reference.md"),
  );
  const rawConfigReference = options.authoredDocsSource === true
    ? authoredConfigReference
    : stripManualSourceComments(authoredConfigReference);
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
    : `mkdir -p ${SOURCE_PATHS.map.defaultPath}; printf '# Map\\n' > ${SOURCE_PATHS.map.defaultPath}/README.md`;
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
    printf '%s\\n' ${
      shellQuote(options.versionOutput ?? humanVersion({ version }))
    }
    ;;
  docs)
    if [ "$#" -ge 3 ] && [ "$2" = "30-reference/config-reference" ] && [ "$3" = "--raw" ]; then
      printf '%s' ${shellQuote(rawConfigReference)}
    else
      printf '%s\\n' ${shellQuote(docsJson)}
    fi
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
    printf '%s\\n' '${JSON.stringify({ ok: true, verb: "setup begin" })}'
    ;;
  *)
    exit 64
    ;;
esac
${options.embeddedLeak === undefined ? "" : `# ${options.embeddedLeak}`}
`,
  );
  await Deno.chmod(binary, 0o755);
  return binary;
}

Deno.test("release smoke proves version, licenses, bundled docs, and setup assets", async () => {
  await withTempDir(async (dir) => {
    for (const codename of [undefined, "Test family"]) {
      const versionOutput = humanVersion({
        version: "1.2.3",
        ...(codename === undefined ? {} : { codename }),
      });
      await smokeReleaseBinary(
        await writeFakeDiscern(dir, { versionOutput }),
        "1.2.3",
      );
    }
  }, { prefix: "release-smoke-test-" });
});

Deno.test("release smoke expects the public projection of a bundled page, not its authored source", async () => {
  const authored = await Deno.readTextFile(
    join(
      resolveRepositoryManualDir(REPO_ROOT).abs,
      "30-reference/config-reference.md",
    ),
  );
  assert(
    authored !== stripManualSourceComments(authored),
    "the fixture page must carry a source-generation comment for this proof to bite",
  );
  await withTempDir(async (dir) => {
    const binary = await writeFakeDiscern(dir, { authoredDocsSource: true });
    await assertRejects(
      () => smokeReleaseBinary(binary, "1.2.3"),
      Error,
      "differs from the public projection",
    );
  }, { prefix: "release-smoke-test-" });
});

Deno.test("release smoke rejects an unrelated future binary with the wrong version", async () => {
  await withTempDir(async (dir) => {
    for (
      const versionOutput of [
        humanVersion({ version: "9.9.9", codename: "Test family" }),
        "another-tool 1.2.3",
        "1.2.3",
        "discern 1.2.3\nextra output",
      ]
    ) {
      const binary = await writeFakeDiscern(dir, { versionOutput });
      await assertRejects(
        () => smokeReleaseBinary(binary, "1.2.3"),
        Error,
        "does not match discern 1.2.3",
      );
    }
  }, { prefix: "release-smoke-test-" });
});

Deno.test("release smoke rejects checkout, workspace, runner-temp, and package-cache paths", async () => {
  await withTempDir(async (dir) => {
    const cases = [
      { label: "checkout", path: REPO_ROOT, environment: {} },
      {
        label: "package cache",
        path: "/sensitive/home/.cache/deno",
        environment: { HOME: "/sensitive/home" },
      },
      {
        label: "workspace",
        path: "/sensitive/workspace",
        environment: { GITHUB_WORKSPACE: "/sensitive/workspace" },
      },
      {
        label: "runner temp",
        path: "/sensitive/runner-temp",
        environment: { RUNNER_TEMP: "/sensitive/runner-temp" },
      },
      {
        label: "package cache",
        path: "/sensitive/package-cache",
        environment: { DENO_DIR: "/sensitive/package-cache" },
      },
    ] as const;
    for (const testCase of cases) {
      const binary = await writeFakeDiscern(dir, {
        embeddedLeak: testCase.path,
      });
      await assertRejects(
        () =>
          smokeReleaseBinary(binary, "1.2.3", {
            environment: testCase.environment,
          }),
        Error,
        `contains local ${testCase.label} path`,
        `${testCase.label} path must block release smoke`,
      );
    }
  }, { prefix: "release-path-leak-test-" });
});

Deno.test("the leak guard accepts the toolchain's own build paths under a shared runner home", async () => {
  // Deno's runtime and the bundled plugins are built on hosted runners, so
  // their panic locations name the same home every hosted release job has.
  await withTempDir(async (dir) => {
    for (const home of ["/home/runner", "/Users/runner"]) {
      const candidates = releasePathLeaks({ HOME: home }).map((c) => c.path);
      assertEquals(
        candidates.filter((path) => path.startsWith(`${home}/`)),
        [`${home}/.cache/deno`, `${home}/Library/Caches/deno`, `${home}/.npm`],
      );
      assert(!candidates.includes(home));
      const binary = join(dir, "toolchain-strings");
      await Deno.writeTextFile(
        binary,
        `${home}/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.210/src/de/mod.rs\n` +
          `${home}/work/deno/deno/runtime/js/99_main.js\n`,
      );
      await assertNoReleasePathLeaks(binary, releasePathLeaks({ HOME: home }));
      await assertRejects(
        () =>
          assertNoReleasePathLeaks(
            binary,
            releasePathLeaks({ HOME: home, RUNNER_TEMP: `${home}/work` }),
          ),
        Error,
        "contains local runner temp path",
      );
    }
  }, { prefix: "release-runner-home-test-" });
});

Deno.test("release smoke rejects a binary missing licenses, docs, or templates", async () => {
  await withTempDir(async (dir) => {
    const noDocs = await writeFakeDiscern(dir, { docsRoot: false });
    await assertRejects(
      () => smokeReleaseBinary(noDocs, "1.2.3"),
      Error,
      "does not match the canonical manual set",
    );

    const rootOnlyDocs = await writeFakeDiscern(dir, { docsRootOnly: true });
    await assertRejects(
      () => smokeReleaseBinary(rootOnlyDocs, "1.2.3"),
      Error,
      "does not match the canonical manual set",
    );

    const noMap = await writeFakeDiscern(dir, { scaffoldMap: false });
    await assertRejects(
      () => smokeReleaseBinary(noMap, "1.2.3"),
      Error,
      `did not scaffold ${SOURCE_PATHS.map.defaultPath}/README.md`,
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
