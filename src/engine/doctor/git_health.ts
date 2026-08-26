/**
 * Git safety diagnostics for `discern doctor`.
 *
 * These probes are read-only. They inspect every registered checkout because
 * worktree-scoped configuration can change the recovery and commit behaviour
 * of one linked worktree without changing its siblings.
 */

import { basename, join } from "@std/path";
import { splitNulRecords } from "../../shared/git_paths.ts";
import {
  commandExists,
  type GitResult,
  runGit,
} from "../../shared/subprocess.ts";
import { parseWorktreeList, resolveCommonGitDir } from "../worktree/git.ts";

/** One doctor-compatible diagnostic emitted by the Git health probes. */
export interface GitHealthCheck {
  readonly name: string;
  readonly status: "ok" | "warn" | "fail";
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

/** Why `git rev-parse --show-toplevel` refused a directory. */
export type RepositoryProbeFailure =
  | "dubious-ownership"
  | "not-repository"
  | "other";

/** The repository state shared with doctor's repository-shape check. */
export type GitRepositoryProbe =
  | { readonly kind: "repository"; readonly toplevel: string }
  | { readonly kind: "dubious-ownership"; readonly reason: string }
  | { readonly kind: "not-repository"; readonly reason: string }
  | { readonly kind: "other"; readonly reason: string };

/** All Git safety findings plus the repository probe they were based on. */
export interface GitHealthReport {
  readonly repository: GitRepositoryProbe;
  readonly checks: readonly GitHealthCheck[];
}

interface GitConfigEntry {
  readonly scope: string;
  readonly origin: string;
  readonly key: string;
  readonly normalizedKey: string;
  readonly value: string;
}

interface CheckoutSnapshot {
  readonly path: string;
  readonly label: string;
  readonly config: readonly GitConfigEntry[] | undefined;
}

interface CheckoutInventory {
  readonly snapshots: readonly CheckoutSnapshot[];
  readonly registeredCount: number;
  readonly listReadable: boolean;
}

interface ExpiryPolicy {
  readonly key: string;
  readonly normalizedKey: string;
  readonly minimumDays: number;
}

const EXPIRY_POLICIES: readonly ExpiryPolicy[] = [
  {
    key: "gc.reflogExpire",
    normalizedKey: "gc.reflogexpire",
    minimumDays: 30,
  },
  {
    key: "gc.reflogExpireUnreachable",
    normalizedKey: "gc.reflogexpireunreachable",
    minimumDays: 14,
  },
  {
    key: "gc.pruneExpire",
    normalizedKey: "gc.pruneexpire",
    minimumDays: 7,
  },
  {
    key: "gc.worktreePruneExpire",
    normalizedKey: "gc.worktreepruneexpire",
    minimumDays: 30,
  },
];

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Classify Git's repository refusal without confusing ownership with absence. */
export function classifyRepositoryProbeFailure(
  diagnostic: string,
): RepositoryProbeFailure {
  if (/dubious ownership|unsafe repository/i.test(diagnostic)) {
    return "dubious-ownership";
  }
  if (/not a git repository/i.test(diagnostic)) {
    return "not-repository";
  }
  return "other";
}

/** Prefer Git's diagnostic stream and retain an exit-code fallback. */
function gitReason(result: GitResult): string {
  return result.stderr.trim() || result.stdout.trim() ||
    `git exited with status ${result.code}`;
}

/** POSIX-shell quote one argument for a user-facing repair command. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Construct one check while keeping status and compatibility booleans aligned. */
function check(
  name: string,
  status: GitHealthCheck["status"],
  detail: string,
  fix?: string,
): GitHealthCheck {
  return {
    name,
    status,
    ok: status !== "fail",
    detail,
    ...(fix !== undefined ? { fix } : {}),
  };
}

/** Probe repository access once so every later doctor check shares the verdict. */
async function repositoryProbe(root: string): Promise<GitRepositoryProbe> {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd: root });
  const toplevel = result.stdout.trim();
  if (result.success && toplevel !== "") {
    return {
      kind: "repository",
      toplevel: await Deno.realPath(toplevel),
    };
  }
  const reason = gitReason(result);
  return {
    kind: classifyRepositoryProbeFailure(reason),
    reason,
  };
}

