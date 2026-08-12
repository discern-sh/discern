/**
 * Bounded, privacy-preserving capture of the repository state a validation
 * boundary presents to configured jobs.
 *
 * Every manifest is canonical and exists only in memory. The Logbook receives
 * repository-keyed HMACs, aggregate counts/bytes, and explicit incompleteness —
 * never paths, contents, commands, config values, or reusable plain hashes.
 */

import { dirname, isAbsolute, resolve } from "@std/path";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  canonicalJson,
  setupIdentityInput,
  VALIDATION_EVIDENCE_VERSION,
  VALIDATION_EXCLUSIONS,
  VALIDATION_WRITER,
  type ValidationIncomplete,
  type ValidationJobGroup,
  validationJobs,
  type ValidationRun,
  type ValidationStart,
  type ValidationState,
} from "./validation.ts";

/** Benchmarked against the repository fixture and held as explicit hard caps. */
export const VALIDATION_CAPTURE_LIMITS = {
  paths: 20_000,
  bytes: 64 * 1024 * 1024,
  timeMs: 5_000,
} as const;

interface CaptureLimits {
  readonly paths: number;
  readonly bytes: number;
  readonly timeMs: number;
}

/** Test seams for forcing every fail-open path without relying on host modes. */
export interface ValidationCaptureOptions {
  readonly limits?: Partial<CaptureLimits> | undefined;
  readonly now?: (() => number) | undefined;
  readonly readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
}

interface CaptureRuntime {
  readonly limits: CaptureLimits;
  readonly now: () => number;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly started: number;
  paths: number;
  bytes: number;
  timedOut: boolean;
  byteLimited: boolean;
}

interface IndexEntry {
  readonly mode: string;
  readonly object: string;
  readonly stage: string;
  readonly path?: string | undefined;
  readonly pathBytes: Uint8Array;
}

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

/** One unambiguous length-prefixed field in a canonical manifest. */
function frame(name: string, bytes: Uint8Array): Uint8Array {
  const nameBytes = encoder.encode(name);
  const out = new Uint8Array(8 + nameBytes.length + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, nameBytes.length);
  out.set(nameBytes, 4);
  view.setUint32(4 + nameBytes.length, bytes.length);
  out.set(bytes, 8 + nameBytes.length);
  return out;
}

