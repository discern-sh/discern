/**
 * Run pinned FTA over the exact authored-Deno universe, report the top
 * production/tooling/test files, and enforce the reviewed extreme tail.
 */

import "fta-cli";
import { createRequire } from "module";
import { dirname, join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  generatedGroupForPath,
  resolveGeneratedGroups,
} from "../src/shared/generated_artifacts.ts";
import { runGit, runShell } from "../src/shared/subprocess.ts";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import {
  type ComplexityArea,
  complexityHotspotFindings,
  type ComplexityMetric,
  type ComplexityRank,
  contextualizeComplexity,
  expectedFtaFiles,
  ftaEnrollmentFindings,
  type FtaMetric,
  parseFtaJson,
  rankComplexity,
} from "./complexity_lib.ts";
import { COMPLEXITY_HOTSPOT_BUDGETS } from "./complexity_hotspots.ts";
import { withToolTempDir } from "./temp_dir.ts";

const FTA_IMPORT = "npm:fta-cli@3.0.1";
const REPORT_AREAS = [
  "production",
  "tooling",
  "tests",
] as const satisfies readonly Exclude<
  ComplexityArea,
  "generated"
>[];
const REPORT_RANKS = [
  "score",
  "cyclo",
  "lines",
  "touches",
] as const satisfies readonly ComplexityRank[];

/** Quote one literal argv item for the shared POSIX-shell capability. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Platform-specific binary directory shipped inside fta-cli 3.0.1. */
function ftaBinaryRelativePath(): string {
  const platform = `${Deno.build.os}:${Deno.build.arch}`;
  switch (platform) {
    case "darwin:aarch64":
      return "binaries/fta-aarch64-apple-darwin/fta";
    case "darwin:x86_64":
      return "binaries/fta-x86_64-apple-darwin/fta";
    case "linux:aarch64":
      return "binaries/fta-aarch64-unknown-linux-musl/fta";
    case "linux:x86_64":
      return "binaries/fta-x86_64-unknown-linux-musl/fta";
    case "linux:arm":
      return "binaries/fta-arm-unknown-linux-musleabi/fta";
    case "windows:aarch64":
      return "binaries/fta-aarch64-pc-windows-msvc/fta.exe";
    case "windows:x86_64":
      return "binaries/fta-x86_64-pc-windows-msvc/fta.exe";
    default:
      throw new Error(`fta-cli 3.0.1 has no binary for ${platform}`);
  }
}

/** Resolve the package binary without relying on the package's shell wrapper. */
function installedFtaBinary(): string {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("fta-cli/package.json");
  return join(dirname(manifest), ftaBinaryRelativePath());
}

/** Verify the import-map pin and return the installed analyzer version. */
async function ftaVersion(): Promise<string> {
  const configText = await Deno.readTextFile(join(REPO_ROOT, "deno.json"));
  const config: unknown = JSON.parse(configText);
  if (typeof config !== "object" || config === null) {
    throw new Error("deno.json must contain an object");
  }
  const imports = Reflect.get(config, "imports");
  const configured = typeof imports === "object" && imports !== null
    ? Reflect.get(imports, "fta-cli")
    : undefined;
  if (configured !== FTA_IMPORT) {
    throw new Error(`deno.json must pin fta-cli to ${FTA_IMPORT}`);
  }
  const manifestText = await Deno.readTextFile(
    join(dirname(installedFtaBinary()), "..", "..", "package.json"),
  );
  const manifest: unknown = JSON.parse(manifestText);
  const version = typeof manifest === "object" && manifest !== null
    ? Reflect.get(manifest, "version")
    : undefined;
  if (version !== "3.0.1") throw new Error("resolved fta-cli is not 3.0.1");
  return version;
}