/** Split the `key\nvalue` record emitted by `git config --null --list`. */
function configRecord(
  record: string,
  scope: string,
  origin: string,
): GitConfigEntry {
  const separator = record.indexOf("\n");
  const key = separator === -1 ? record : record.slice(0, separator);
  return {
    scope,
    origin,
    key,
    normalizedKey: key.toLowerCase(),
    value: separator === -1 ? "" : record.slice(separator + 1),
  };
}

/** Parse config output whose NUL fields include scope and origin metadata. */
function parseScopedConfig(stdout: string): GitConfigEntry[] | undefined {
  const fields = splitNulRecords(stdout);
  if (fields.length % 3 !== 0) return undefined;
  const entries: GitConfigEntry[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const scope = fields[index];
    const origin = fields[index + 1];
    const record = fields[index + 2];
    if (scope === undefined || origin === undefined || record === undefined) {
      return undefined;
    }
    entries.push(configRecord(record, scope, origin));
  }
  return entries;
}

/** Parse config output whose NUL fields include origin metadata only. */
function parseOriginConfig(stdout: string): GitConfigEntry[] | undefined {
  const fields = splitNulRecords(stdout);
  if (fields.length % 2 !== 0) return undefined;
  const entries: GitConfigEntry[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const origin = fields[index];
    const record = fields[index + 1];
    if (origin === undefined || record === undefined) return undefined;
    entries.push(configRecord(record, "unknown", origin));
  }
  return entries;
}

/** Parse metadata-free NUL config records. */
function parsePlainConfig(stdout: string): GitConfigEntry[] {
  return splitNulRecords(stdout).map((record) =>
    configRecord(record, "unknown", "unknown")
  );
}

/** Read one checkout's effective config, retaining origins when Git supports it. */
async function readEffectiveConfig(
  cwd: string,
): Promise<GitConfigEntry[] | undefined> {
  const scoped = await runGit([
    "config",
    "--null",
    "--show-origin",
    "--show-scope",
    "--list",
  ], { cwd });
  if (scoped.success) {
    const parsed = parseScopedConfig(scoped.stdout);
    if (parsed !== undefined) return parsed;
  }
  const origin = await runGit([
    "config",
    "--null",
    "--show-origin",
    "--list",
  ], { cwd });
  if (origin.success) {
    const parsed = parseOriginConfig(origin.stdout);
    if (parsed !== undefined) return parsed;
  }
  const plain = await runGit(["config", "--null", "--list"], { cwd });
  return plain.success ? parsePlainConfig(plain.stdout) : undefined;
}

/** Read only the common repository config, excluding `config.worktree`. */
async function readCommonConfig(
  root: string,
): Promise<GitConfigEntry[] | undefined> {
  const commonDir = await resolveCommonGitDir(root);
  if (commonDir === undefined) return undefined;
  const result = await runGit([
    "config",
    "--file",
    join(commonDir, "config"),
    "--null",
    "--list",
  ], { cwd: root });
  return result.success ? parsePlainConfig(result.stdout) : undefined;
}

/** The effective (last) value for a single-valued, case-insensitive key. */
function effectiveEntry(
  entries: readonly GitConfigEntry[],
  normalizedKey: string,
): GitConfigEntry | undefined {
  let found: GitConfigEntry | undefined;
  for (const entry of entries) {
    if (entry.normalizedKey === normalizedKey) found = entry;
  }
  return found;
}

/** Git's accepted boolean spellings, plus logAllRefUpdates' `always` mode. */
function configBoolean(value: string): boolean | undefined {
  switch (value.trim().toLowerCase()) {
    case "":
    case "true":
    case "yes":
    case "on":
    case "1":
    case "always":
      return true;
    case "false":
    case "no":
    case "off":
    case "0":
      return false;
    default:
      return undefined;
  }
}

/** Inventory every registered, currently readable checkout. */
async function checkoutInventory(
  root: string,
  toplevel: string,
): Promise<CheckoutInventory> {
  const listed = await runGit(["worktree", "list", "--porcelain"], {
    cwd: root,
  });
  const records = listed.success ? parseWorktreeList(listed.stdout) : [];
  const paths = records.length > 0 ? records.map((record) => record.path) : [
    toplevel,
  ];
  const snapshots: CheckoutSnapshot[] = [];
  for (const path of paths) {
    const canonical = await Deno.realPath(path);
    const label = canonical === toplevel ? "main checkout" : basename(path);
    snapshots.push({
      path,
      label,
      config: await readEffectiveConfig(path),
    });
  }
  return {
    snapshots,
    registeredCount: paths.length,
    listReadable: listed.success,
  };
}