/** Join bounded manifest chunks for WebCrypto's one-shot HMAC API. */
function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** Lowercase hexadecimal encoding used for every opaque digest. */
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** Repository-keyed opaque digest with domain separation. */
async function hmac(
  keyBytes: Uint8Array,
  domain: string,
  chunks: readonly Uint8Array[],
): Promise<string> {
  const keyMaterial = Uint8Array.from(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const material = joinBytes([
    frame("domain", encoder.encode(domain)),
    ...chunks,
  ]);
  return hex(await crypto.subtle.sign("HMAC", key, Uint8Array.from(material)));
}

/** Merge optional test limits over the production capture limits. */
function limits(options: ValidationCaptureOptions): CaptureLimits {
  return {
    paths: options.limits?.paths ?? VALIDATION_CAPTURE_LIMITS.paths,
    bytes: options.limits?.bytes ?? VALIDATION_CAPTURE_LIMITS.bytes,
    timeMs: options.limits?.timeMs ?? VALIDATION_CAPTURE_LIMITS.timeMs,
  };
}

/** Build one capture's shared budget accounting. */
function runtime(options: ValidationCaptureOptions): CaptureRuntime {
  const now = options.now ?? (() => performance.now());
  return {
    limits: limits(options),
    now,
    readFile: options.readFile ?? Deno.readFile,
    started: now(),
    paths: 0,
    bytes: 0,
    timedOut: false,
    byteLimited: false,
  };
}

/** Rounded nonnegative elapsed milliseconds. */
function elapsed(rt: CaptureRuntime): number {
  return Math.max(0, Math.round(rt.now() - rt.started));
}

/** Check the wall-clock cap before and after every effectful probe. */
function withinTime(rt: CaptureRuntime): boolean {
  if (rt.now() - rt.started <= rt.limits.timeMs) {
    return true;
  }
  rt.timedOut = true;
  return false;
}

/** Charge one manifest path against the hard cap. */
function budgetPath(rt: CaptureRuntime): boolean {
  rt.paths += 1;
  return rt.paths <= rt.limits.paths;
}

/** Charge content or index bytes without crossing the hard cap. */
function budgetBytes(rt: CaptureRuntime, count: number): boolean {
  if (count < 0 || rt.bytes + count > rt.limits.bytes) {
    rt.byteLimited = true;
    return false;
  }
  rt.bytes += count;
  return true;
}

/** Add one categorical failure once, without storing sensitive detail. */
function addIncomplete(
  entries: ValidationIncomplete[],
  entry: ValidationIncomplete,
): void {
  if (
    !entries.some((existing) =>
      existing.category === entry.category && existing.reason === entry.reason
    )
  ) {
    entries.push(entry);
  }
}

/** Resolve or lazily mint the common repository HMAC key. */
async function validationKey(root: string): Promise<
  | { key: Uint8Array }
  | { incomplete: ValidationIncomplete }
> {
  const path = await gitAdminStatePath(root, "validationHmacKey");
  if (path === undefined) {
    return { incomplete: { category: "key", reason: "unavailable" } };
  }
  try {
    const existing = await Deno.readFile(path);
    return existing.length === 32
      ? { key: existing }
      : { incomplete: { category: "key", reason: "invalid" } };
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      return { incomplete: { category: "key", reason: "unreadable" } };
    }
  }
  try {
    await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const created = crypto.getRandomValues(new Uint8Array(32));
    const file = await Deno.open(path, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
    try {
      let offset = 0;
      while (offset < created.length) {
        offset += await file.write(created.subarray(offset));
      }
    } finally {
      file.close();
    }
    return { key: created };
  } catch (error) {
    // A concurrent validation may have won the createNew race.
    if (error instanceof Deno.errors.AlreadyExists) {
      try {
        const raced = await Deno.readFile(path);
        return raced.length === 32
          ? { key: raced }
          : { incomplete: { category: "key", reason: "invalid" } };
      } catch {
        // Fall through to the fail-open evidence below.
      }
    }
    return { incomplete: { category: "key", reason: "unreadable" } };
  }
}

/** Run one Git probe while accounting for the capture deadline. */
async function captureGit(
  root: string,
  args: string[],
  rt: CaptureRuntime,
): Promise<Awaited<ReturnType<typeof runGit>> | undefined> {
  if (!withinTime(rt)) return undefined;
  const remaining = Math.max(
    1,
    Math.floor(rt.limits.timeMs - (rt.now() - rt.started)),
  );
  const result = await runGit(args, { cwd: root, timeoutMs: remaining });
  if (result.timedOut === true) rt.timedOut = true;
  return withinTime(rt) && !rt.timedOut ? result : undefined;
}

/** Resolve one Git-returned repository-relative path without permitting escape. */
function safeProjectPath(root: string, path: string): string | undefined {
  if (isAbsolute(path) || path.split("/").includes("..")) return undefined;
  const absolute = resolve(root, path);
  const rootPrefix = `${resolve(root)}/`;
  return absolute.startsWith(rootPrefix) ? absolute : undefined;
}

/** Split exact Git `-z` bytes while removing only their terminal empty field. */
function nulByteFields(raw: Uint8Array): Uint8Array[] {
  const fields: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== 0) continue;
    fields.push(raw.slice(start, index));
    start = index + 1;
  }
  if (start < raw.length) fields.push(raw.slice(start));
  if (fields.at(-1)?.length === 0) fields.pop();
  return fields;
}

/** Parse `ls-files --stage -z` into its semantic fields. */
function parseIndex(raw: Uint8Array): IndexEntry[] | undefined {
  const entries: IndexEntry[] = [];
  for (const record of nulByteFields(raw)) {
    const tab = record.indexOf(9);
    if (tab < 0) return undefined;
    let header: string;
    try {
      header = strictDecoder.decode(record.slice(0, tab));
    } catch {
      return undefined;
    }
    const match = /^(\d{6}) ([0-9a-fA-F]+) ([0-3])$/.exec(header);
    if (match === null) return undefined;
    const mode = match[1];
    const object = match[2];
    const stage = match[3];
    const pathBytes = record.slice(tab + 1);
    let path: string | undefined;
    try {
      path = strictDecoder.decode(pathBytes);
    } catch {
      // The semantic index remains hashable byte-for-byte. Filesystem coverage
      // will fail closed if this entry later needs a JS-addressable path.
    }
    if (mode === undefined || object === undefined || stage === undefined) {
      return undefined;
    }
    entries.push({
      mode,
      object: object.toLowerCase(),
      stage,
      ...(path !== undefined ? { path } : {}),
      pathBytes,
    });
  }
  return entries;
}

