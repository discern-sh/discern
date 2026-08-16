/**
 * The studio's guard runner: the same test files the meta-registry declares
 * for a registry, run one file per subprocess so the panel can show a verdict
 * per guard, plus the quick standards probes the canons feed.
 */

import { REPO_ROOT } from "./root.ts";

/** One guard file's verdict. */
export interface GuardResult {
  readonly file: string;
  readonly ok: boolean;
  /** The pass line, or the failure tail trimmed for the panel. */
  readonly summary: string;
}

/** One guard run over a registry's declared guard files. */
export interface GuardRunReport {
  readonly registry: string;
  readonly ok: boolean;
  readonly results: readonly GuardResult[];
}

/** The tail of a failing run, bounded for the panel. */
function failureTail(output: string): string {
  const text = output.trimEnd();
  return text.length <= 1200 ? text : `…${text.slice(-1200)}`;
}

/**
 * Run one guard test file; the registry's typecheck ran before the suite.
 * The capture environment keeps the output plain enough for the panel — the
 * same discipline the gate applies to its own jobs.
 */
async function runGuardFile(file: string): Promise<GuardResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--no-check",
      file,
    ],
    cwd: REPO_ROOT,
    env: { NO_COLOR: "1", CI: "1", TERM: "dumb" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const text = new TextDecoder().decode(output.stdout) +
    new TextDecoder().decode(output.stderr);
  if (output.success) {
    const passed = text.match(/ok \|.*$/m)?.[0] ?? "passed";
    return { file, ok: true, summary: passed.trim() };
  }
  return { file, ok: false, summary: failureTail(text) };
}

/** Run a registry's guard files sequentially and gather the verdicts. */
export async function runGuardFiles(
  registry: string,
  files: readonly string[],
): Promise<GuardRunReport> {
  const results: GuardResult[] = [];
  for (const file of files) {
    results.push(await runGuardFile(file));
  }
  return {
    registry,
    ok: results.every((result) => result.ok),
    results,
  };
}

/** The one-line metric a standards probe prints, parsed. */
export async function metricProbe(
  script: string,
  metric: string,
): Promise<number | undefined> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", script],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  });
  const output = await command.output();
  if (!output.success) return undefined;
  const text = new TextDecoder().decode(output.stdout);
  const line = text
    .split("\n")
    .findLast((candidate) => candidate.startsWith(`DISCERN_METRIC ${metric} `));
  const value = Number(line?.split(" ")[2]);
  return Number.isFinite(value) ? value : undefined;
}