/** Turn Git's approximate-date parser into a retained duration in seconds. */
async function expirySeconds(
  cwd: string,
  value: string,
): Promise<number | undefined> {
  const parsed = await runGit(["rev-parse", `--since=${value}`], { cwd });
  const match = /^--max-age=(\d+)\s*$/.exec(parsed.stdout);
  if (!parsed.success || match === null) return undefined;
  const epoch = Number(match[1]);
  if (!Number.isFinite(epoch)) return undefined;
  if (epoch === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(Date.now() / 1000) - epoch);
}

/** Whether a config key is a ref-pattern-specific reflog expiry policy. */
function refExpiryPolicy(entry: GitConfigEntry): ExpiryPolicy | undefined {
  if (
    !/^gc\..+\.reflogexpire(?:unreachable)?$/.test(entry.normalizedKey) ||
    EXPIRY_POLICIES.some((policy) =>
      policy.normalizedKey === entry.normalizedKey
    )
  ) {
    return undefined;
  }
  return {
    key: entry.key,
    normalizedKey: entry.normalizedKey,
    minimumDays: entry.normalizedKey.endsWith("reflogexpireunreachable")
      ? 14
      : 30,
  };
}

/** Reflog, object-prune, and stale-worktree retention health. */
async function recoveryCheck(
  snapshots: readonly CheckoutSnapshot[],
): Promise<GitHealthCheck> {
  const issues: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.config === undefined) {
      issues.push(`${snapshot.label}: Git config could not be read`);
      continue;
    }
    const reflogs = effectiveEntry(
      snapshot.config,
      "core.logallrefupdates",
    );
    if (reflogs !== undefined) {
      const enabled = configBoolean(reflogs.value);
      if (enabled === false) {
        issues.push(`${snapshot.label}: core.logAllRefUpdates=false`);
      } else if (enabled === undefined) {
        issues.push(
          `${snapshot.label}: core.logAllRefUpdates has invalid value ${reflogs.value}`,
        );
      }
    }

    const headReflog = await runGit(["reflog", "exists", "HEAD"], {
      cwd: snapshot.path,
    });
    if (!headReflog.success) {
      issues.push(
        headReflog.code === 1
          ? `${snapshot.label}: HEAD has no reflog`
          : `${snapshot.label}: HEAD reflog could not be verified`,
      );
    }

    const policies: Array<{ policy: ExpiryPolicy; entry: GitConfigEntry }> = [];
    for (const policy of EXPIRY_POLICIES) {
      const entry = effectiveEntry(snapshot.config, policy.normalizedKey);
      if (entry !== undefined) policies.push({ policy, entry });
    }
    const patternEntries = new Map<string, GitConfigEntry>();
    for (const entry of snapshot.config) {
      if (refExpiryPolicy(entry) !== undefined) {
        patternEntries.set(entry.normalizedKey, entry);
      }
    }
    for (const entry of patternEntries.values()) {
      const policy = refExpiryPolicy(entry);
      if (policy !== undefined) policies.push({ policy, entry });
    }
    for (const { policy, entry } of policies) {
      const seconds = await expirySeconds(snapshot.path, entry.value);
      if (seconds === undefined) {
        issues.push(
          `${snapshot.label}: ${policy.key}=${entry.value} could not be interpreted`,
        );
      } else if (seconds < policy.minimumDays * SECONDS_PER_DAY) {
        issues.push(`${snapshot.label}: ${policy.key}=${entry.value}`);
      }
    }
  }

  if (issues.length === 0) {
    return check(
      "Git recovery",
      "ok",
      `${snapshots.length} checkout(s); reflogs are enabled and configured retention meets discern's recovery floor`,
    );
  }
  return check(
    "Git recovery",
    "warn",
    issues.join("; "),
    "restore Git's recovery defaults in the scope that set each value: " +
      "`git config core.logAllRefUpdates true`, " +
      "`git config gc.reflogExpire 90.days.ago`, " +
      "`git config gc.reflogExpireUnreachable 30.days.ago`, " +
      "`git config gc.pruneExpire 2.weeks.ago`, and " +
      "`git config gc.worktreePruneExpire 3.months.ago`; inspect narrower overrides with " +
      "`git config --show-origin --show-scope --list`. Existing expired reflog entries cannot be reconstructed",
  );
}