/** Decode Git path fields only when the host filesystem API can address them. */
function decodedPathFields(
  stdout: string,
  stdoutBytes: Uint8Array | undefined,
): Array<{ path: string; pathBytes: Uint8Array }> | undefined {
  const fields = nulByteFields(stdoutBytes ?? encoder.encode(stdout));
  const paths: Array<{ path: string; pathBytes: Uint8Array }> = [];
  for (const pathBytes of fields) {
    try {
      paths.push({ path: strictDecoder.decode(pathBytes), pathBytes });
    } catch {
      return undefined;
    }
  }
  return paths;
}

/** Canonicalize the semantic index, excluding stat-cache and extension bytes. */
async function indexManifest(
  root: string,
  key: Uint8Array,
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<{
  digest?: string;
  bytes: number;
  entries: IndexEntry[];
}> {
  const run = await captureGit(root, ["ls-files", "--stage", "-z"], rt);
  if (run === undefined) {
    addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
    return { bytes: 0, entries: [] };
  }
  if (!run.success) {
    addIncomplete(incomplete, { category: "index", reason: "unavailable" });
    return { bytes: 0, entries: [] };
  }
  const rawBytes = run.stdoutBytes ?? encoder.encode(run.stdout);
  if (!budgetBytes(rt, rawBytes.length)) {
    addIncomplete(incomplete, { category: "budget", reason: "byte-limit" });
    return { bytes: rawBytes.length, entries: [] };
  }
  const entries = parseIndex(rawBytes);
  if (entries === undefined) {
    addIncomplete(incomplete, { category: "index", reason: "invalid" });
    return { bytes: rawBytes.length, entries: [] };
  }
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    if (!budgetPath(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "path-limit" });
      return { bytes: rawBytes.length, entries };
    }
    chunks.push(
      frame("mode", encoder.encode(entry.mode)),
      frame("object", encoder.encode(entry.object)),
      frame("stage", encoder.encode(entry.stage)),
      frame("path", entry.pathBytes),
    );
  }
  return {
    digest: await hmac(key, "validation-index-v1", chunks),
    bytes: rawBytes.length,
    entries,
  };
}

interface FileManifestResult {
  readonly digest?: string;
  readonly paths: number;
  readonly contentBytes: number;
}

/** Add one tracked/untracked filesystem state to an in-memory manifest. */
async function addFilesystemEntry(
  root: string,
  path: string,
  pathBytes: Uint8Array,
  chunks: Uint8Array[],
  rt: CaptureRuntime,
): Promise<{ ok: boolean; contentBytes: number }> {
  const absolute = safeProjectPath(root, path);
  if (absolute === undefined) return { ok: false, contentBytes: 0 };
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(absolute);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      chunks.push(
        frame("path", pathBytes),
        frame("type", encoder.encode("deleted")),
      );
      return { ok: true, contentBytes: 0 };
    }
    return { ok: false, contentBytes: 0 };
  }
  chunks.push(frame("path", pathBytes));
  if (info.isSymlink) {
    try {
      const target = encoder.encode(await Deno.readLink(absolute));
      if (!budgetBytes(rt, target.length)) {
        return { ok: false, contentBytes: 0 };
      }
      chunks.push(
        frame("type", encoder.encode("symlink")),
        frame("content", target),
      );
      return { ok: true, contentBytes: target.length };
    } catch {
      return { ok: false, contentBytes: 0 };
    }
  }
  if (info.isDirectory) {
    chunks.push(frame("type", encoder.encode("directory")));
    return { ok: true, contentBytes: 0 };
  }
  if (!info.isFile) return { ok: false, contentBytes: 0 };
  if (info.size > rt.limits.bytes - rt.bytes) {
    rt.byteLimited = true;
    return { ok: false, contentBytes: 0 };
  }
  try {
    const contents = await rt.readFile(absolute);
    if (!withinTime(rt)) return { ok: false, contentBytes: 0 };
    if (!budgetBytes(rt, contents.length)) {
      return { ok: false, contentBytes: 0 };
    }
    const executable = ((info.mode ?? 0) & 0o111) === 0 ? "0" : "1";
    chunks.push(
      frame("type", encoder.encode("file")),
      frame("executable", encoder.encode(executable)),
      frame("content", contents),
    );
    return { ok: true, contentBytes: contents.length };
  } catch {
    return { ok: false, contentBytes: 0 };
  }
}

