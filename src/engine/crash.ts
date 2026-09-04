/**
 * **Crash reporting** — what discern does when it hits a bug in itself: an
 * unexpected throw no verb turned into a structured refusal.
 *
 * Expected failures (a red gate, a refused precondition, a bad config) travel
 * as `DiscernResult` envelopes with error slugs and diagnostics. A crash is the
 * other class: a defect in discern reaching the surface. This module gives that
 * class one shared treatment on every surface (ADR 0248):
 *
 *  - **capture** — {@link captureCrashReport} reduces the throw to a report:
 *    discern version, runtime, platform, verb, error, stack.
 *  - **artifact** — {@link writeCrashArtifact} tries to save the report under
 *    the git common dir (`discern/crash/`, beside the logbook — never inside
 *    the project tree), falling back to a temp file outside a repository. The
 *    newest {@link MAX_CRASH_FILES} repository reports are kept. Best-effort:
 *    it returns `undefined` rather than ever throwing from a crash path.
 *  - **frame** — {@link renderCrashFrame} is the terminal stderr block: version,
 *    verb, the error, where the report was saved, where to send it.
 *  - **envelope** — {@link internalErrorResult} is the uniform structured result
 *    (`error: "internal_error"`) CLI `--json`, CLI `--markdown`, and MCP all
 *    project, so a caller receives a complete result instead of a broken
 *    stream. Setup crashes carry the journey's runnable diagnostic action;
 *    other verbs carry no `data`. A written report's path travels in `message`.
 *  - **signature** — {@link crashSignature} is the logbook-safe reduction
 *    (error class name and one code location, never the message), within the
 *    logbook's metadata-only bar.
 *
 * The CLI exits {@link CRASH_EXIT_CODE} (sysexits `EX_SOFTWARE`) on a crash,
 * so scripts can tell "discern is broken" from an ordinary failed verb's
 * exit 1. {@link throwIfCrashProbe} is the deterministic fault injection the
 * end-to-end tests trigger via `DISCERN_CRASH_PROBE`.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { bestEffort, bestEffortSync } from "../shared/best_effort.ts";
import { DISCERN_VERSION, ISSUES_URL } from "../lib/version.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../shared/environment_variables.ts";
import { gitAdminStatePath } from "../shared/git_admin_state.ts";
import type { DiscernResult } from "../shared/result.ts";
import { makeTempArtifact } from "../shared/temp_artifacts.ts";
import { tempArtifactScopeFor } from "./temp_artifact_scope.ts";
import { wallTimeIso } from "../shared/clock.ts";
import { EXIT_INTERNAL_ERROR } from "../shared/exit_codes.ts";
import { ON_DISK_FORMATS } from "../shared/on_disk_formats.ts";
import {
  SETUP_CRASH_NEXT_ACTION,
  withSetupResultNextAction,
} from "../shared/setup_next_action.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../shared/entropy.ts";

/** The crash exit code: sysexits `EX_SOFTWARE` — an internal software error,
 * distinct from an ordinary failed verb's exit 1 and the re-raised signal
 * codes (129/130/143). */
export const CRASH_EXIT_CODE = EXIT_INTERNAL_ERROR;

/** Crash reports kept under `discern/crash/` — newest first, pruned on write. */
export const MAX_CRASH_FILES = 20;

/** The env var that makes each recorded invocation crash on purpose while set
 * — the deterministic probe the crash-path tests (and a user checking what a
 * crash report looks like) flip. Any non-empty value triggers it. */
export const CRASH_PROBE_ENV = DISCERN_ENVIRONMENT_VARIABLES.crashProbe;

/** Throw a synthetic crash when {@link CRASH_PROBE_ENV} is set. Called inside
 * each surface's recording chokepoint, so a probe crash exercises the whole
 * real path: logbook signature, artifact, frame, envelope, exit code. */
export function throwIfCrashProbe(
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): void {
  let probe: string | undefined;
  try {
    probe = env.get(CRASH_PROBE_ENV);
  } catch {
    // discern-best-effort: crash-probe-env-fallback
    return; // no env permission — nothing to probe
  }
  if (probe !== undefined && probe !== "") {
    throw new Error(
      `Synthetic crash requested by the ${CRASH_PROBE_ENV} environment variable. Unset it to stop.`,
    );
  }
}

/** The logbook-safe reduction of a crash: the error's class name and one code
 * location. No message — messages can carry paths and values, and the logbook
 * records only metadata safe to read aloud. A type alias (not an interface) so
 * it assigns into the logbook's loose event schemas. */
export type CrashSignature = {
  /** The error's constructor name ("TypeError"), or "throw" for a non-Error. */
  name: string;
  /** The topmost stack location, trimmed to a source-relative form
   * ("src/engine/dispatch.ts:12:3"), when a stack was available. */
  frame?: string | undefined;
};

/** Fallback text when even inspecting a thrown value triggers another error. */
const UNINSPECTABLE_THROWN_VALUE = "The thrown value could not be inspected.";

interface InspectedThrow {
  name: string;
  message: string;
  stack?: string | undefined;
}