/** Author and committer identity readiness in every checkout. */
async function identityCheck(
  snapshots: readonly CheckoutSnapshot[],
): Promise<GitHealthCheck> {
  const failures: string[] = [];
  const fallbacks: string[] = [];
  for (const snapshot of snapshots) {
    const [author, committer] = await Promise.all([
      runGit(["var", "GIT_AUTHOR_IDENT"], { cwd: snapshot.path }),
      runGit(["var", "GIT_COMMITTER_IDENT"], { cwd: snapshot.path }),
    ]);
    if (
      !author.success || author.stdout.trim() === "" ||
      !committer.success || committer.stdout.trim() === ""
    ) {
      failures.push(
        `${snapshot.label}: ${gitReason(!author.success ? author : committer)}`,
      );
      continue;
    }
    if (snapshot.config === undefined) {
      failures.push(`${snapshot.label}: Git config could not be read`);
      continue;
    }
    const name = effectiveEntry(snapshot.config, "user.name")?.value.trim();
    const email = effectiveEntry(snapshot.config, "user.email")?.value.trim();
    if (
      name === undefined || name === "" || email === undefined || email === ""
    ) {
      fallbacks.push(
        `${snapshot.label}: identity resolves only through environment or guessed values`,
      );
    }
  }
  const fix =
    'set a stable identity with `git config user.name "Your Name"` and ' +
    "`git config user.email you@example.com` in each affected checkout, or add `--global` if it should apply to every repository";
  if (failures.length > 0) {
    return check("commit identity", "fail", failures.join("; "), fix);
  }
  if (fallbacks.length > 0) {
    return check("commit identity", "warn", fallbacks.join("; "), fix);
  }
  return check(
    "commit identity",
    "ok",
    `author and committer identity resolve from configured user.name and user.email in ${snapshots.length} checkout(s)`,
  );
}

/** Resolve the signer executable selected by one checkout's config. */
function signingProgram(
  entries: readonly GitConfigEntry[],
): { format: string; key: string; program: string } | undefined {
  const format = effectiveEntry(entries, "gpg.format")?.value.trim()
    .toLowerCase() || "openpgp";
  if (format === "openpgp") {
    return {
      format,
      key: "gpg.openpgp.program",
      program: effectiveEntry(entries, "gpg.openpgp.program")?.value.trim() ||
        effectiveEntry(entries, "gpg.program")?.value.trim() || "gpg",
    };
  }
  if (format === "ssh") {
    return {
      format,
      key: "gpg.ssh.program",
      program: effectiveEntry(entries, "gpg.ssh.program")?.value.trim() ||
        "ssh-keygen",
    };
  }
  if (format === "x509") {
    return {
      format,
      key: "gpg.x509.program",
      program: effectiveEntry(entries, "gpg.x509.program")?.value.trim() ||
        "gpgsm",
    };
  }
  return undefined;
}

/** Signing readiness without creating a test signature or touching key agents. */
async function signingCheck(
  snapshots: readonly CheckoutSnapshot[],
): Promise<GitHealthCheck> {
  const enabled: string[] = [];
  const failures: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.config === undefined) {
      failures.push(`${snapshot.label}: Git config could not be read`);
      continue;
    }
    const configured = effectiveEntry(snapshot.config, "commit.gpgsign");
    const required = configured === undefined
      ? false
      : configBoolean(configured.value);
    if (required === false) continue;
    if (required === undefined) {
      failures.push(
        `${snapshot.label}: commit.gpgSign has invalid value ${
          configured?.value ?? ""
        }`,
      );
      continue;
    }
    const signer = signingProgram(snapshot.config);
    if (signer === undefined) {
      const format = effectiveEntry(snapshot.config, "gpg.format")?.value ?? "";
      failures.push(`${snapshot.label}: unsupported gpg.format=${format}`);
      continue;
    }
    if (!(await commandExists(signer.program, { cwd: snapshot.path }))) {
      failures.push(
        `${snapshot.label}: commit signing uses ${signer.format}, but ${signer.program} (${signer.key}) is not runnable`,
      );
      continue;
    }
    const signingKey = effectiveEntry(snapshot.config, "user.signingkey")
      ?.value.trim();
    if (signer.format === "ssh" && !signingKey) {
      failures.push(
        `${snapshot.label}: SSH commit signing is enabled, but user.signingKey is not configured`,
      );
      continue;
    }
    enabled.push(`${snapshot.label}: ${signer.format} via ${signer.program}`);
  }
  if (failures.length > 0) {
    return check(
      "commit signing",
      "fail",
      failures.join("; "),
      "install or correct the configured signer, or turn off required signing for this repository with `git config commit.gpgSign false`; discern does not create a probe signature or contact a key agent during doctor",
    );
  }
  return check(
    "commit signing",
    "ok",
    enabled.length === 0
      ? "commit.gpgSign is off in every checkout"
      : `enabled and the configured signer resolves (${enabled.join("; ")})`,
  );
}