/** HMAC the worktree states that differ from the exact index. */
async function changedTrackedManifest(
  root: string,
  key: Uint8Array,
  gitlinks: ReadonlySet<string>,
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<FileManifestResult> {
  const run = await captureGit(root, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "--",
  ], rt);
  if (run === undefined) {
    addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
    return { paths: 0, contentBytes: 0 };
  }
  if (!run.success) {
    addIncomplete(incomplete, { category: "tracked", reason: "unavailable" });
    return { paths: 0, contentBytes: 0 };
  }
  const decoded = decodedPathFields(run.stdout, run.stdoutBytes);
  if (decoded === undefined) {
    addIncomplete(incomplete, { category: "tracked", reason: "invalid" });
    return { paths: 0, contentBytes: 0 };
  }
  const paths = decoded.filter(({ path }) => !gitlinks.has(path));
  const chunks: Uint8Array[] = [];
  let contentBytes = 0;
  for (const { path, pathBytes } of paths) {
    if (!withinTime(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
      return { paths: paths.length, contentBytes };
    }
    if (!budgetPath(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "path-limit" });
      return { paths: paths.length, contentBytes };
    }
    const entry = await addFilesystemEntry(
      root,
      path,
      pathBytes,
      chunks,
      rt,
    );
    if (!entry.ok) {
      addIncomplete(
        incomplete,
        rt.timedOut
          ? { category: "budget", reason: "time-limit" }
          : rt.byteLimited
          ? { category: "budget", reason: "byte-limit" }
          : { category: "tracked", reason: "unreadable" },
      );
      return { paths: paths.length, contentBytes };
    }
    contentBytes += entry.contentBytes;
  }
  return {
    digest: await hmac(key, "validation-tracked-v1", chunks),
    paths: paths.length,
    contentBytes,
  };
}

/** HMAC every nonignored untracked path and its filesystem state. */
async function untrackedManifest(
  root: string,
  key: Uint8Array,
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<FileManifestResult> {
  const run = await captureGit(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    rt,
  );
  if (run === undefined) {
    addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
    return { paths: 0, contentBytes: 0 };
  }
  if (!run.success) {
    addIncomplete(incomplete, { category: "untracked", reason: "unavailable" });
    return { paths: 0, contentBytes: 0 };
  }
  const paths = decodedPathFields(run.stdout, run.stdoutBytes);
  if (paths === undefined) {
    addIncomplete(incomplete, { category: "untracked", reason: "invalid" });
    return { paths: 0, contentBytes: 0 };
  }
  const chunks: Uint8Array[] = [];
  let contentBytes = 0;
  for (const { path, pathBytes } of paths) {
    if (!withinTime(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
      return { paths: paths.length, contentBytes };
    }
    if (!budgetPath(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "path-limit" });
      return { paths: paths.length, contentBytes };
    }
    const entry = await addFilesystemEntry(
      root,
      path,
      pathBytes,
      chunks,
      rt,
    );
    if (!entry.ok) {
      addIncomplete(
        incomplete,
        rt.timedOut
          ? { category: "budget", reason: "time-limit" }
          : rt.byteLimited
          ? { category: "budget", reason: "byte-limit" }
          : { category: "untracked", reason: "unreadable" },
      );
      return { paths: paths.length, contentBytes };
    }
    contentBytes += entry.contentBytes;
  }
  return {
    digest: await hmac(key, "validation-untracked-v1", chunks),
    paths: paths.length,
    contentBytes,
  };
}

/** HMAC clean submodule commits; any dirty submodule makes evidence incomplete. */
async function submoduleManifest(
  root: string,
  key: Uint8Array,
  entries: readonly IndexEntry[],
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<{ digest?: string; count: number }> {
  const gitlinks = entries.filter((entry) =>
    entry.mode === "160000" && entry.stage === "0"
  );
  const chunks: Uint8Array[] = [];
  for (const entry of gitlinks) {
    if (!withinTime(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
      return { count: gitlinks.length };
    }
    if (entry.path === undefined) {
      addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
      return { count: gitlinks.length };
    }
    const cwd = safeProjectPath(root, entry.path);
    if (cwd === undefined) {
      addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
      return { count: gitlinks.length };
    }
    const head = await captureGit(cwd, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ], rt);
    const status = await captureGit(cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=none",
    ], rt);
    if (head === undefined || status === undefined) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
      return { count: gitlinks.length };
    }
    if (!head.success || !status.success) {
      addIncomplete(incomplete, {
        category: "submodules",
        reason: "unavailable",
      });
      return { count: gitlinks.length };
    }
    if (status.stdout !== "") {
      addIncomplete(incomplete, { category: "submodules", reason: "dirty" });
      return { count: gitlinks.length };
    }
    chunks.push(
      frame("path", entry.pathBytes),
      frame("head", encoder.encode(head.stdout.trim())),
    );
  }
  return {
    digest: await hmac(key, "validation-submodules-v1", chunks),
    count: gitlinks.length,
  };
}