/** Whether an unknown value is an Error without trusting a proxy's prototype
 * trap. A revoked or hostile proxy can make `instanceof` throw. */
function isInspectableError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    // discern-best-effort: crash-error-instanceof-fallback
    return false;
  }
}

/** Read one Error field without trusting an overridden getter or proxy trap. */
function errorField(
  error: Error,
  field: "name" | "message" | "stack",
): unknown {
  try {
    return Reflect.get(error, field);
  } catch {
    // discern-best-effort: crash-error-field-fallback
    return undefined;
  }
}

/** Convert an arbitrary thrown value to text without letting its coercion path
 * escape into the crash reporter. */
function thrownValueText(value: unknown): string {
  try {
    return String(value);
  } catch {
    // discern-best-effort: crash-thrown-value-text-fallback
    return UNINSPECTABLE_THROWN_VALUE;
  }
}

/** Inspect an unknown throw once. Every operation that can invoke user-defined
 * behavior is guarded, so this boundary always returns plain strings. */
function inspectThrow(value: unknown): InspectedThrow {
  if (!isInspectableError(value)) {
    return { name: "throw", message: thrownValueText(value) };
  }
  const rawName = errorField(value, "name");
  const rawMessage = errorField(value, "message");
  const rawStack = errorField(value, "stack");
  return {
    name: typeof rawName === "string" && rawName !== "" ? rawName : "Error",
    message: typeof rawMessage === "string"
      ? rawMessage
      : UNINSPECTABLE_THROWN_VALUE,
    ...(typeof rawStack === "string" ? { stack: rawStack } : {}),
  };
}

/** The source trees a discern stack frame can point into — the repo's authored
 * roots. A frame is trimmed to start at the last of these, so the same frame
 * reads identically from a dev run (absolute paths) and the compiled binary
 * (virtualized paths). */
const SOURCE_TREE_MARKERS = ["src", "tests", "scripts", "site", "types"];

/** Trim one raw stack location to its source-relative form: strip the URL
 * scheme, then keep from the last known source-tree segment; fall back to the
 * last two path segments when none is present. */
function trimFrameLocation(location: string): string {
  const bare = location.replace(/^file:\/\//, "");
  const segments = bare.split("/");
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment !== undefined && SOURCE_TREE_MARKERS.includes(segment)) {
      return segments.slice(i).join("/");
    }
  }
  return segments.slice(-2).join("/");
}

/** The first `at …` line of a stack, reduced to its trimmed location, or
 * undefined when the stack carries none. */
function topFrame(stack: string | undefined): string | undefined {
  if (stack === undefined) {
    return undefined;
  }
  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) {
      continue;
    }
    const parenthesized = /\(([^()]+)\)\s*$/.exec(trimmed);
    const location = parenthesized?.[1] ?? trimmed.slice("at ".length);
    return trimFrameLocation(location.trim());
  }
  return undefined;
}

/** Reduce inspected crash fields to their logbook-safe signature. */
function inspectedSignature(inspected: InspectedThrow): CrashSignature {
  const frame = topFrame(inspected.stack);
  return {
    name: inspected.name,
    ...(frame !== undefined ? { frame } : {}),
  };
}

/** Reduce a thrown value to its logbook-safe {@link CrashSignature}. */
export function crashSignature(err: unknown): CrashSignature {
  return inspectedSignature(inspectThrow(err));
}

/** Everything a crash report carries — enough to reproduce the "what did the
 * user's machine see" question a bug report needs. */
export interface CrashReport {
  /** ISO timestamp of the crash. */
  at: string;
  /** The verb that was running, or "discern" before verb resolution. */
  verb: string;
  /** The discern version, from the binary itself. */
  version: string;
  /** The Deno runtime version the binary embeds. */
  deno: string;
  /** `<os>-<arch>`, e.g. "darwin-aarch64". */
  platform: string;
  /** The error's class name ("TypeError"), or "throw" for a non-Error. */
  name: string;
  /** The error's message (or the thrown value, stringified). */
  message: string;
  /** The full stack, when the throw carried one. */
  stack?: string | undefined;
  signature: CrashSignature;
}

/** Capture a {@link CrashReport} from a thrown value. Pure — no I/O. */
export function captureCrashReport(
  verb: string | undefined,
  err: unknown,
  nowMs: number,
): CrashReport {
  const inspected = inspectThrow(err);
  const signature = inspectedSignature(inspected);
  return {
    at: wallTimeIso(nowMs),
    verb: verb === undefined || verb === "" ? "discern" : verb,
    version: DISCERN_VERSION,
    deno: Deno.version.deno,
    platform: `${Deno.build.os}-${Deno.build.arch}`,
    name: signature.name,
    message: inspected.message,
    ...(inspected.stack !== undefined ? { stack: inspected.stack } : {}),
    signature,
  };
}

/** The error block shared by the frame and the artifact: the stack when there
 * is one (it opens with "Name: message"), else the one-line error. */
function errorBlock(report: CrashReport): string {
  return report.stack ?? `${report.name}: ${report.message}`;
}

