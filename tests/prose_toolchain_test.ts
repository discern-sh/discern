/**
 * Vale is part of the prose standard's measuring instrument. Its binary and
 * package versions therefore come from tracked authorities, and every authored
 * caller goes through the version-checking wrapper.
 */

import { dirname, isAbsolute, join } from "@std/path";
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { z } from "@zod/zod";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { parseValeVersion, runVale } from "../scripts/vale_lib.ts";
import {
  ensureVale,
  installEffectFailure,
  readValeAssets,
  resolveValeBinary,
  sha256BytesHex,
  type ValePlatform,
  valeToolchain,
} from "../scripts/vale_toolchain.ts";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

const ValeAlertSchema = z.object({
  Check: z.string().optional(),
  Severity: z.string().optional(),
});
const ValeOutputSchema = z.record(z.string(), z.array(ValeAlertSchema));
type ValeAlert = z.infer<typeof ValeAlertSchema>;

/** Alerts Vale returned for one fixture path, tolerant of `/tmp` symlinks. */
function fixtureAlerts(
  result: z.infer<typeof ValeOutputSchema>,
  suffix: string,
): ValeAlert[] {
  const entry = Object.entries(result).find(([path]) => path.endsWith(suffix));
  return entry?.[1] ?? [];
}

const RAW_VALE_PROVISIONING = [
  /\bvale\s+sync\b/u,
  /\bVALE_VERSION\b/u,
  /github\.com\/vale-cli\/vale\/releases\/download/u,
  /\bbrew\s+["']vale["']/u,
];

/** Find executable configuration that bypasses the pinned resolver task. */
function rawValeProvisioningFindings(
  sources: ReadonlyArray<readonly [string, string]>,
): string[] {
  return sources.flatMap(([path, source]) =>
    RAW_VALE_PROVISIONING.some((pattern) => pattern.test(source)) ? [path] : []
  );
}

/** Raw Vale provisioning that bypasses the repository's pinned resolver. */
async function rawValeProvisioningOffenders(
  root: string,
): Promise<string[]> {
  const files = await structuralGuardScope({
    guard: "tests/prose_toolchain_test.ts#vale-provisioning",
    universe: "authored-text",
    narrow: {
      reason:
        "Shell and dependency configuration can provision Vale; prose cannot run setup commands.",
      include: (path) =>
        /(?:^|\/)(?:Brewfile|Dockerfile|Makefile)$/u.test(path) ||
        /\.(?:json|sh|toml|ya?ml)$/u.test(path),
    },
  }, root);
  const sources: Array<readonly [string, string]> = [];
  for (const rel of files) {
    sources.push([rel, await Deno.readTextFile(join(root, rel))]);
  }
  return rawValeProvisioningFindings(sources);
}

Deno.test("executable configuration provisions Vale only through one task", async () => {
  assertEquals(
    await rawValeProvisioningOffenders(REPO_ROOT),
    [],
    "replace raw Vale installation or sync with `deno task vale:sync`",
  );
});

Deno.test("a future executable configuration cannot restore ambient Vale provisioning", () => {
  assertEquals(
    rawValeProvisioningFindings([
      ["tools/future.yml", "run: vale sync\n"],
      ["tools/pinned.yml", "run: deno task vale:sync\n"],
    ]),
    ["tools/future.yml"],
  );
});

Deno.test("the Vale binary has one tracked version authority", async () => {
  const expected = (
    await Deno.readTextFile(join(REPO_ROOT, ".vale-version"))
  ).trim();
  assertMatch(expected, /^\d+\.\d+\.\d+$/);

  const workflow = await Deno.readTextFile(
    join(REPO_ROOT, ".github/workflows/gate.yml"),
  );
  const assetsSource = await Deno.readTextFile(
    join(REPO_ROOT, ".vale-assets.json"),
  );
  assert(
    !/"version"\s*:/u.test(assetsSource),
    "asset integrity metadata must not repeat the version pin",
  );
  assertStringIncludes(workflow, "deno task vale:sync");
  const config = parseConfigOrThrow(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  );
  assertEquals(
    config.repository.ensure.filter((command) =>
      command.toLowerCase().includes("vale")
    ),
    ["deno task vale:sync"],
  );
  assertEquals(parseValeVersion(`vale version ${expected}\n`), expected);
});

/** Convert a release target triple to the host spelling Vale resolves. */
function valePlatformForTarget(triple: string): string {
  const arch = triple.split("-")[0];
  assert(arch === "aarch64" || arch === "x86_64", triple);
  const os = triple.endsWith("apple-darwin") ? "darwin" : "linux";
  return `${os}-${arch}`;
}

Deno.test("every native release platform has one checksum-pinned Vale asset", async () => {
  const manifest = await readValeAssets(REPO_ROOT);
  assertEquals(
    Object.keys(manifest.assets).sort(),
    BUILD_TARGETS.map((target) => valePlatformForTarget(target.triple)).sort(),
  );
  const checksums = Object.values(manifest.assets).map((asset) => asset.sha256);
  assertEquals(new Set(checksums).size, checksums.length);
});

/** Count automation commands whose process needs the prose measuring tool. */
function valeMeasuredRuns(source: string): number {
  return source.match(/deno task dev (?:done|standards)\b/gu)?.length ?? 0;
}

/** Count the one supported provisioning task in an automation source. */
function pinnedValeSetups(source: string): number {
  return source.match(/deno task vale:sync\b/gu)?.length ?? 0;
}

Deno.test("every automated Vale-measured run provisions through the pinned task", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/prose_toolchain_test.ts#vale-automation-lanes",
      universe: {
        kind: "specialized",
        name: "automation-yaml",
        extensions: [".yml", ".yaml"],
        reason:
          "GitHub automation is YAML; other configuration formats do not define hosted gate lanes.",
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    const measured = valeMeasuredRuns(source);
    if (measured > 0 && pinnedValeSetups(source) !== measured) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "each automated `done` or `standards` run needs its own pinned Vale setup",
  );
});