/** HMAC config, setup, and job definitions for one execution boundary. */
async function executionEnvelope(
  key: Uint8Array | undefined,
  cfg: DiscernConfig,
  run: ValidationRun,
  groups: readonly ValidationJobGroup[],
  keyFailure?: ValidationIncomplete,
): Promise<ValidationStart["execution"]> {
  const incomplete = keyFailure === undefined ? [] : [keyFailure];
  const jobs = validationJobs(run, groups);
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    complete: key !== undefined,
    mode: run.mode,
    writer: VALIDATION_WRITER,
    ...(key !== undefined
      ? {
        config_digest: await hmac(key, "validation-config-v1", [
          frame("config", encoder.encode(canonicalJson(cfg))),
        ]),
        setup_digest: await hmac(key, "validation-setup-v1", [
          frame("setup", encoder.encode(setupIdentityInput(cfg))),
        ]),
      }
      : {}),
    jobs: await Promise.all(jobs.map(async ({ job, concurrentSiblings }) => ({
      id: job.label,
      stage: job.reportStage,
      kind: job.kind,
      ...(key !== undefined
        ? {
          definition_digest: await hmac(key, "validation-job-v1", [
            frame(
              "job",
              encoder.encode(canonicalJson({
                label: job.label,
                command: job.command,
                kind: job.kind,
                stage: job.reportStage,
                willRun: job.willRun,
                timeoutS: job.timeoutS ?? null,
              })),
            ),
          ]),
        }
        : {}),
      concurrent_siblings: concurrentSiblings,
    }))),
    ...(incomplete.length > 0 ? { incomplete } : {}),
  };
}

/** The common non-comparable state shape for a capture that could not run. */
function incompleteState(
  run: ValidationRun,
  incomplete: ValidationIncomplete[],
  elapsedMs: number,
): ValidationState {
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    complete: false,
    capture: run.capture,
    elapsed_ms: elapsedMs,
    components: {},
    counts: {
      index_entries: 0,
      tracked_paths: 0,
      untracked_paths: 0,
      submodules: 0,
    },
    bytes: {
      index_manifest: 0,
      tracked_content: 0,
      untracked_content: 0,
    },
    incomplete,
    exclusions: [...VALIDATION_EXCLUSIONS],
  };
}

/** Evidence for a validation event whose job boundary was never reached. */
export async function validationBoundaryNotReached(
  root: string,
  cfg: DiscernConfig,
  run: ValidationRun,
  groups: readonly ValidationJobGroup[],
): Promise<ValidationStart> {
  const keyResult = await validationKey(root);
  const key = "key" in keyResult ? keyResult.key : undefined;
  const keyFailure = "incomplete" in keyResult
    ? keyResult.incomplete
    : undefined;
  const incomplete: ValidationIncomplete[] = [
    { category: "boundary", reason: "not-reached" },
  ];
  if (keyFailure !== undefined) incomplete.push(keyFailure);
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    state: incompleteState(run, incomplete, 0),
    execution: await executionEnvelope(
      key,
      cfg,
      run,
      groups,
      keyFailure,
    ),
  };
}

