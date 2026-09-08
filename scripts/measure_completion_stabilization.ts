/** Reproducible public-command overhead measurements; run after 1A/1B integration. */
import { cpus, loadavg, totalmem } from "os";
import { fromFileUrl } from "@std/path";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import {
  type CliJsonResultCommand,
  decodeCliResult,
} from "../tests/decode_cli_result.ts";
import { project } from "../tests/completion_public_fixture.ts";
import { withTempDir } from "../tests/helpers.ts";
import { git, gitOut, runAgent } from "../tests/engine_helpers.ts";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";

const reportPath = Deno.args[0] ?? "/tmp/discern-1c-measurements.json";
const report: {
  source: string;
  at: string;
  cache: string;
  host: { logical_cpus: number; memory_bytes: number; load: number[] };
  fixture: string;
  rows: Record<string, unknown>[];
} = {
  source: await gitOut(
    fromFileUrl(new URL("..", import.meta.url)),
    "rev-parse",
    "HEAD",
  ),
  at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
  cache:
    "Fresh disposable repositories; existing Deno dependency cache; no filesystem cache flush; storage inventory warms Git-admin metadata before each command",
  host: {
    logical_cpus: cpus().length,
    memory_bytes: totalmem(),
    load: loadavg(),
  },
  fixture:
    "The shared public completion fixture: one authored source, one controlled shared test/coverage producer, and a separate constant-time lightweight standard; logbook disabled",
  rows: [],
};

