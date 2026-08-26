/**
 * Content-verified Vale provisioning for discern's own prose toolchain.
 *
 * `.vale-version` owns the version and `.vale-assets.json` owns each supported
 * release asset's checksum. The installed binary lives in repository-lifetime
 * Git-admin state, so main and every linked worktree share it without trusting
 * a same-named executable on PATH.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { pathExists } from "../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const VALE_RELEASES = "https://github.com/vale-cli/vale/releases/download";
const INSTALL_LOCK_WAIT_MS = 60_000;
const INSTALL_LOCK_STALE_MS = 10 * 60_000;
const INSTALL_LOCK_POLL_MS = 100;

const ValeAssetSchema = z.object({
  release: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const ValeAssetsSchema = z.object({
  schema: z.literal(1),
  assets: z.record(z.string(), ValeAssetSchema),
}).strict();

const ValeCacheMarkerSchema = z.object({
  schema: z.literal(1),
  version: z.string(),
  platform: z.string(),
  archiveSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type ValeAsset = z.infer<typeof ValeAssetSchema>;
export type ValeAssets = z.infer<typeof ValeAssetsSchema>;
type ValeCacheMarker = z.infer<typeof ValeCacheMarkerSchema>;

export interface ValePlatform {
  readonly os: string;
  readonly arch: string;
}

export interface ValeToolchainOptions {
  /** Test seam; production derives the shared root from Git-admin state. */
  readonly cacheRoot?: string;
  /** Test seam; production uses the current Deno platform. */
  readonly platform?: ValePlatform;
  /** Test seam for an immutable release response. */
  readonly download?: (url: string) => Promise<Uint8Array>;
  /** Additional environment passed to the exact cached executable. */
  readonly env?: Record<string, string>;
}

export interface ValeToolchain {
  readonly version: string;
  readonly platform: string;
  readonly asset: ValeAsset;
  readonly assetName: string;
  readonly assetUrl: string;
  readonly cacheDir: string;
  readonly binary: string;
  readonly marker: string;
}

/** Extract Vale's semantic version from `vale --version` output. */
export function parseValeVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+)\b/u)?.[1];
}