/** Copy the canonical sources and pinned analyzer into one owned projection. */
async function runFta(
  files: readonly string[],
): Promise<{ readonly metrics: FtaMetric[]; readonly stderr: string }> {
  return await withToolTempDir("fta-analysis", async (stage) => {
    for (const file of files) {
      const destination = join(stage, file);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.copyFile(join(REPO_ROOT, file), destination);
    }
    await Deno.copyFile(join(REPO_ROOT, "fta.json"), join(stage, "fta.json"));
    const stagedBinary = join(
      stage,
      Deno.build.os === "windows" ? "fta.exe" : "fta",
    );
    await Deno.copyFile(installedFtaBinary(), stagedBinary);
    if (Deno.build.os !== "windows") await Deno.chmod(stagedBinary, 0o755);
    const result = await runShell(
      [stagedBinary, stage, "--json"].map(shellQuote).join(" "),
      { cwd: REPO_ROOT },
    );
    const decode = new TextDecoder();
    const stdout = decode.decode(result.stdout);
    const stderr = decode.decode(result.stderr).trim();
    if (!result.success) {
      throw new Error(
        `FTA failed with exit ${result.code}: ${
          stderr || stdout || "no output"
        }`,
      );
    }
    return { metrics: parseFtaJson(stdout), stderr };
  });
}

/** Count full-history commits touching each currently authored source. */
async function sourceTouches(
  files: ReadonlySet<string>,
): Promise<Map<string, number>> {
  const result = await runGit(
    ["log", "--format=", "--name-only", "-z", "--"],
    { cwd: REPO_ROOT },
  );
  if (!result.success) {
    throw new Error(`git log failed: ${result.stderr.trim()}`);
  }
  const touches = new Map<string, number>();
  for (const path of result.stdout.split("\0")) {
    if (!files.has(path)) continue;
    touches.set(path, (touches.get(path) ?? 0) + 1);
  }
  return touches;
}

/** One compact ranked row, with every advisory axis visible. */
function renderMetric(metric: ComplexityMetric): string {
  return `${metric.file} · score ${
    metric.score.toFixed(2)
  } · cyclo ${metric.cyclo} · lines ${metric.lines} · touches ${metric.touches}`;
}

/** Print independent rankings so one aggregate score cannot hide the reason. */
function report(metrics: readonly ComplexityMetric[], version: string): void {
  console.error(
    `FTA ${version} analyzed ${metrics.length} exact authored sources; ` +
      `${
        metrics.filter((metric) => metric.area === "generated").length
      } generated projections are reported but do not consume hotspot budgets.`,
  );
  for (const area of REPORT_AREAS) {
    console.error(`\n${area}:`);
    for (const rank of REPORT_RANKS) {
      console.error(`  by ${rank}:`);
      for (const metric of rankComplexity(metrics, area, rank)) {
        console.error(`    ${renderMetric(metric)}`);
      }
    }
  }
}

const authoredFiles = await structuralGuardScope({
  guard: "scripts/complexity.ts#authored-fta-enrollment",
  universe: "authored-deno",
});
const expected = expectedFtaFiles(authoredFiles);
const version = await ftaVersion();
const analyzed = await runFta(authoredFiles);
const enrollment = ftaEnrollmentFindings(expected, analyzed.metrics);
if (analyzed.stderr !== "") {
  enrollment.push(`FTA emitted parser diagnostics: ${analyzed.stderr}`);
}
if (enrollment.length > 0) {
  throw new Error(`FTA enrollment failed:\n  ${enrollment.join("\n  ")}`);
}

const config = await loadConfig(REPO_ROOT);
const generatedGroups = resolveGeneratedGroups(config);
const generatedFiles = new Set(
  expected.filter((file) =>
    generatedGroupForPath(generatedGroups, file) !== undefined
  ),
);
const metrics = contextualizeComplexity(
  analyzed.metrics,
  generatedFiles,
  await sourceTouches(new Set(expected)),
);
report(metrics, version);

const hotspotFindings = complexityHotspotFindings(
  metrics,
  COMPLEXITY_HOTSPOT_BUDGETS,
);
if (hotspotFindings.length > 0) {
  throw new Error(
    `complexity hotspot budgets diverged:\n  ${hotspotFindings.join("\n  ")}`,
  );
}
console.error(
  `${COMPLEXITY_HOTSPOT_BUDGETS.length} reviewed files remain above the extreme-tail thresholds.`,
);
console.log(
  `DISCERN_METRIC complexity_hotspots ${COMPLEXITY_HOTSPOT_BUDGETS.length}`,
);