/**
 * Capture the exact validation-start state. Every failure is returned as
 * incomplete evidence; this function intentionally never throws to its gate
 * callers.
 */
export async function captureValidationStart(
  root: string,
  cfg: DiscernConfig,
  run: ValidationRun,
  groups: readonly ValidationJobGroup[],
  options: ValidationCaptureOptions = {},
): Promise<ValidationStart> {
  const rt = runtime(options);
  try {
    const keyResult = await validationKey(root);
    if (!("key" in keyResult)) {
      return {
        version: VALIDATION_EVIDENCE_VERSION,
        state: incompleteState(run, [keyResult.incomplete], elapsed(rt)),
        execution: await executionEnvelope(
          undefined,
          cfg,
          run,
          groups,
          keyResult.incomplete,
        ),
      };
    }
    const key = keyResult.key;
    const incomplete: ValidationIncomplete[] = [];
    const components: {
      head?: string;
      index?: string;
      tracked?: string;
      untracked?: string;
      submodules?: string;
    } = {};

    const head = await captureGit(root, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ], rt);
    if (head === undefined) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
    } else if (!head.success || head.stdout.trim() === "") {
      addIncomplete(incomplete, { category: "head", reason: "unavailable" });
    } else {
      components.head = await hmac(key, "validation-head-v1", [
        frame("head", encoder.encode(head.stdout.trim())),
      ]);
    }

    const index = await indexManifest(root, key, rt, incomplete);
    if (index.digest !== undefined) components.index = index.digest;
    const gitlinks = new Set(
      index.entries.filter((entry) => entry.mode === "160000")
        .flatMap((entry) => entry.path === undefined ? [] : [entry.path]),
    );
    const tracked = await changedTrackedManifest(
      root,
      key,
      gitlinks,
      rt,
      incomplete,
    );
    if (tracked.digest !== undefined) components.tracked = tracked.digest;
    const untracked = await untrackedManifest(root, key, rt, incomplete);
    if (untracked.digest !== undefined) components.untracked = untracked.digest;
    const submodules = await submoduleManifest(
      root,
      key,
      index.entries,
      rt,
      incomplete,
    );
    if (submodules.digest !== undefined) {
      components.submodules = submodules.digest;
    }

    if (!withinTime(rt) || rt.timedOut) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
    }
    const complete = incomplete.length === 0 &&
      components.head !== undefined && components.index !== undefined &&
      components.tracked !== undefined && components.untracked !== undefined &&
      components.submodules !== undefined;
    const digest = complete
      ? await hmac(key, "validation-state-v1", [
        frame("head", encoder.encode(components.head ?? "")),
        frame("index", encoder.encode(components.index ?? "")),
        frame("tracked", encoder.encode(components.tracked ?? "")),
        frame("untracked", encoder.encode(components.untracked ?? "")),
        frame("submodules", encoder.encode(components.submodules ?? "")),
      ])
      : undefined;
    return {
      version: VALIDATION_EVIDENCE_VERSION,
      state: {
        version: VALIDATION_EVIDENCE_VERSION,
        complete,
        capture: run.capture,
        elapsed_ms: elapsed(rt),
        ...(digest !== undefined ? { digest } : {}),
        components,
        counts: {
          index_entries: index.entries.length,
          tracked_paths: tracked.paths,
          untracked_paths: untracked.paths,
          submodules: submodules.count,
        },
        bytes: {
          index_manifest: index.bytes,
          tracked_content: tracked.contentBytes,
          untracked_content: untracked.contentBytes,
        },
        ...(incomplete.length > 0 ? { incomplete } : {}),
        exclusions: [...VALIDATION_EXCLUSIONS],
      },
      execution: await executionEnvelope(key, cfg, run, groups),
    };
  } catch {
    const incomplete: ValidationIncomplete = {
      category: "internal",
      reason: "unavailable",
    };
    return {
      version: VALIDATION_EVIDENCE_VERSION,
      state: incompleteState(run, [incomplete], elapsed(rt)),
      execution: {
        version: VALIDATION_EVIDENCE_VERSION,
        complete: false,
        mode: run.mode,
        writer: VALIDATION_WRITER,
        jobs: [],
        incomplete: [incomplete],
      },
    };
  }
}