/** Compact a potentially large set of path names without concealing the count. */
function pathSummary(paths: readonly string[]): string {
  const shown = paths.slice(0, 4).join(", ");
  return paths.length <= 4 ? shown : `${shown}, and ${paths.length - 4} more`;
}

/** Quote a bounded set of paths for an exact update-index repair. */
function repairPaths(paths: readonly string[]): string {
  return paths.slice(0, 4).map(shellQuote).join(" ");
}

/** Hidden-index and sparse-checkout visibility health. */
async function indexVisibilityCheck(
  snapshots: readonly CheckoutSnapshot[],
): Promise<GitHealthCheck> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.config === undefined) {
      failures.push(`${snapshot.label}: Git config could not be read`);
      continue;
    }
    const listed = await runGit(["ls-files", "-v", "-z"], {
      cwd: snapshot.path,
    });
    if (!listed.success) {
      failures.push(`${snapshot.label}: index flags could not be read`);
      continue;
    }
    const assumed: string[] = [];
    const skipped: string[] = [];
    for (const record of splitNulRecords(listed.stdout)) {
      const tag = record[0];
      const path = record.slice(2);
      if (tag === undefined || path === "") continue;
      if (/^[a-z]$/.test(tag)) assumed.push(path);
      if (tag.toUpperCase() === "S") skipped.push(path);
    }
    const sparseValue = effectiveEntry(
      snapshot.config,
      "core.sparsecheckout",
    );
    const sparse = sparseValue === undefined
      ? false
      : configBoolean(sparseValue.value) === true;
    const ignoreStat = effectiveEntry(snapshot.config, "core.ignorestat");
    if (ignoreStat !== undefined && configBoolean(ignoreStat.value) === true) {
      warnings.push(`${snapshot.label}: core.ignoreStat=true`);
      fixes.push("`git config core.ignoreStat false`");
    }
    if (assumed.length > 0) {
      failures.push(
        `${snapshot.label}: assume-unchanged hides ${pathSummary(assumed)}`,
      );
      fixes.push(
        `\`git update-index --no-assume-unchanged -- ${repairPaths(assumed)}\``,
      );
    }
    if (skipped.length > 0 && !sparse) {
      failures.push(
        `${snapshot.label}: skip-worktree is set outside sparse checkout for ${
          pathSummary(skipped)
        }`,
      );
      fixes.push(
        `\`git update-index --no-skip-worktree -- ${repairPaths(skipped)}\``,
      );
    } else if (sparse) {
      warnings.push(
        `${snapshot.label}: sparse checkout is active with ${skipped.length} skip-worktree path(s)`,
      );
      fixes.push(
        "`git sparse-checkout disable` if the checkout should contain the whole repository",
      );
    }
  }
  const fix = fixes.length === 0
    ? undefined
    : `${
      [...new Set(fixes)].join("; ")
    }. Review all flagged paths with \`git ls-files -v\``;
  if (failures.length > 0) {
    return check(
      "index visibility",
      "fail",
      [...failures, ...warnings].join("; "),
      fix ?? "clear the hidden index flags, then re-run `discern doctor`",
    );
  }
  if (warnings.length > 0) {
    return check(
      "index visibility",
      "warn",
      warnings.join("; "),
      fix ?? "review the sparse-checkout and index configuration",
    );
  }
  return check(
    "index visibility",
    "ok",
    `${snapshots.length} checkout(s); no assume-unchanged, stray skip-worktree, sparse-checkout, or core.ignoreStat visibility override`,
  );
}

/** Canonical spelling for common config keys named in diagnostics. */
function configKeyDisplay(normalizedKey: string): string {
  const displays: Readonly<Record<string, string>> = {
    "core.worktree": "core.worktree",
    "core.sparsecheckout": "core.sparseCheckout",
    "core.sparsecheckoutcone": "core.sparseCheckoutCone",
    "index.sparse": "index.sparse",
  };
  return displays[normalizedKey] ?? normalizedKey;
}