/** Count actual files and bytes without assuming eligible reclamation is an empty store. */
async function inventory(
  path: string,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    for await (const entry of Deno.readDir(path)) {
      const child = path + "/" + entry.name;
      if (entry.isDirectory) {
        const nested = await inventory(child);
        files += nested.files;
        bytes += nested.bytes;
      } else if (entry.isFile) {
        files++;
        bytes += (await Deno.stat(child)).size;
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return { files, bytes };
}

/** Separate common evidence from checkout administration and the total Git footprint. */
async function storage(
  root: string,
): Promise<Record<string, { files: number; bytes: number }>> {
  return {
    common_discern: await inventory(root + "/.git/discern"),
    checkout_admin: await inventory(root + "/.git/worktrees"),
    all_git: await inventory(root + "/.git"),
  };
}

/** An authored CLI-shaped tree with local output that must survive composition. */
async function representativeContents(path: string): Promise<void> {
  for (const directory of ["src", "tests", "docs", "bin", "dist", ".cache"]) {
    await Deno.mkdir(path + "/" + directory, { recursive: true });
  }
  for (let index = 0; index < 24; index++) {
    await Deno.writeTextFile(
      path + "/src/module_" + index + ".ts",
      "export const value = " + index + ";\n",
    );
    await Deno.writeTextFile(
      path + "/tests/module_" + index + "_test.ts",
      "import { value } from '../src/module_" + index + ".ts';\n" +
        "Deno.test('module value', () => { if (value !== " + index +
        ") throw new Error('Unexpected value'); });\n",
    );
  }
  await Deno.writeTextFile(
    path + "/docs/README.md",
    "# Sample CLI\n\nRun the executable to inspect its source.\n",
  );
  await Deno.writeTextFile(path + "/bin/sample", "#!/bin/sh\ncat source\n");
  await Deno.chmod(path + "/bin/sample", 0o755);
  await Deno.symlink("../docs/README.md", path + "/src/README.md");
  await Deno.writeTextFile(
    path + "/.gitignore",
    (await Deno.readTextFile(path + "/.gitignore")) + "\ndist/\n.cache/\n",
  );
  await git(path, "add", ".gitignore", "src", "tests", "docs", "bin");
  await git(path, "commit", "-m", "Author the representative disposable CLI");
  await Deno.writeFile(
    path + "/dist/sample.bin",
    new Uint8Array(1_048_576).fill(53),
  );
  for (let index = 0; index < 128; index++) {
    await Deno.writeTextFile(
      path + "/.cache/entry_" + index,
      "cache".repeat(410),
    );
  }
}

/** Independently observe source attachment, modes, links, and ignored bytes across composition. */
async function representativeState(
  path: string,
): Promise<Record<string, unknown>> {
  const binary = await Deno.readFile(path + "/dist/sample.bin");
  return {
    source: await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}"),
    branch: await gitOut(path, "symbolic-ref", "HEAD"),
    status: await gitOut(
      path,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ),
    executable: ((await Deno.stat(path + "/bin/sample")).mode ?? 0) & 0o777,
    link: await Deno.readLink(path + "/src/README.md"),
    cached_files: await inventory(path + "/.cache"),
    binary_bytes: binary.byteLength,
    binary_digest: Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", binary)),
    )
      .map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

/** Count the physical producer outside the checkout so retirement cannot hide a repeat. */
function testProducer(counter: string): string {
  return "printf t >> executions; printf t >> " + quoteCommandWord(counter) +
    "; printf 'DISCERN_METRIC coverage 93\\n'";
}

/** Record one public invocation, its required work, and its storage growth without a timing assertion. */
async function measure(
  root: string,
  path: string,
  counters: { tests: string; light: string },
  label: string,
  args: [CliJsonResultCommand, ...string[]],
  expectedCode = 0,
): Promise<void> {
  const before = await storage(root);
  const beforeTests = (await readTextIfExists(counters.tests))?.length ?? 0;
  const beforeLight = (await readTextIfExists(counters.light))?.length ?? 0;
  const load = loadavg();
  const started = SYSTEM_CLOCK.monotonicNow();
  const result = await runAgent(path, [...args, "--json"]);
  const elapsedMs = SYSTEM_CLOCK.monotonicNow() - started;
  const after = await storage(root);
  let parsed: unknown;
  try {
    parsed = decodeCliResult(result.stdout, args[0]);
  } catch {
    parsed = { stdout: result.stdout, stderr: result.stderr };
  }
  report.rows.push({
    label,
    command: ["discern", ...args, "--json"],
    code: result.code,
    elapsed_ms: elapsedMs,
    load,
    storage_before: before,
    storage_after: after,
    tests_before: beforeTests,
    light_before: beforeLight,
    tests_after: (await readTextIfExists(counters.tests))?.length ?? 0,
    light_after: (await readTextIfExists(counters.light))?.length ?? 0,
    result: parsed,
  });
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (result.code !== expectedCode) {
    throw new Error(
      label + " returned " + result.code + "; inspect " + reportPath,
    );
  }
}

await withTempDir(async (aux) => {
  await withTempDir(async (root) => {
    const counters = {
      tests: aux + "/pristine-tests",
      light: aux + "/pristine-light",
    };
    const path = await project(
      root,
      ["local"],
      "",
      testProducer(counters.tests),
    );
    await measure(root, path, counters, "fresh ordinary completion", ["done"]);
    await measure(root, path, counters, "fresh ordinary acceptance", [
      "accept",
      "--confirmed",
    ]);
  });
  await withTempDir(async (root) => {
    const counters = {
      tests: aux + "/ordinary-tests",
      light: aux + "/ordinary-light",
    };
    const light = "printf l >> light-executions; printf l >> " +
      quoteCommandWord(counters.light) +
      "; printf 'DISCERN_METRIC lightweight 1\\n'";
    const path = await project(
      root,
      ["local"],
      [
        "[standards.lightweight]",
        "run = " + JSON.stringify(light),
        "direction = 'down'",
        "limit = 1",
      ].join("\n"),
      testProducer(counters.tests),
    );
    await Deno.writeTextFile(
      path + "/.gitignore",
      (await Deno.readTextFile(path + "/.gitignore")) + "\nlight-executions\n",
    );
    await git(path, "add", ".gitignore");
    await git(
      path,
      "commit",
      "-m",
      "Declare the lightweight measurement output",
    );
    await measure(
      root,
      path,
      counters,
      "named lightweight standard without prior evidence",
      ["standards", "lightweight"],
    );
    await measure(root, path, counters, "repeated named lightweight standard", [
      "standards",
      "lightweight",
    ]);
    await measure(
      root,
      path,
      counters,
      "retained completion after standalone measurements",
      [
        "done",
        "--retain-checkout",
      ],
    );
    await measure(root, path, counters, "valid retained Proof reuse", [
      "done",
      "--retain-checkout",
    ]);
    await measure(root, path, counters, "valid Proof release", [
      "done",
      "--release-checkout",
    ]);
    await measure(
      root,
      path,
      counters,
      "named lightweight standard after Proof",
      ["standards", "lightweight"],
    );
    await measure(
      root,
      path,
      counters,
      "reviewed acceptance after measurements and release",
      [
        "accept",
        "--confirmed",
      ],
    );
    await measure(root, root, counters, "acceptance replay from main", [
      "accept",
    ]);
  });
  await withTempDir(async (root) => {
    const counters = {
      tests: aux + "/checkpoint-tests",
      light: aux + "/checkpoint-light",
    };
    const path = await project(
      root,
      ["local"],
      "[checkpoints.review]\npaths = ['source']\nquestion = 'Does this source satisfy the requirement?'\n",
      testProducer(counters.tests),
    );
    await measure(root, path, counters, "source checkpoint stop", ["done"], 1);
    await measure(root, path, counters, "declared checkpoint completion", [
      "done",
      "--met",
      "review",
      "--retain-checkout",
    ]);
    await measure(root, path, counters, "checkpoint-bearing Proof reuse", [
      "done",
      "--retain-checkout",
    ]);
  });
  await withTempDir(async (root) => {
    const counters = {
      tests: aux + "/representative-tests",
      light: aux + "/representative-light",
    };
    const path = await project(
      root,
      ["local"],
      [
        "[execution.local]",
        "kind = 'borrowed'",
        "prepare = 'true'",
        "restore = 'true'",
        "reusable = true",
        "capacity = 1",
        "resources = []",
        "ignored = ['executions', '.cache', 'dist']",
        "inputs = ['**']",
      ].join("\n"),
      testProducer(counters.tests),
    );
    await representativeContents(path);
    const before = await representativeState(path);
    await Deno.writeTextFile(
      root + "/predecessor",
      "Independent trunk addition\n",
    );
    await git(root, "add", "predecessor");
    await git(root, "commit", "-m", "Advance the representative predecessor");
    await measure(
      root,
      path,
      counters,
      "representative temporary composition",
      ["done", "--retain-checkout"],
    );
    const after = await representativeState(path);
    report.rows.push({
      label: "representative source and local-output preservation",
      fixture:
        "24 authored modules, 24 corresponding test files, documentation, executable, relative symlink, 1 MiB ignored binary, 128 ignored cache entries; controlled producer only, no full project test workload",
      before,
      after,
      preserved: JSON.stringify(before) === JSON.stringify(after),
    });
    await Deno.writeTextFile(
      reportPath,
      JSON.stringify(report, null, 2) + "\n",
    );
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(
        "Representative source or local output changed; inspect " + reportPath,
      );
    }
  });
});
console.log(reportPath);