/** Lowercase SHA-256 for arbitrary bytes. */
export async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Parse one tracked JSON authority with a concise file-local diagnostic. */
function parseTrackedJson<T>(
  path: string,
  source: string,
  schema: z.ZodType<T>,
): T {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} is not valid JSON`, { cause: error });
  }
  const decoded = schema.safeParse(value);
  if (!decoded.success) {
    const issues = decoded.error.issues.map((issue) =>
      `${issue.path.join(".") || "value"}: ${issue.message}`
    ).join("; ");
    throw new Error(`${path} is invalid: ${issues}`);
  }
  return decoded.data;
}

/** Read and validate the tracked asset-integrity registry. */
export async function readValeAssets(repoRoot: string): Promise<ValeAssets> {
  const path = join(repoRoot, ".vale-assets.json");
  return parseTrackedJson(
    path,
    await Deno.readTextFile(path),
    ValeAssetsSchema,
  );
}

/** Read the sole Vale version authority. */
async function readValeVersion(repoRoot: string): Promise<string> {
  const path = join(repoRoot, ".vale-version");
  const version = (await Deno.readTextFile(path)).trim();
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`${path} must contain one semantic version`);
  }
  return version;
}

/** Resolve the repository-lifetime cache shared by every linked worktree. */
async function resolveCacheRoot(
  repoRoot: string,
  options: ValeToolchainOptions,
): Promise<string> {
  if (options.cacheRoot !== undefined) return options.cacheRoot;
  const cache = await gitAdminStatePath(repoRoot, "repositoryToolchains");
  if (cache === undefined) {
    throw new Error(
      "Vale provisioning requires a Git repository with a resolvable common directory",
    );
  }
  return cache;
}

/** Derive the immutable release name and content-addressed cache target. */
export async function valeToolchain(
  repoRoot: string,
  options: ValeToolchainOptions = {},
): Promise<ValeToolchain> {
  const version = await readValeVersion(repoRoot);
  const manifest = await readValeAssets(repoRoot);
  const host = options.platform ?? Deno.build;
  const platform = `${host.os}-${host.arch}`;
  const asset = manifest.assets[platform];
  if (asset === undefined) {
    throw new Error(
      `Vale ${version} has no tracked asset for ${platform}; supported platforms: ${
        Object.keys(manifest.assets).sort().join(", ")
      }`,
    );
  }
  const assetName = `vale_${version}_${asset.release}.tar.gz`;
  const cacheRoot = await resolveCacheRoot(repoRoot, options);
  const cacheDir = join(
    cacheRoot,
    "vale",
    version,
    platform,
    asset.sha256,
  );
  return {
    version,
    platform,
    asset,
    assetName,
    assetUrl: `${VALE_RELEASES}/v${version}/${assetName}`,
    cacheDir,
    binary: join(cacheDir, "vale"),
    marker: join(cacheDir, "integrity.json"),
  };
}

/** Run one exact Vale binary without consulting PATH for its executable. */
async function runExactVale(
  toolchain: ValeToolchain,
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
): Promise<Deno.CommandOutput> {
  return await new Deno.Command(toolchain.binary, {
    args,
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
    ...(env === undefined ? {} : { env }),
  }).output();
}

/** Explain the first integrity failure, or return undefined for a valid cache. */
async function cacheValidationIssue(
  toolchain: ValeToolchain,
  repoRoot: string,
  env?: Record<string, string>,
): Promise<string | undefined> {
  let marker: ValeCacheMarker;
  try {
    marker = parseTrackedJson(
      toolchain.marker,
      await Deno.readTextFile(toolchain.marker),
      ValeCacheMarkerSchema,
    );
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "integrity marker is unreadable";
  }
  if (
    marker.version !== toolchain.version ||
    marker.platform !== toolchain.platform ||
    marker.archiveSha256 !== toolchain.asset.sha256
  ) {
    return "integrity marker does not match the tracked toolchain";
  }

  let binary: Uint8Array;
  try {
    const info = await Deno.stat(toolchain.binary);
    if (!info.isFile) return "cached Vale is not a regular file";
    binary = await Deno.readFile(toolchain.binary);
  } catch (error) {
    return error instanceof Error ? error.message : "cached Vale is unreadable";
  }
  if (await sha256BytesHex(binary) !== marker.binarySha256) {
    return "cached Vale does not match its installed digest";
  }

  let versionRun: Deno.CommandOutput;
  try {
    versionRun = await runExactVale(
      toolchain,
      repoRoot,
      ["--version"],
      env,
    );
  } catch (error) {
    return error instanceof Error ? error.message : "cached Vale could not run";
  }
  const actual = parseValeVersion(
    `${decoder.decode(versionRun.stdout)} ${decoder.decode(versionRun.stderr)}`,
  );
  if (!versionRun.success || actual !== toolchain.version) {
    return `cached Vale reports ${actual ?? "an unreadable version"}`;
  }
  return undefined;
}

/** Resolve a valid cached binary without performing network or write effects. */
export async function resolveValeBinary(
  repoRoot: string,
  options: ValeToolchainOptions = {},
): Promise<string> {
  const toolchain = await valeToolchain(repoRoot, options);
  const issue = await cacheValidationIssue(toolchain, repoRoot, options.env);
  if (issue !== undefined) {
    throw new Error(
      `Vale ${toolchain.version} is not ready in the repository cache (${issue}). ` +
        "Run `deno task vale:sync` from the repository root to install or repair it.",
    );
  }
  return toolchain.binary;
}

/** Fetch one immutable Vale release asset. */
async function downloadRelease(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Vale download failed with HTTP ${response.status} ${response.statusText}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Remove one owned cache path, tolerating only a raced absence. */
async function removeOwnedPath(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Pause one bounded install-lock retry. */
async function waitForInstallLock(): Promise<void> {
  await new Promise<void>((resolve) =>
    setTimeout(resolve, INSTALL_LOCK_POLL_MS)
  );
}

/** Reclaim a lock whose owner cannot still be a normal release download. */
async function reclaimStaleLock(lock: string): Promise<boolean> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(lock);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true;
    throw error;
  }
  const modified = info.mtime?.getTime();
  if (modified === undefined || Date.now() - modified < INSTALL_LOCK_STALE_MS) {
    return false;
  }
  const stale = `${lock}.stale-${crypto.randomUUID()}`;
  try {
    await Deno.rename(lock, stale);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true;
    throw error;
  }
  await removeOwnedPath(stale);
  return true;
}

/** Acquire the per-content install lock, or observe another complete install. */
async function acquireInstallLock(
  lock: string,
  toolchain: ValeToolchain,
  repoRoot: string,
  env?: Record<string, string>,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < INSTALL_LOCK_WAIT_MS) {
    try {
      await Deno.mkdir(lock, { mode: 0o700 });
      return true;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    if (await cacheValidationIssue(toolchain, repoRoot, env) === undefined) {
      return false;
    }
    if (await reclaimStaleLock(lock)) continue;
    await waitForInstallLock();
  }
  throw new Error(
    `Timed out waiting for another process to provision Vale ${toolchain.version}`,
  );
}

/** Extract only the named Vale executable from a verified release archive. */
async function extractVale(
  archive: string,
  destination: string,
): Promise<void> {
  const run = await new Deno.Command("tar", {
    args: ["-xzf", archive, "-C", destination, "vale"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!run.success) {
    throw new Error(
      `Could not extract Vale: ${
        decoder.decode(run.stderr).trim() || `tar exited ${run.code}`
      }`,
    );
  }
}

/** Download, verify, extract, and validate one staged cache directory. */
async function stageVale(
  toolchain: ValeToolchain,
  repoRoot: string,
  stage: string,
  options: ValeToolchainOptions,
): Promise<void> {
  await Deno.mkdir(stage, { mode: 0o700 });
  const archive = join(stage, toolchain.assetName);
  const bytes = await (options.download ?? downloadRelease)(toolchain.assetUrl);
  const actualArchiveSha = await sha256BytesHex(bytes);
  if (actualArchiveSha !== toolchain.asset.sha256) {
    throw new Error(
      `Vale ${toolchain.version} archive checksum mismatch for ${toolchain.platform}: ` +
        `expected ${toolchain.asset.sha256}, received ${actualArchiveSha}`,
    );
  }
  await Deno.writeFile(archive, bytes, { mode: 0o600 });
  await extractVale(archive, stage);
  await Deno.chmod(join(stage, "vale"), 0o755);
  await Deno.remove(archive);

  const staged: ValeToolchain = {
    ...toolchain,
    cacheDir: stage,
    binary: join(stage, "vale"),
    marker: join(stage, "integrity.json"),
  };
  const versionRun = await runExactVale(
    staged,
    repoRoot,
    ["--version"],
    options.env,
  );
  const actualVersion = parseValeVersion(
    `${decoder.decode(versionRun.stdout)} ${decoder.decode(versionRun.stderr)}`,
  );
  if (!versionRun.success || actualVersion !== toolchain.version) {
    throw new Error(
      `Verified Vale archive reports ${
        actualVersion ?? "an unreadable version"
      }; ` +
        `expected ${toolchain.version}`,
    );
  }
  const marker: ValeCacheMarker = {
    schema: 1,
    version: toolchain.version,
    platform: toolchain.platform,
    archiveSha256: toolchain.asset.sha256,
    binarySha256: await sha256BytesHex(await Deno.readFile(staged.binary)),
  };
  await Deno.writeTextFile(
    staged.marker,
    `${JSON.stringify(marker, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/** Ensure the exact tracked binary exists in the shared content-addressed cache. */
export async function ensureVale(
  repoRoot: string,
  options: ValeToolchainOptions = {},
): Promise<string> {
  const toolchain = await valeToolchain(repoRoot, options);
  if (
    await cacheValidationIssue(toolchain, repoRoot, options.env) === undefined
  ) {
    return toolchain.binary;
  }

  await Deno.mkdir(dirname(toolchain.cacheDir), { recursive: true });
  const lock = `${toolchain.cacheDir}.lock`;
  const ownsLock = await acquireInstallLock(
    lock,
    toolchain,
    repoRoot,
    options.env,
  );
  if (!ownsLock) return toolchain.binary;

  const stage = `${toolchain.cacheDir}.install-${crypto.randomUUID()}`;
  try {
    if (
      await cacheValidationIssue(toolchain, repoRoot, options.env) === undefined
    ) {
      return toolchain.binary;
    }
    if (await pathExists(toolchain.cacheDir)) {
      await removeOwnedPath(toolchain.cacheDir);
    }
    await stageVale(toolchain, repoRoot, stage, options);
    await Deno.rename(stage, toolchain.cacheDir);
    const issue = await cacheValidationIssue(
      toolchain,
      repoRoot,
      options.env,
    );
    if (issue !== undefined) {
      throw new Error(`Installed Vale failed cache validation: ${issue}`);
    }
    return toolchain.binary;
  } finally {
    try {
      await removeOwnedPath(stage);
    } finally {
      await removeOwnedPath(lock);
    }
  }
}

/** Run the validated cached Vale binary for an authored caller. */
export async function runProvisionedVale(
  repoRoot: string,
  args: string[],
  options: ValeToolchainOptions = {},
): Promise<Deno.CommandOutput> {
  const toolchain = await valeToolchain(repoRoot, options);
  await resolveValeBinary(repoRoot, options);
  return await runExactVale(toolchain, repoRoot, args, options.env);
}

/** Provision the tracked binary, then synchronize the tracked Vale packages. */
export async function syncVale(
  repoRoot: string,
  options: ValeToolchainOptions = {},
): Promise<Deno.CommandOutput> {
  await ensureVale(repoRoot, options);
  const toolchain = await valeToolchain(repoRoot, options);
  return await runExactVale(toolchain, repoRoot, ["sync"], options.env);
}

/** Relay a piped subprocess stream without changing its bytes. */
async function relay(
  target: { write(bytes: Uint8Array): Promise<number> },
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.length > 0) await target.write(bytes);
}

/** Run the standalone synchronization task from its invoking checkout. */
async function main(repoRoot: string = Deno.cwd()): Promise<void> {
  try {
    const run = await syncVale(repoRoot);
    await relay(Deno.stdout, run.stdout);
    await relay(Deno.stderr, run.stderr);
    if (!run.success) Deno.exit(run.code);
  } catch (error) {
    await relay(
      Deno.stderr,
      encoder.encode(
        `${error instanceof Error ? error.message : String(error)}\n`,
      ),
    );
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