Deno.test("Vale packages are immutable release artifacts", async () => {
  const config = await Deno.readTextFile(join(REPO_ROOT, ".vale.ini"));
  const packages = config.match(/^Packages\s*=\s*(.+)$/m)?.[1]
    ?.split(",")
    .map((entry) => entry.trim()) ?? [];
  assertEquals(packages.length, 2);
  for (const packageUrl of packages) {
    assertMatch(
      packageUrl,
      /^https:\/\/github\.com\/vale-cli\/[^/]+\/releases\/download\/v[^/]+\/[^/]+\.zip$/,
    );
  }
});

Deno.test("authored Deno sources invoke Vale only through its wrapper", async () => {
  const directVale = /new\s+Deno\.Command\(\s*["']vale["']/;
  const internalToolchainImport = /from\s+["'][^"']*vale_toolchain\.ts["']/u;
  const toolchainImportHomes = new Set([
    "scripts/vale_lib.ts",
    "tests/prose_toolchain_test.ts",
  ]);
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/prose_toolchain_test.ts#prose-toolchain-imports",
      universe: "authored-deno",
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (directVale.test(source)) offenders.push(`${rel}: ambient command`);
    if (
      internalToolchainImport.test(source) && !toolchainImportHomes.has(rel)
    ) {
      offenders.push(`${rel}: internal toolchain import`);
    }
  }
  assertEquals(
    offenders,
    [],
    `direct Vale invocations bypass the version check: ${offenders.join(", ")}`,
  );
});

interface FakeValeFixture {
  readonly repoRoot: string;
  readonly cacheRoot: string;
  readonly platform: ValePlatform;
  readonly archive: Uint8Array;
}

/** Seed an executable fake Vale release and matching tracked authorities. */
async function fakeValeFixture(
  dir: string,
  version = "3.15.2",
): Promise<FakeValeFixture> {
  const repoRoot = join(dir, "repo");
  const payload = join(dir, "payload");
  const archivePath = join(dir, "vale.tar.gz");
  await Deno.mkdir(repoRoot);
  await Deno.mkdir(payload);
  const binary = join(payload, "vale");
  await Deno.writeTextFile(
    binary,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf 'vale version ${version}\\n'\nelse\n  printf 'pinned:%s\\n' "$*"\nfi\n`,
  );
  await Deno.chmod(binary, 0o755);
  const tar = await new Deno.Command("tar", {
    args: ["-czf", archivePath, "-C", payload, "vale"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(tar.success, new TextDecoder().decode(tar.stderr));
  const archive = await Deno.readFile(archivePath);
  await Deno.writeTextFile(join(repoRoot, ".vale-version"), `${version}\n`);
  await Deno.writeTextFile(
    join(repoRoot, ".vale-assets.json"),
    `${
      JSON.stringify(
        {
          schema: 1,
          assets: {
            "linux-x86_64": {
              release: "Linux_64-bit",
              sha256: await sha256BytesHex(archive),
            },
          },
        },
        null,
        2,
      )
    }\n`,
  );
  return {
    repoRoot,
    cacheRoot: join(dir, "cache"),
    platform: { os: "linux", arch: "x86_64" },
    archive,
  };
}

Deno.test("the default Vale cache is project state shared through Git", async () => {
  const result = await new Deno.Command("git", {
    args: ["rev-parse", "--git-common-dir"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(result.success, new TextDecoder().decode(result.stderr));
  const rawCommonDir = new TextDecoder().decode(result.stdout).trim();
  const commonDir = isAbsolute(rawCommonDir)
    ? rawCommonDir
    : join(REPO_ROOT, rawCommonDir);
  const toolchain = await valeToolchain(REPO_ROOT);
  assertEquals(
    toolchain.cacheDir,
    join(
      commonDir,
      "discern-development",
      "toolchains",
      "vale",
      toolchain.version,
      toolchain.platform,
      toolchain.asset.sha256,
    ),
  );
});

Deno.test("a newer Vale on PATH cannot replace the pinned measuring binary", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    const options = {
      cacheRoot: fixture.cacheRoot,
      platform: fixture.platform,
      download: () => Promise.resolve(fixture.archive),
    };
    const [first, second] = await Promise.all([
      ensureVale(fixture.repoRoot, options),
      ensureVale(fixture.repoRoot, options),
    ]);
    assertEquals(first, second, "concurrent setup converges on one cache");

    const ambient = join(dir, "ambient");
    await Deno.mkdir(ambient);
    await Deno.writeTextFile(
      join(ambient, "vale"),
      "#!/bin/sh\nprintf 'vale version 3.18.0\\n'\n",
    );
    await Deno.chmod(join(ambient, "vale"), 0o755);
    const run = await runVale(fixture.repoRoot, ["future.md"], {
      ...options,
      env: { PATH: ambient },
    });
    assert(run.success);
    assertEquals(new TextDecoder().decode(run.stdout), "pinned:future.md\n");
  });
});

Deno.test("a corrupt Vale cache is rejected and repaired from verified bytes", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    const options = {
      cacheRoot: fixture.cacheRoot,
      platform: fixture.platform,
      download: () => Promise.resolve(fixture.archive),
    };
    const binary = await ensureVale(fixture.repoRoot, options);
    await Deno.writeTextFile(
      binary,
      "#!/bin/sh\nprintf 'vale version 3.18.0\\n'\n",
    );
    await Deno.chmod(binary, 0o755);
    await assertRejects(
      () => resolveValeBinary(fixture.repoRoot, options),
      Error,
      "does not match its installed digest",
    );
    assertEquals(await ensureVale(fixture.repoRoot, options), binary);
    assertEquals(await resolveValeBinary(fixture.repoRoot, options), binary);
  });
});

Deno.test("Vale provisioning refuses bytes that miss the tracked checksum", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    const manifest = await readValeAssets(fixture.repoRoot);
    manifest.assets["linux-x86_64"] = {
      release: "Linux_64-bit",
      sha256: "0".repeat(64),
    };
    await Deno.writeTextFile(
      join(fixture.repoRoot, ".vale-assets.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const options = {
      cacheRoot: fixture.cacheRoot,
      platform: fixture.platform,
      download: () => Promise.resolve(fixture.archive),
    };
    await assertRejects(
      () => ensureVale(fixture.repoRoot, options),
      Error,
      "archive checksum mismatch",
    );
    const toolchain = await valeToolchain(fixture.repoRoot, options);
    await assertRejects(
      () => Deno.stat(toolchain.binary),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("native Windows is unsupported while WSL resolves the Linux asset", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    await assertRejects(
      () =>
        valeToolchain(fixture.repoRoot, {
          cacheRoot: fixture.cacheRoot,
          platform: { os: "windows", arch: "x86_64" },
        }),
      Error,
      "no tracked asset for windows-x86_64",
    );
  });
});

Deno.test("a failed Vale download names its cause and the operator's next step", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    const rejection = await assertRejects(
      () =>
        ensureVale(fixture.repoRoot, {
          cacheRoot: fixture.cacheRoot,
          platform: fixture.platform,
          download: () =>
            Promise.reject(new Error("error sending request for url")),
        }),
      Error,
      "Vale download failed",
    );
    assertStringIncludes(rejection.message, "error sending request for url");
    assertStringIncludes(rejection.message, "github.com");
    assertStringIncludes(rejection.message, "deno task vale:sync");
  });
});

Deno.test("a blocked install write names the denied effect and the macOS permission surface", () => {
  // The deterministic seam first: a permission denial on macOS names App
  // Management; elsewhere the cause and next step stand alone.
  const denied = new Deno.errors.PermissionDenied(
    "Operation not permitted (os error 1)",
  );
  const darwin = installEffectFailure(
    "mark the staged Vale binary executable",
    "/cache/vale",
    denied,
    "darwin",
  );
  assertStringIncludes(darwin.message, "mark the staged Vale binary");
  assertStringIncludes(darwin.message, "Operation not permitted");
  assertStringIncludes(darwin.message, "App Management");
  assertStringIncludes(darwin.message, "deno task vale:sync");
  const linux = installEffectFailure(
    "mark the staged Vale binary executable",
    "/cache/vale",
    denied,
    "linux",
  );
  assertStringIncludes(linux.message, "Operation not permitted");
  assertStringIncludes(linux.message, "deno task vale:sync");
  assert(!linux.message.includes("App Management"));
});

Deno.test("a denied cache write fails provisioning with the explained effect, not a bare stack", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    await Deno.mkdir(fixture.cacheRoot);
    await Deno.chmod(fixture.cacheRoot, 0o555);
    try {
      const rejection = await assertRejects(
        () =>
          ensureVale(fixture.repoRoot, {
            cacheRoot: fixture.cacheRoot,
            platform: fixture.platform,
            download: () => Promise.resolve(fixture.archive),
          }),
        Error,
        "Could not create the shared Vale cache directory",
      );
      assertStringIncludes(rejection.message, "deno task vale:sync");
    } finally {
      await Deno.chmod(fixture.cacheRoot, 0o755);
    }
  });
});

Deno.test("the gate-facing resolve path never performs a download", async () => {
  await withTempDir(async (dir) => {
    const fixture = await fakeValeFixture(dir);
    let downloads = 0;
    const options = {
      cacheRoot: fixture.cacheRoot,
      platform: fixture.platform,
      download: (): Promise<Uint8Array> => {
        downloads += 1;
        return Promise.reject(new Error("resolve path attempted a download"));
      },
    };
    // A cold cache refuses with the provisioning next step instead of
    // fetching: the first download belongs to `deno task vale:sync` at the
    // checkout-ensure boundary, never to a gate's prose step.
    const rejection = await assertRejects(
      () => resolveValeBinary(fixture.repoRoot, options),
      Error,
      "not ready in the repository cache",
    );
    assertStringIncludes(rejection.message, "deno task vale:sync");
    await assertRejects(
      () => runVale(fixture.repoRoot, ["--output=JSON"], options),
      Error,
      "not ready in the repository cache",
    );
    assertEquals(downloads, 0, "resolution must stay network-free");
  });
});

Deno.test("the Vale wrapper exposes no provisioning verb to its gate-facing callers", async () => {
  // The import guard above makes vale_lib.ts the ONE module allowed to import
  // the toolchain, so keeping the provisioning entry points out of it keeps
  // every gate-facing caller resolve-only by construction.
  const source = await Deno.readTextFile(
    join(REPO_ROOT, "scripts", "vale_lib.ts"),
  );
  for (const verb of ["ensureVale", "syncVale"]) {
    assert(
      !source.includes(verb),
      `scripts/vale_lib.ts must not surface ${verb}; provisioning belongs to \`deno task vale:sync\``,
    );
  }
});

