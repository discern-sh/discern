/**
 * **Crash reporting** — what discern does when it hits a bug in itself: an
 * unexpected throw no verb turned into a structured refusal.
 *
 * Expected failures (a red gate, a refused precondition, a bad config) travel
 * as `DiscernResult` envelopes with error slugs and diagnostics. A crash is the
 * other class: a defect in discern reaching the surface. This module gives that
 * class one shared treatment on every surface (ADR 0247):
 *
 *  - **capture** — {@link captureCrashReport} reduces the throw to a report:
 *    discern version, runtime, platform, verb, error, stack.
 *  - **artifact** — {@link writeCrashArtifact} saves the report under the git
 *    common dir (`discern/crash/`, beside the logbook — never inside the
 *    project tree), falling back to a temp file outside a repository. The
 *    newest {@link MAX_CRASH_FILES} reports are kept. Best-effort: it returns
 *    `undefined` rather than ever throwing from a crash path.
 *  - **frame** — {@link renderCrashFrame} is the human stderr block: version,
 *    verb, the error, where the report was saved, where to send it.
 *  - **envelope** — {@link internalErrorResult} is the uniform machine result
 *    (`error: "internal_error"`) the CLI's `--json` mode and the MCP server
 *    both emit, so an agent reads a crash as a structured result instead of
 *    a broken stream. It carries no `data`: typed per-verb payload schemas
 *    stay intact, and the report path travels in `message`.
 *  - **signature** — {@link crashSignature} is the logbook-safe reduction
 *    (error class name and one code location, never the message), within the
 *    logbook's metadata-only bar.
 *
 * The CLI exits {@link CRASH_EXIT_CODE} (sysexits `EX_SOFTWARE`) on a crash,
 * so scripts can tell "discern is broken" from an ordinary failed verb's
 * exit 1. {@link throwIfCrashProbe} is the deterministic fault injection the
 * end-to-end tests (and a curious user) trigger via `DISCERN_CRASH_PROBE`.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { ISSUES_URL, KIT_VERSION } from "../lib/version.ts";
import { gitAdminStatePath } from "../shared/git_admin_state.ts";
import type { DiscernResult } from "../shared/result.ts";
import { makeTempArtifact } from "../shared/temp_artifacts.ts";

/** The crash exit code: sysexits `EX_SOFTWARE` — an internal software error,
 * distinct from an ordinary failed verb's exit 1 and the re-raised signal
 * codes (129/130/143). */
export const CRASH_EXIT_CODE = 70;

/** Crash reports kept under `discern/crash/` — newest first, pruned on write. */
export const MAX_CRASH_FILES = 20;

/** The env var that makes the next invocation crash on purpose — the
 * deterministic probe the crash-path tests (and a user checking what a crash
 * report looks like) flip. Any non-empty value triggers it. */
export const CRASH_PROBE_ENV = "DISCERN_CRASH_PROBE";

/** Throw a synthetic crash when {@link CRASH_PROBE_ENV} is set. Called inside
 * each surface's recording chokepoint, so a probe crash exercises the whole
 * real path: logbook signature, artifact, frame, envelope, exit code. */
export function throwIfCrashProbe(): void {
  let probe: string | undefined;
  try {
    probe = Deno.env.get(CRASH_PROBE_ENV);
  } catch {
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
    return undefined;
  }
}

/** Convert an arbitrary thrown value to text without letting its coercion path
 * escape into the crash reporter. */
function thrownValueText(value: unknown): string {
  try {
    return String(value);
  } catch {
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
): CrashReport {
  const inspected = inspectThrow(err);
  const signature = inspectedSignature(inspected);
  return {
    at: new Date().toISOString(),
    verb: verb === undefined || verb === "" ? "discern" : verb,
    version: KIT_VERSION,
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
    "discern crash report",
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
 * the pid. A unique suffix prevents same-process, same-instant collisions
 * while keeping newest-first equivalent to a name sort. */
function crashFilePrefix(report: CrashReport): string {
  return `${report.at.replaceAll(":", "-")}-${Deno.pid}-`;
}

/** Create and fill one crash file without exposing a shared target path. */
async function createCrashFile(
  dir: string,
  report: CrashReport,
  body: string,
): Promise<string> {
  const path = await Deno.makeTempFile({
    dir,
    prefix: crashFilePrefix(report),
    suffix: ".txt",
  });
  try {
    await Deno.writeTextFile(path, body);
    return path;
  } catch (error) {
    try {
      await Deno.remove(path);
    } catch {
      // Best-effort cleanup while the outer crash path is already failing.
    }
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
): Promise<string | undefined> {
  const body = renderCrashArtifact(report);
  try {
    const dir = await gitAdminStatePath(cwd, "crash");
    if (dir !== undefined) {
      await ensureDir(dir);
      const path = await createCrashFile(dir, report, body);
      await pruneCrashDir(dir);
      return path;
    }
  } catch {
    // fall through to the temp-file fallback
  }
  try {
    // The registered temp-artifact family, so the reaper's coverage stays
    // total; its TTL only collects reports nobody came back for.
    const path = await makeTempArtifact("crash");
    await Deno.writeTextFile(path, body);
    return path;
  } catch {
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
 * The uniform machine result for a crash — the one envelope every surface
 * emits when a verb throws unexpectedly, so `--json` consumers and MCP
 * clients read a crash as a structured `internal_error` instead of a broken
 * stream. Carries no `data` (typed per-verb payload schemas stay intact);
 * the report path, when one was written, travels in the message.
 */
export function internalErrorResult(
  verb: string,
  report: CrashReport,
  artifactPath?: string | undefined,
): DiscernResult<never> {
  const saved = artifactPath !== undefined
    ? ` Crash report saved at ${artifactPath}.`
    : "";
  return {
    ok: false,
    verb,
    error: "internal_error",
    message:
      `discern ${report.version} crashed while running \`${report.verb}\`: ` +
      `${report.name}: ${report.message}${saved} ` +
      `This is a bug in discern — please report it at ${ISSUES_URL}.`,
  };
}
