/**
 * Bounded, privacy-preserving capture of the repository state a validation
 * boundary presents to configured jobs.
 *
 * Every manifest is canonical and exists only in memory. The Logbook receives
 * repository-keyed HMACs, aggregate counts/bytes, and explicit incompleteness —
 * never paths, contents, commands, config values, or reusable plain hashes.
 */

import { isAbsolute, resolve } from "@std/path";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import {
  canonicalJson,
  setupIdentityProjection,
  VALIDATION_EVIDENCE_VERSION,
  VALIDATION_EXCLUSIONS,
  VALIDATION_WRITER,
  type ValidationIncomplete,
  validationJobEntries,
  type ValidationJobGroup,
  type ValidationPlannedJob,
  type ValidationRun,
  type ValidationStart,
  type ValidationState,
} from "./validation.ts";
import { validationKey, type ValidationKeyResult } from "./validation_key.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type Scheduler,
  SYSTEM_SCHEDULER,
  type TimeoutHandle,
} from "../../shared/scheduler.ts";

/** Benchmarked against the repository fixture and held as explicit hard caps. */
export const VALIDATION_CAPTURE_LIMITS = {
  paths: 20_000,
  bytes: 64 * 1024 * 1024,
  timeMs: 5_000,
} as const;

/** Execution metadata has a separate small ceiling from repository capture. */
export const VALIDATION_EXECUTION_LIMITS = {
  entries: 1_000,
  bytes: 1024 * 1024,
} as const;

interface CaptureLimits {
  readonly paths: number;
  readonly bytes: number;
  readonly timeMs: number;
}

type DeadlineObservation<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "expired" };

type DeadlineResult<T> = Exclude<DeadlineObservation<T>, { kind: "error" }>;

/**
 * One wall-clock deadline shared by an entire validation capture. The observed
 * wrapper turns late rejection into data, so an uncancellable host promise can
 * settle after expiry without becoming an unhandled rejection.
 */
class CaptureDeadline {
  readonly #expiration: Promise<{ readonly kind: "expired" }>;
  #resolveExpiration:
    | ((value: { readonly kind: "expired" }) => void)
    | undefined;
  readonly #scheduler: Scheduler;
  #timer: TimeoutHandle | undefined;
  #expired = false;