/** Worktree-extension and checkout-local config placement health. */
async function worktreeConfigCheck(
  root: string,
  inventory: CheckoutInventory,
): Promise<GitHealthCheck> {
  if (!inventory.listReadable) {
    return check(
      "worktree Git config",
      "fail",
      "Git could not list the registered worktrees, so checkout-local config placement cannot be verified",
      "run `git worktree list --porcelain`, correct the error it reports, then re-run `discern doctor`",
    );
  }
  const common = await readCommonConfig(root);
  if (common === undefined) {
    return check(
      "worktree Git config",
      "fail",
      "the common repository config could not be read",
      "run `git config --local --list`, correct the error it reports, then re-run `discern doctor`",
    );
  }
  const linked = Math.max(0, inventory.registeredCount - 1);
  const extension = effectiveEntry(common, "extensions.worktreeconfig");
  const extensionEnabled = extension !== undefined &&
    configBoolean(extension.value) === true;
  const misplacedKeys = [
    "core.worktree",
    "core.sparsecheckout",
    "core.sparsecheckoutcone",
    "index.sparse",
  ].filter((key) => effectiveEntry(common, key) !== undefined);
  const failures: string[] = [];
  const warnings: string[] = [];
  if (linked > 0 && !extensionEnabled) {
    failures.push(
      `${linked} linked worktree(s), but extensions.worktreeConfig is not true`,
    );
  }
  if (linked > 0 && misplacedKeys.includes("core.worktree")) {
    failures.push("core.worktree is stored in the common repository config");
  }
  const sparseKeys = misplacedKeys.filter((key) => key !== "core.worktree");
  if (linked > 0 && sparseKeys.length > 0) {
    warnings.push(
      `checkout-specific sparse settings are stored in the common config: ${
        sparseKeys.map(configKeyDisplay).join(", ")
      }`,
    );
  }
  const repair =
    "enable checkout-local config with `git config extensions.worktreeConfig true`; " +
    "move core.worktree or sparse-checkout values out of the common config by unsetting each there and setting it from the affected checkout with `git config --worktree <key> <value>`";
  if (failures.length > 0) {
    return check(
      "worktree Git config",
      "fail",
      [...failures, ...warnings].join("; "),
      repair,
    );
  }
  if (warnings.length > 0) {
    return check("worktree Git config", "warn", warnings.join("; "), repair);
  }
  return check(
    "worktree Git config",
    "ok",
    linked === 0
      ? "no linked worktrees need checkout-local Git config yet"
      : `extensions.worktreeConfig is enabled for ${linked} linked worktree(s), with no checkout-specific settings in the common config`,
  );
}

/** Run every read-only Git health probe used by `discern doctor`. */
export async function inspectGitHealth(root: string): Promise<GitHealthReport> {
  const repository = await repositoryProbe(root);
  if (repository.kind !== "repository") {
    if (repository.kind === "dubious-ownership") {
      const canonical = await Deno.realPath(root);
      return {
        repository,
        checks: [
          check(
            "repository ownership",
            "fail",
            `Git refused this repository as unsafe: ${repository.reason}`,
            `first verify that ${canonical} is owned by the expected account; only then trust this exact path with \`git config --global --add safe.directory ${
              shellQuote(canonical)
            }\`. Never use a wildcard safe.directory entry`,
          ),
        ],
      };
    }
    if (repository.kind === "other") {
      return {
        repository,
        checks: [
          check(
            "repository access",
            "fail",
            `Git could not inspect this directory: ${repository.reason}`,
            "run `git rev-parse --show-toplevel` here, correct the error it reports, then re-run `discern doctor`",
          ),
        ],
      };
    }
    return { repository, checks: [] };
  }

  const inventory = await checkoutInventory(root, repository.toplevel);
  const [recovery, identity, signing, index, worktreeConfig] = await Promise
    .all([
      recoveryCheck(inventory.snapshots),
      identityCheck(inventory.snapshots),
      signingCheck(inventory.snapshots),
      indexVisibilityCheck(inventory.snapshots),
      worktreeConfigCheck(root, inventory),
    ]);
  return {
    repository,
    checks: [
      check(
        "repository ownership",
        "ok",
        "Git accepts this repository for the current account",
      ),
      recovery,
      identity,
      signing,
      index,
      worktreeConfig,
    ],
  };
}