/** Render the artifact body — the plain-text file a bug report attaches. */
export function renderCrashArtifact(report: CrashReport): string {
  return [
    `discern crash report format ${ON_DISK_FORMATS.crashReport.version}`,
    `version: ${report.version} (deno ${report.deno}; ${report.platform})`,
    `at: ${report.at}`,
    `verb: ${report.verb}`,
    "",
    errorBlock(report),
    "",
    `Report this at ${ISSUES_URL}.`,
    "",
  ].join("\n");
}

/** A crash file's prefix: the sortable ISO timestamp (filesystem-safe) plus
 * the pid. A random suffix prevents same-process, same-instant collisions
 * while keeping newest-first equivalent to a name sort. */
function crashFilePrefix(report: CrashReport): string {
  return `${report.at.replaceAll(":", "-")}-${Deno.pid}-`;
}

/** Create and fill one crash file without exposing a shared target path. */
async function createCrashFile(
  dir: string,
  report: CrashReport,
  body: string,
  entropy: SecureEntropy,
): Promise<string> {
  const path = join(
    dir,
    `${crashFilePrefix(report)}${entropy.uuid()}.txt`,
  );
  const file = await Deno.open(path, {
    createNew: true,
    write: true,
    mode: 0o600,
  });
  try {
    const bytes = new TextEncoder().encode(body);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset));
      if (written === 0) {
        throw new Error("short write while saving a crash report");
      }
      offset += written;
    }
    file.close();
    return path;
  } catch (error) {
    bestEffortSync("crash-write-error-close", () => {
      file.close();
    });
    await bestEffort("crash-write-error-remove", async () => {
      await Deno.remove(path);
    });
    throw error;
  }
}

/** Prune the crash directory to the newest {@link MAX_CRASH_FILES} reports.
 * Names sort chronologically, so a name sort is an age sort. */
async function pruneCrashDir(dir: string): Promise<void> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".txt")) {
      names.push(entry.name);
    }
  }
  const excess = names.sort().reverse().slice(MAX_CRASH_FILES);
  for (const name of excess) {
    await Deno.remove(join(dir, name));
  }
}

/**
 * Save a crash report: under the repository's git common dir when there is
 * one (`discern/crash/`, beside the logbook — never inside the project tree,
 * so it can never land in a commit), else a temp file. Returns the written
 * path, or undefined when nothing could be written. Never throws — this runs
 * while discern is already failing, and a reporting failure must not mask
 * the crash itself.
 */
export async function writeCrashArtifact(
  cwd: string,
  report: CrashReport,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<string | undefined> {
  const body = renderCrashArtifact(report);
  try {
    const dir = await gitAdminStatePath(cwd, "crash");
    if (dir !== undefined) {
      await ensureDir(dir);
      const path = await createCrashFile(dir, report, body, entropy);
      await pruneCrashDir(dir);
      return path;
    }
  } catch {
    // discern-best-effort: crash-git-artifact-fallback
  }
  try {
    // The registered temp-artifact family, so the reaper's coverage stays
    // total; its TTL only collects reports nobody came back for.
    const path = await makeTempArtifact(
      "crash",
      await tempArtifactScopeFor(cwd),
    );
    await Deno.writeTextFile(path, body);
    return path;
  } catch {
    // discern-best-effort: crash-temp-artifact-unavailable
    return undefined;
  }
}

/** Render the human crash frame — the stderr block a crashing invocation
 * leaves behind: what crashed, the full error, where the report is saved,
 * and where to send it. */
export function renderCrashFrame(
  report: CrashReport,
  artifactPath: string | undefined,
): string {
  const indented = errorBlock(report)
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");
  const delivery = artifactPath !== undefined
    ? `This is a bug in discern. The full report is saved at:\n` +
      `  ${artifactPath}\n` +
      `Please attach that file to a new issue at ${ISSUES_URL}.`
    : `This is a bug in discern. We couldn't save a crash report file, so ` +
      `please copy the text above into a new issue at ${ISSUES_URL}.`;
  return [
    `discern ${report.version} crashed while running \`${report.verb}\`.`,
    "",
    indented,
    "",
    delivery,
  ].join("\n");
}

/**
 * The uniform structured result for a crash — the one envelope every surface
 * emits when a verb throws unexpectedly, so `--json` consumers and MCP
 * clients read a crash as a structured `internal_error` instead of a broken
 * stream. Setup results retain their required runnable recovery command;
 * other verbs carry no `data`. The report path, when one was written, travels
 * in the message.
 */
export function internalErrorResult(
  verb: string,
  report: CrashReport,
  artifactPath?: string | undefined,
): DiscernResult {
  const saved = artifactPath !== undefined
    ? ` Crash report saved at ${artifactPath}.`
    : "";
  return withSetupResultNextAction({
    ok: false,
    verb,
    error: "internal_error",
    message:
      `discern ${report.version} crashed while running \`${report.verb}\`: ` +
      `${report.name}: ${report.message}${saved} ` +
      `This is a bug in discern. Report it at ${ISSUES_URL}.`,
  }, SETUP_CRASH_NEXT_ACTION);
}