Deno.test("a failing prose measurement still lands its explanation on stdout", async () => {
  // The standard's captured evidence is the measurement's stdout, so a failure
  // that explains itself only on stderr fails the gate with empty diagnostics.
  await withTempDir(async (dir) => {
    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        join("scripts", "prose.ts"),
        join(dir, "absent-docs"),
      ],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(run.stdout);
    assertEquals(run.code, 1);
    assertStringIncludes(stdout, "prose measurement failed");
  });
});

Deno.test("brand-path severity cannot downgrade house errors on other map pages", async () => {
  await withTempDir(async (dir) => {
    const publicRel = "00-orientation/future-sibling.md";
    const brandRel = "_internal/brand/declarations.md";
    const adrRel = "_adr/9999-history.md";
    const body = [
      "# Voice fixture",
      "",
      "We leverage a robust system.",
      "The note rides along with the change.",
      "Obviously, the command works.",
      "In a world where agents work, this is the shape of the workflow.",
      "",
    ].join("\n");
    for (const rel of [publicRel, brandRel, adrRel]) {
      const path = join(dir, rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, body);
    }

    const run = await runVale(REPO_ROOT, [
      "--output=JSON",
      "--minAlertLevel=suggestion",
      dir,
    ]);
    const parsed = decodeWith(
      ValeOutputSchema,
      new TextDecoder().decode(run.stdout),
    );
    const expected = [
      "Discern.VendorSpeak",
      "Discern.Hype",
      "Discern.MaturedSeasoning",
      "Discern.Filler",
      "Discern.SceneSetting",
      "Discern.Jargon",
    ];
    for (const rel of [publicRel, brandRel]) {
      const alerts = fixtureAlerts(parsed, rel);
      for (const check of expected) {
        assertEquals(
          alerts.find((alert) => alert.Check === check)?.Severity,
          "error",
          `${rel}: ${check} must keep its authored error severity`,
        );
      }
    }
    assertEquals(
      fixtureAlerts(parsed, adrRel).filter((alert) =>
        typeof alert.Check === "string" && alert.Check.startsWith("Discern.")
      ),
      [],
      "historical ADRs do not receive the house-voice style",
    );
  });
});