  constructor(timeMs: number, scheduler: Scheduler) {
    this.#scheduler = scheduler;
    this.#expiration = new Promise((resolve) => {
      this.#resolveExpiration = resolve;
    });
    this.#timer = scheduler.scheduleTimeout(
      () => this.expire(),
      Math.max(0, timeMs),
    );
  }

  get expired(): boolean {
    return this.#expired;
  }

  expire(): void {
    if (this.#expired) return;
    this.#expired = true;
    if (this.#timer !== undefined) this.#scheduler.cancelTimeout(this.#timer);
    this.#timer = undefined;
    const resolveExpiration = this.#resolveExpiration;
    this.#resolveExpiration = undefined;
    resolveExpiration?.({ kind: "expired" });
  }

  async wait<T>(operation: Promise<T>): Promise<DeadlineResult<T>> {
    const observed: Promise<DeadlineObservation<T>> = operation.then(
      (value) => ({ kind: "value", value }),
      (error: unknown) => ({ kind: "error", error }),
    );
    const result = await Promise.race([observed, this.#expiration]);
    if (result.kind === "error") throw result.error;
    return result;
  }

  close(): void {
    if (this.#timer !== undefined) this.#scheduler.cancelTimeout(this.#timer);
    this.#timer = undefined;
  }
}

/** Test seams for forcing every fail-open path without relying on host modes. */
export interface ValidationCaptureOptions {
  readonly limits?: Partial<CaptureLimits> | undefined;
  readonly clock?: Clock | undefined;
  readonly scheduler?: Scheduler | undefined;
  readonly readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
  readonly gitBin?: string | undefined;
  readonly keyProvider?:
    | ((root: string) => Promise<ValidationKeyResult>)
    | undefined;
}

interface CaptureRuntime {
  readonly limits: CaptureLimits;
  readonly deadline: CaptureDeadline;
  readonly monotonicNow: () => number;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly gitBin?: string | undefined;
  readonly started: number;
  paths: number;
  bytes: number;
  timedOut: boolean;
  byteLimited: boolean;
  gitBytes: number;
}

interface IndexEntry {
  readonly tag: string;
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

/** Conservative upper bound for canonical JSON before allocating its string. */
function canonicalJsonUpperBound(
  value: unknown,
  ceiling: number,
  seen: WeakSet<object> = new WeakSet(),
): number | undefined {
  if (value === null) return 4;
  switch (typeof value) {
    case "string":
      return value.length > Math.floor((ceiling - 2) / 6)
        ? undefined
        : value.length * 6 + 2;
    case "number":
      return 32 <= ceiling ? 32 : undefined;
    case "boolean":
      return 5 <= ceiling ? 5 : undefined;
    case "object":
      break;
    default:
      return undefined;
  }
  if (seen.has(value)) return undefined;
  seen.add(value);
  let total = 2;
  const addMember = (key: string | undefined, member: unknown): boolean => {
    if (total > 2) total += 1;
    if (key !== undefined) {
      const keyBound = key.length * 6 + 3;
      if (keyBound > ceiling - total) return false;
      total += keyBound;
    }
    const memberBound = canonicalJsonUpperBound(
      member,
      ceiling - total,
      seen,
    );
    if (memberBound === undefined) return false;
    total += memberBound;
    return total <= ceiling;
  };
  if (Array.isArray(value)) {
    for (const member of value) {
      if (!addMember(undefined, member)) return undefined;
    }
  } else {
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object).sort()) {
      if (!addMember(key, object[key])) return undefined;
    }
  }
  seen.delete(value);
  return total;
}

/** Canonical JSON bytes only when both preflight and exact encoding fit. */
function boundedCanonicalJson(
  value: unknown,
  ceiling: number,
): Uint8Array | undefined {
  if (ceiling < 0 || canonicalJsonUpperBound(value, ceiling) === undefined) {
    return undefined;
  }
  const encoded = encoder.encode(canonicalJson(value));
  return encoded.length <= ceiling ? encoded : undefined;
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
  const clock = options.clock ?? SYSTEM_CLOCK;
  const scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  const captureLimits = limits(options);
  const started = clock.monotonicNow();
  return {
    limits: captureLimits,
    deadline: new CaptureDeadline(captureLimits.timeMs, scheduler),
    monotonicNow: clock.monotonicNow,
    readFile: options.readFile ?? Deno.readFile,
    ...(options.gitBin !== undefined ? { gitBin: options.gitBin } : {}),
    started,
    paths: 0,
    bytes: 0,
    timedOut: false,
    byteLimited: false,
    gitBytes: 0,
  };
}

/** Rounded nonnegative elapsed milliseconds. */
function elapsed(rt: CaptureRuntime): number {
  return Math.max(0, Math.round(rt.monotonicNow() - rt.started));
}

/** Elapsed time for a fail-open catch whose clock may itself have failed. */
function safeElapsed(rt: CaptureRuntime | undefined): number {
  if (rt === undefined) return 0;
  try {
    return elapsed(rt);
  } catch {
    // discern-best-effort: logbook-validation-elapsed-fallback
    return 0;
  }
}

/** Consult the shared wall-clock deadline at incremental probe boundaries. */
function withinTime(rt: CaptureRuntime): boolean {
  if (
    !rt.deadline.expired &&
    rt.monotonicNow() - rt.started <= rt.limits.timeMs
  ) {
    return true;
  }
  rt.timedOut = true;
  rt.deadline.expire();
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

interface CapturedGitProbe {
  readonly result?: Awaited<ReturnType<typeof runGit>>;
  readonly limit?: "time-limit" | "byte-limit";
}

/** Run one Git probe while accounting for the shared time and output ceilings. */
async function captureGit(
  root: string,
  args: string[],
  rt: CaptureRuntime,
): Promise<CapturedGitProbe> {
  if (!withinTime(rt)) return { limit: "time-limit" };
  if (rt.byteLimited) return { limit: "byte-limit" };
  const remaining = Math.max(
    1,
    Math.floor(rt.limits.timeMs - (rt.monotonicNow() - rt.started)),
  );
  const remainingBytes = Math.max(0, rt.limits.bytes - rt.bytes);
  const result = await runGit(args, {
    cwd: root,
    timeoutMs: remaining,
    maxOutputBytes: remainingBytes,
    ...(rt.gitBin !== undefined ? { bin: rt.gitBin } : {}),
  });
  const outputBytes = (result.stdoutBytes?.length ?? 0) +
    (result.stderrBytes?.length ?? 0);
  if (outputBytes > 0 && budgetBytes(rt, outputBytes)) {
    rt.gitBytes += outputBytes;
  }
  if (result.outputLimitExceeded === true || rt.byteLimited) {
    rt.byteLimited = true;
    return { limit: "byte-limit" };
  }
  if (result.timedOut === true || !withinTime(rt)) {
    rt.timedOut = true;
    return { limit: "time-limit" };
  }
  return { result };
}

/** Add one Git-probe ceiling to the common incompleteness vocabulary. */
function probeLimited(
  probe: CapturedGitProbe,
  incomplete: ValidationIncomplete[],
): probe is { limit: "time-limit" | "byte-limit" } {
  if (probe.limit === undefined) return false;
  addIncomplete(incomplete, { category: "budget", reason: probe.limit });
  return true;
}

/** Resolve and validate the key through the same bounded Git authority. */
async function captureKey(
  root: string,
  rt: CaptureRuntime,
  options: ValidationCaptureOptions,
): Promise<ValidationKeyResult> {
  if (options.keyProvider !== undefined) {
    return await options.keyProvider(root);
  }
  let limit: CapturedGitProbe["limit"];
  const failed: GitResult = {
    success: false,
    code: 1,
    stdout: "",
    stderr: "validation key path unavailable",
  };
  const result = await validationKey(root, {
    resolvePath: async (candidate) =>
      await gitAdminStatePath(candidate, "validationHmacKey", async (
        cwd,
        args,
      ) => {
        const probe = await captureGit(cwd, args, rt);
        if (probe.limit !== undefined) limit = probe.limit;
        return probe.result ?? failed;
      }),
  });
  return limit === undefined
    ? result
    : { incomplete: { category: "budget", reason: limit } };
}

/** Resolve one Git-returned repository-relative path without permitting escape. */
function safeProjectPath(root: string, path: string): string | undefined {
  if (isAbsolute(path) || path.split("/").includes("..")) return undefined;
  const absolute = resolve(root, path);
  const rootPrefix = `${resolve(root)}/`;
  return absolute.startsWith(rootPrefix) ? absolute : undefined;
}

/** Yield exact Git `-z` fields without allocating an unbounded field array. */
function* nulByteFields(raw: Uint8Array): Generator<Uint8Array> {
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== 0) continue;
    if (index > start) yield raw.slice(start, index);
    start = index + 1;
  }
  if (start < raw.length) yield raw.slice(start);
}

/** Tags Git currently emits for cached, hidden, sparse, or unmerged entries. */
const INDEX_TAGS = new Set(["H", "S", "M"]);

/** Parse `ls-files --stage -v -z`, charging every entry before retaining it. */
function parseIndex(
  raw: Uint8Array,
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): IndexEntry[] | undefined {
  const entries: IndexEntry[] = [];
  for (const record of nulByteFields(raw)) {
    if (!budgetPath(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "path-limit" });
      return entries;
    }
    const tab = record.indexOf(9);
    if (tab < 0) return undefined;
    let header: string;
    try {
      header = strictDecoder.decode(record.slice(0, tab));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return undefined;
    }
    const match = /^([^ ]+) (\d{6}) ([0-9a-fA-F]+) ([0-3])$/.exec(header);
    if (match === null) return undefined;
    const tag = match[1];
    const mode = match[2];
    const object = match[3];
    const stage = match[4];
    const pathBytes = record.slice(tab + 1);
    let path: string | undefined;
    try {
      path = strictDecoder.decode(pathBytes);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // The semantic index remains hashable byte-for-byte. Filesystem coverage
      // will fail closed if this entry later needs a JS-addressable path.
    }
    if (
      tag === undefined || !INDEX_TAGS.has(tag.toUpperCase()) ||
      mode === undefined || object === undefined || stage === undefined
    ) {
      return undefined;
    }
    entries.push({
      tag,
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
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Array<{ path: string; pathBytes: Uint8Array }> | undefined {
  const paths: Array<{ path: string; pathBytes: Uint8Array }> = [];
  for (
    const pathBytes of nulByteFields(stdoutBytes ?? encoder.encode(stdout))
  ) {
    if (!budgetPath(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "path-limit" });
      return paths;
    }
    try {
      paths.push({ path: strictDecoder.decode(pathBytes), pathBytes });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
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
  const probe = await captureGit(
    root,
    ["ls-files", "--stage", "-v", "-z"],
    rt,
  );
  if (probeLimited(probe, incomplete)) {
    return { bytes: 0, entries: [] };
  }
  const run = probe.result;
  if (run === undefined) {
    addIncomplete(incomplete, { category: "index", reason: "unavailable" });
    return { bytes: 0, entries: [] };
  }
  if (!run.success) {
    addIncomplete(incomplete, { category: "index", reason: "unavailable" });
    return { bytes: 0, entries: [] };
  }
  const rawBytes = run.stdoutBytes ?? encoder.encode(run.stdout);
  const entries = parseIndex(rawBytes, rt, incomplete);
  if (entries === undefined) {
    addIncomplete(incomplete, { category: "index", reason: "invalid" });
    return { bytes: rawBytes.length, entries: [] };
  }
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    chunks.push(
      frame("tag", encoder.encode(entry.tag)),
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
  indexEntries: readonly IndexEntry[],
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<FileManifestResult> {
  const probe = await captureGit(root, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "--",
  ], rt);
  if (probeLimited(probe, incomplete)) {
    return { paths: 0, contentBytes: 0 };
  }
  const run = probe.result;
  if (run === undefined) {
    addIncomplete(incomplete, { category: "tracked", reason: "unavailable" });
    return { paths: 0, contentBytes: 0 };
  }
  if (!run.success) {
    addIncomplete(incomplete, { category: "tracked", reason: "unavailable" });
    return { paths: 0, contentBytes: 0 };
  }
  const decoded = decodedPathFields(
    run.stdout,
    run.stdoutBytes,
    rt,
    incomplete,
  );
  if (decoded === undefined) {
    addIncomplete(incomplete, { category: "tracked", reason: "invalid" });
    return { paths: 0, contentBytes: 0 };
  }
  const gitlinks = new Set(
    indexEntries.filter((entry) => entry.mode === "160000")
      .flatMap((entry) => entry.path === undefined ? [] : [entry.path]),
  );
  const pathsByName = new Map(
    decoded.filter(({ path }) => !gitlinks.has(path)).map((entry) => [
      entry.path,
      entry,
    ]),
  );
  // Lower-case `h`, `S`/`s`, and unmerged `M` entries can be hidden from an
  // ordinary diff. Their actual checkout state is therefore always observed.
  for (const entry of indexEntries) {
    if (entry.tag === "H" && entry.stage === "0") continue;
    if (entry.mode === "160000") continue;
    if (entry.path === undefined) {
      addIncomplete(incomplete, { category: "tracked", reason: "invalid" });
      return { paths: pathsByName.size, contentBytes: 0 };
    }
    pathsByName.set(entry.path, {
      path: entry.path,
      pathBytes: entry.pathBytes,
    });
  }
  const paths = [...pathsByName.values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const chunks: Uint8Array[] = [];
  let contentBytes = 0;
  for (const { path, pathBytes } of paths) {
    if (!withinTime(rt)) {
      addIncomplete(incomplete, { category: "budget", reason: "time-limit" });
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
  const probe = await captureGit(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    rt,
  );
  if (probeLimited(probe, incomplete)) {
    return { paths: 0, contentBytes: 0 };
  }
  const run = probe.result;
  if (run === undefined) {
    addIncomplete(incomplete, { category: "untracked", reason: "unavailable" });
    return { paths: 0, contentBytes: 0 };
  }
  if (!run.success) {
    addIncomplete(incomplete, { category: "untracked", reason: "unavailable" });
    return { paths: 0, contentBytes: 0 };
  }
  const paths = decodedPathFields(
    run.stdout,
    run.stdoutBytes,
    rt,
    incomplete,
  );
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

/** Resolve one required submodule Git probe, preserving budget diagnostics. */
async function requiredSubmoduleGit(
  cwd: string,
  args: string[],
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<Awaited<ReturnType<typeof runGit>> | undefined> {
  const probe = await captureGit(cwd, args, rt);
  if (probeLimited(probe, incomplete)) return undefined;
  const result = probe.result;
  if (result === undefined || !result.success) {
    addIncomplete(incomplete, {
      category: "submodules",
      reason: "unavailable",
    });
    return undefined;
  }
  return result;
}

interface SubmoduleWalk {
  readonly chunks: Uint8Array[];
  count: number;
  readonly seen: Set<string>;
}

/** Recursively prove one gitlink is its intended initialized, clean repository. */
async function inspectSubmodule(
  superRoot: string,
  entry: IndexEntry,
  depth: number,
  walk: SubmoduleWalk,
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<boolean> {
  if (entry.path === undefined) {
    addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
    return false;
  }
  const cwd = safeProjectPath(superRoot, entry.path);
  if (cwd === undefined || walk.seen.has(cwd)) {
    addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
    return false;
  }
  walk.seen.add(cwd);
  const identity = await requiredSubmoduleGit(
    cwd,
    ["rev-parse", "--show-toplevel"],
    rt,
    incomplete,
  );
  let intendedRepository = false;
  if (identity !== undefined) {
    try {
      intendedRepository = await Deno.realPath(identity.stdout.trim()) ===
        await Deno.realPath(cwd);
    } catch {
      addIncomplete(incomplete, {
        category: "submodules",
        reason: "unavailable",
      });
    }
  }
  if (!intendedRepository) {
    addIncomplete(incomplete, {
      category: "submodules",
      reason: "unavailable",
    });
    return false;
  }
  const head = await requiredSubmoduleGit(
    cwd,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    rt,
    incomplete,
  );
  const status = await requiredSubmoduleGit(
    cwd,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=none",
    ],
    rt,
    incomplete,
  );
  if (head === undefined || status === undefined) return false;
  if (head.stdout.trim().toLowerCase() !== entry.object) {
    addIncomplete(incomplete, { category: "submodules", reason: "dirty" });
    return false;
  }
  if (
    (status.stdoutBytes?.length ?? encoder.encode(status.stdout).length) > 0
  ) {
    addIncomplete(incomplete, { category: "submodules", reason: "dirty" });
    return false;
  }
  const indexProbe = await requiredSubmoduleGit(
    cwd,
    ["ls-files", "--stage", "-v", "-z"],
    rt,
    incomplete,
  );
  if (indexProbe === undefined) return false;
  const nestedEntries = parseIndex(
    indexProbe.stdoutBytes ?? encoder.encode(indexProbe.stdout),
    rt,
    incomplete,
  );
  if (nestedEntries === undefined) {
    addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
    return false;
  }
  // A clean status cannot prove checkout bytes hidden by flags or merge stages.
  if (
    nestedEntries.some((nested) =>
      nested.mode !== "160000" &&
      (nested.tag !== "H" || nested.stage !== "0")
    )
  ) {
    addIncomplete(incomplete, { category: "submodules", reason: "dirty" });
    return false;
  }
  const nestedGitlinks = nestedEntries.filter((nested) =>
    nested.mode === "160000"
  );
  if (
    nestedGitlinks.some((nested) => nested.stage !== "0" || nested.tag !== "H")
  ) {
    addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
    return false;
  }
  walk.count += 1;
  walk.chunks.push(
    frame("depth", encoder.encode(String(depth))),
    frame("path", entry.pathBytes),
    frame("head", encoder.encode(head.stdout.trim())),
  );
  for (const nested of nestedGitlinks) {
    if (
      !await inspectSubmodule(
        cwd,
        nested,
        depth + 1,
        walk,
        rt,
        incomplete,
      )
    ) {
      return false;
    }
  }
  return true;
}

/** HMAC recursively verified clean submodule commits. */
async function submoduleManifest(
  root: string,
  key: Uint8Array,
  entries: readonly IndexEntry[],
  rt: CaptureRuntime,
  incomplete: ValidationIncomplete[],
): Promise<{ digest?: string; count: number }> {
  const allGitlinks = entries.filter((entry) => entry.mode === "160000");
  if (allGitlinks.some((entry) => entry.stage !== "0")) {
    addIncomplete(incomplete, { category: "submodules", reason: "invalid" });
    return { count: new Set(allGitlinks.map((entry) => entry.path)).size };
  }
  const walk: SubmoduleWalk = { chunks: [], count: 0, seen: new Set() };
  for (const entry of allGitlinks) {
    if (!await inspectSubmodule(root, entry, 0, walk, rt, incomplete)) {
      return { count: walk.count };
    }
  }
  return {
    digest: await hmac(key, "validation-submodules-v1", walk.chunks),
    count: walk.count,
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
  const selected: Array<{
    job: ValidationPlannedJob;
    concurrentSiblings: boolean;
  }> = [];
  for (const entry of validationJobEntries(run, groups)) {
    if (selected.length >= VALIDATION_EXECUTION_LIMITS.entries) {
      addIncomplete(incomplete, {
        category: "execution",
        reason: "entry-limit",
      });
      return minimalExecution(run, incomplete);
    }
    selected.push(entry);
  }

  let remaining = VALIDATION_EXECUTION_LIMITS.bytes;
  const take = (name: string, value: unknown): Uint8Array | undefined => {
    const overhead = 8 + encoder.encode(name).length;
    if (overhead > remaining) return undefined;
    const bytes = boundedCanonicalJson(value, remaining - overhead);
    if (bytes === undefined) return undefined;
    const chunk = frame(name, bytes);
    remaining -= chunk.length;
    return chunk;
  };
  const config = take("config", cfg);
  const setup = take("setup", setupIdentityProjection(cfg));
  if (config === undefined || setup === undefined) {
    addIncomplete(incomplete, {
      category: "execution",
      reason: "byte-limit",
    });
    return minimalExecution(run, incomplete);
  }

  const jobs: ValidationStart["execution"]["jobs"][number][] = [];
  for (const { job, concurrentSiblings } of selected) {
    const definition = take("job", {
      label: job.label,
      command: job.command,
      kind: job.kind,
      stage: job.reportStage,
      willRun: job.willRun,
      timeoutS: job.timeoutS ?? null,
    });
    if (definition === undefined) {
      addIncomplete(incomplete, {
        category: "execution",
        reason: "byte-limit",
      });
      return minimalExecution(run, incomplete);
    }
    jobs.push({
      id: job.label,
      stage: job.reportStage,
      kind: job.kind,
      ...(key !== undefined
        ? {
          definition_digest: await hmac(
            key,
            "validation-job-v1",
            [definition],
          ),
        }
        : {}),
      concurrent_siblings: concurrentSiblings,
    });
  }

  return {
    version: VALIDATION_EVIDENCE_VERSION,
    complete: key !== undefined && incomplete.length === 0,
    mode: run.mode,
    writer: VALIDATION_WRITER,
    ...(key !== undefined
      ? {
        config_digest: await hmac(key, "validation-config-v1", [
          config,
        ]),
        setup_digest: await hmac(key, "validation-setup-v1", [
          setup,
        ]),
      }
      : {}),
    jobs,
    ...(incomplete.length > 0 ? { incomplete } : {}),
  };
}

/** Minimal total execution shape for any capture or enumeration failure. */
function minimalExecution(
  run: ValidationRun,
  incomplete: readonly ValidationIncomplete[],
): ValidationStart["execution"] {
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    complete: false,
    mode: run.mode,
    writer: VALIDATION_WRITER,
    jobs: [],
    incomplete: [...incomplete],
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

/** Return categorical deadline evidence without exposing any partial capture. */
function deadlineLimitedCapture(
  run: ValidationRun,
  rt: CaptureRuntime,
  boundary?: ValidationIncomplete,
): ValidationStart {
  const limit: ValidationIncomplete = {
    category: "budget",
    reason: "time-limit",
  };
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    state: incompleteState(
      run,
      [...(boundary === undefined ? [] : [boundary]), limit],
      safeElapsed(rt),
    ),
    execution: minimalExecution(run, [limit]),
  };
}

/** Return a total internal-failure shape while preserving a prior boundary. */
function internallyUnavailableCapture(
  run: ValidationRun,
  rt?: CaptureRuntime,
  boundary?: ValidationIncomplete,
): ValidationStart {
  const internal: ValidationIncomplete = {
    category: "internal",
    reason: "unavailable",
  };
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    state: incompleteState(
      run,
      [...(boundary === undefined ? [] : [boundary]), internal],
      safeElapsed(rt),
    ),
    execution: minimalExecution(run, [internal]),
  };
}

/**
 * The single deadline and totality boundary for every exported state capture.
 * Keeping the race outside the whole operation automatically enrolls every
 * current and future awaited filesystem, identity, key, and crypto effect.
 */
async function boundedValidationCapture(
  run: ValidationRun,
  options: ValidationCaptureOptions,
  capture: (rt: CaptureRuntime) => Promise<ValidationStart>,
  boundary?: ValidationIncomplete,
): Promise<ValidationStart> {
  let rt: CaptureRuntime | undefined;
  try {
    rt = runtime(options);
    const result = await rt.deadline.wait(capture(rt));
    if (result.kind === "expired") {
      rt.timedOut = true;
      return deadlineLimitedCapture(run, rt, boundary);
    }
    return result.value;
  } catch {
    return internallyUnavailableCapture(run, rt, boundary);
  } finally {
    rt?.deadline.close();
  }
}

/** Evidence for a validation event whose job boundary was never reached. */
export async function validationBoundaryNotReached(
  root: string,
  cfg: DiscernConfig,
  run: ValidationRun,
  groups: readonly ValidationJobGroup[],
  options: ValidationCaptureOptions = {},
): Promise<ValidationStart> {
  const boundary: ValidationIncomplete = {
    category: "boundary",
    reason: "not-reached",
  };
  return await boundedValidationCapture(
    run,
    options,
    async (rt) => {
      const keyResult = await captureKey(root, rt, options);
      const key = "key" in keyResult ? keyResult.key : undefined;
      const keyFailure = "incomplete" in keyResult
        ? keyResult.incomplete
        : undefined;
      const incomplete: ValidationIncomplete[] = [boundary];
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
    },
    boundary,
  );
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
  return await boundedValidationCapture(run, options, async (rt) => {
    const keyResult = await captureKey(root, rt, options);
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

    const headProbe = await captureGit(root, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ], rt);
    if (probeLimited(headProbe, incomplete)) {
      // The shared limit diagnostic is enough.
    } else if (headProbe.result === undefined) {
      addIncomplete(incomplete, { category: "head", reason: "unavailable" });
    } else if (
      !headProbe.result.success || headProbe.result.stdout.trim() === ""
    ) {
      addIncomplete(incomplete, { category: "head", reason: "unavailable" });
    } else {
      components.head = await hmac(key, "validation-head-v1", [
        frame("head", encoder.encode(headProbe.result.stdout.trim())),
      ]);
    }

    const index = await indexManifest(root, key, rt, incomplete);
    if (index.digest !== undefined) components.index = index.digest;
    const tracked = await changedTrackedManifest(
      root,
      key,
      index.entries,
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
          git_output: rt.gitBytes,
        },
        ...(incomplete.length > 0 ? { incomplete } : {}),
        exclusions: [...VALIDATION_EXCLUSIONS],
      },
      execution: await executionEnvelope(key, cfg, run, groups),
    };
  });
}
