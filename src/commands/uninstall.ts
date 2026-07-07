/**
 * `discern uninstall` — take the harness back out of a project, cleanly.
 *
 * The exit-honesty verb (design principle 12): discern removes exactly what it
 * wired and keeps everything the user owns, so leaving is never expensive and
 * nothing it deletes was ever theirs. It reverses the write-surface contract
 * (ADR 0099) leg by leg, derived from the SAME single sources that contract is
 * enforced from — the provider registry (`src/lib/providers.ts`) for the
 * generated agent files, materialized skills, and co-owned integration files,
 * and the paths registry for the user content it must NOT touch. Driving the
 * removal off the registries is what stops it drifting from what discern
 * actually writes: a new provider file auto-enrols (the round-trip test fails
 * until uninstall handles it), never a stale hand list.
 *
 * What it removes: the generated agent files and materialized skills dirs
 * (gitignored, always regenerable); discern-owned provider files (the Codex
 * rules, the Copilot hook file); the discern entries inside co-owned files (each
 * provider's MCP server, the session hooks, the permission defaults) — stripping
 * them and leaving the user's own settings byte-for-byte; and the delimited
 * `.gitignore` block. A co-owned file discern created outright empties to nothing
 * and is deleted; one the user shares keeps their content.
 *
 * What it keeps: `discern.toml`, and every path in the `discern/` namespace
 * (guidance, the map, authored skills, recipes, the ledger, the brief) — plain
 * files at paths the user chose or accepted, valuable without the tool. It ends
 * by listing what stayed and the one line to remove the binary.
 *
 * Deliberately CLI-only, NOT an MCP tool: uninstalling the harness is a human's
 * decision, not something an agent should reach for mid-session. It refuses while
 * linked worktrees are still in flight, so it never pulls the wiring out from
 * under work in progress.
 */

import { dirname, join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { findRoot } from "../shared/env.ts";
import {
  type DiscernConfig,
  loadConfig,
  parseConfigOrThrow,
} from "../shared/config_schema.ts";
import {
  resolveBriefPath,
  resolveDocsDir,
  resolveGuidanceSeedRel,
  resolveRecipesDir,
  resolveSkillsDir,
  resolveTemplatesDir,
  resolveTodoPath,
} from "../lib/paths.ts";
import {
  allGuidanceFilePaths,
  allSkillsDirs,
  PROVIDERS,
  stripDiscernFromCodexConfig,
  stripDiscernFromCodexEnv,
  wiredMcp,
} from "../lib/providers.ts";
import { stripDiscernFromJsonSettings } from "../lib/settings_strip.ts";
import {
  DISCERN_GITIGNORE_BEGIN,
  DISCERN_GITIGNORE_END,
} from "../lib/agent_gitignore.ts";
import { listWorktreeFleet } from "../engine/worktree/git.ts";
import { confirmProceed } from "../lib/prompts.ts";

/** Options accepted by the `uninstall` command. */
export interface UninstallOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Skip the interactive confirmation (also auto-yes when non-interactive). */
  yes: boolean;
  /** Project root to operate on; defaults to walking up from the cwd. Tests pass
   * it directly so they never chdir the shared process. */
  cwd?: string | undefined;
}

/** One planned change to the project tree. */
interface RemovalOp {
  /** `delete` removes a discern-owned file/dir; `rewrite` strips discern's
   * entries from a co-owned file and keeps the user's. */
  action: "delete" | "rewrite";
  rel: string;
  isDir: boolean;
  reason: string;
  /** The stripped content to write, for a `rewrite`. */
  newText?: string | undefined;
}

/** A path uninstall deliberately keeps, with why. */
interface KeptItem {
  rel: string;
  why: string;
}

/** The computed, read-only uninstall plan. */
interface UninstallPlan {
  ops: RemovalOp[];
  kept: KeptItem[];
  /** Directories to remove if they empty out once their discern files are gone. */
  emptyDirCandidates: Set<string>;
  templatesAvailable: boolean;
}

/** The one line that removes the binary itself (install-method agnostic). */
const BINARY_HINT =
  "discern itself is a single binary outside your repo — remove it with your installer (e.g. `brew uninstall discern`) or by deleting the file `which discern` reports.";

async function pathExists(abs: string): Promise<boolean> {
  try {
    await Deno.lstat(abs);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function readTextIfExists(abs: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(abs);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Remove discern's delimited `.gitignore` block, preserving every other rule.
 * Returns the new text, `null` when the file held only the block (delete it), or
 * the text unchanged when no block is present.
 */
export function removeGitignoreBlock(text: string): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split(
    "\n",
  );
  const begin = lines.findIndex((l) => l.trim() === DISCERN_GITIGNORE_BEGIN);
  if (begin === -1) {
    return text;
  }
  let end = begin;
  for (let i = begin; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === DISCERN_GITIGNORE_END) {
      end = i;
      break;
    }
    end = i; // unterminated block: fall through to EOF
  }
  const kept = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  // Collapse the blank-line seam the removed block leaves behind, then trim.
  const collapsed: string[] = [];
  for (const line of kept) {
    const prev = collapsed[collapsed.length - 1];
    if (line.trim() === "" && (prev === undefined || prev.trim() === "")) {
      continue;
    }
    collapsed.push(line);
  }
  while (
    collapsed.length > 0 &&
    (collapsed[collapsed.length - 1] ?? "").trim() === ""
  ) {
    collapsed.pop();
  }
  if (collapsed.length === 0) {
    return null;
  }
  const out = `${collapsed.join("\n")}\n`;
  return eol === "\n" ? out : out.replaceAll("\n", eol);
}

/** Fold one co-owned-file strip result into an op (or nothing when unchanged). */
function pushCoOwnedOp(
  plan: UninstallPlan,
  rel: string,
  existing: string,
  stripped: string | null,
  reason: string,
): void {
  if (stripped === null) {
    plan.ops.push({ action: "delete", rel, isDir: false, reason });
    plan.emptyDirCandidates.add(dirname(rel));
    return;
  }
  if (stripped !== existing) {
    plan.ops.push({
      action: "rewrite",
      rel,
      isDir: false,
      reason,
      newText: stripped,
    });
  }
}

/**
 * Compute the uninstall plan by reading the tree — pure, no writes (ADR 0027).
 * Iterates the provider registry for everything discern wired, and the paths
 * registry for the user content it keeps.
 */
async function computeUninstallPlan(
  root: string,
  config: DiscernConfig,
): Promise<UninstallPlan> {
  const plan: UninstallPlan = {
    ops: [],
    kept: [],
    emptyDirCandidates: new Set<string>(),
    templatesAvailable: true,
  };
  const abs = (rel: string): string => join(root, rel);
  const noteDelete = (rel: string, isDir: boolean, reason: string): void => {
    plan.ops.push({ action: "delete", rel, isDir, reason });
    plan.emptyDirCandidates.add(dirname(rel));
  };

  // 1. Generated agent guidance files (gitignored, regenerable).
  for (const rel of allGuidanceFilePaths()) {
    if (await pathExists(abs(rel))) {
      noteDelete(rel, false, "generated agent guidance file");
    }
  }
  // 2. Materialized skills directories (gitignored, regenerable).
  for (const rel of allSkillsDirs()) {
    if (await pathExists(abs(rel))) {
      noteDelete(rel, true, "materialized skills directory");
    }
  }
  // 3. discern-owned provider files (whole files discern authored).
  for (const provider of Object.values(PROVIDERS)) {
    if (provider.projectRules !== undefined) {
      const rel = provider.projectRules.rulesFile;
      if (await pathExists(abs(rel))) {
        noteDelete(rel, false, "discern-owned project rules");
      }
    }
  }

  // 4. Co-owned integration files — strip discern's entries, keep the user's.
  // Collect each distinct file and which of discern's contributions it carries.
  const jsonJobs = new Map<
    string,
    { hasMcp: boolean; hooksTemplateRel?: string }
  >();
  const tomlMcpFiles = new Set<string>();
  const tomlEnvFiles = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    const mcp = wiredMcp(provider);
    if (mcp !== undefined) {
      const cf = mcp.configFile;
      if (cf.endsWith(".toml")) {
        tomlMcpFiles.add(cf);
      } else {
        const job = jsonJobs.get(cf) ?? { hasMcp: false };
        job.hasMcp = true;
        jsonJobs.set(cf, job);
      }
    }
    if (
      provider.hooks !== undefined &&
      provider.hooks.settingsFile.endsWith(".json")
    ) {
      const sf = provider.hooks.settingsFile;
      const job = jsonJobs.get(sf) ?? { hasMcp: false };
      job.hooksTemplateRel = sf;
      jsonJobs.set(sf, job);
    }
    if (provider.worktreeApp !== undefined) {
      tomlEnvFiles.add(provider.worktreeApp.configFile);
    }
  }

  let templatesDir: string | undefined;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch {
    templatesDir = undefined;
    plan.templatesAvailable = false;
  }

  for (const [rel, job] of jsonJobs) {
    const existing = await readTextIfExists(abs(rel));
    if (existing === undefined) {
      continue;
    }
    let hooksTemplateText: string | undefined;
    if (job.hooksTemplateRel !== undefined && templatesDir !== undefined) {
      hooksTemplateText = await readTextIfExists(
        join(templatesDir, `${job.hooksTemplateRel}.tmpl`),
      );
    }
    const stripped = stripDiscernFromJsonSettings(existing, {
      hasMcp: job.hasMcp,
      hooksTemplateText,
    });
    pushCoOwnedOp(plan, rel, existing, stripped, "co-owned agent settings");
  }
  for (const rel of tomlMcpFiles) {
    const existing = await readTextIfExists(abs(rel));
    if (existing === undefined) {
      continue;
    }
    const stripped = await stripDiscernFromCodexConfig(existing, root, config);
    pushCoOwnedOp(plan, rel, existing, stripped, "co-owned agent config");
  }
  for (const rel of tomlEnvFiles) {
    const existing = await readTextIfExists(abs(rel));
    if (existing === undefined) {
      continue;
    }
    const stripped = stripDiscernFromCodexEnv(existing);
    pushCoOwnedOp(
      plan,
      rel,
      existing,
      stripped,
      "co-owned worktree environment",
    );
  }

  // 5. The delimited `.gitignore` block.
  const gitignore = await readTextIfExists(abs(".gitignore"));
  if (gitignore !== undefined) {
    const stripped = removeGitignoreBlock(gitignore);
    pushCoOwnedOp(
      plan,
      ".gitignore",
      gitignore,
      stripped,
      "discern .gitignore block",
    );
  }

  // 6. The kept surface — the paths registry (all user content) plus the config.
  plan.kept.push({ rel: "discern.toml", why: "your discern configuration" });
  const keepIfExists = async (rel: string, why: string): Promise<void> => {
    if (await pathExists(abs(rel))) {
      plan.kept.push({ rel, why });
    }
  };
  await keepIfExists(resolveGuidanceSeedRel(config), "your guidance source");
  await keepIfExists(resolveDocsDir(root, config).rel, "the documentation map");
  await keepIfExists(
    resolveSkillsDir(root, config).rel,
    "your authored skills",
  );
  await keepIfExists(resolveRecipesDir(root, config).rel, "your recipes");
  await keepIfExists(resolveTodoPath(root, config).rel, "the work ledger");
  await keepIfExists(resolveBriefPath(root).rel, "the project brief");

  return plan;
}

/** Remove directories that emptied out once their discern files were gone,
 * walking up from each candidate. Never removes a non-empty directory, so user
 * content (a `.github/workflows/`, a `.claude/settings.json`) always survives. */
async function pruneEmptyDirs(
  root: string,
  candidates: Set<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const deepestFirst = [...candidates].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );
  for (let rel of deepestFirst) {
    while (rel !== "" && rel !== "." && !rel.startsWith("..")) {
      const dir = join(root, rel);
      let empty: boolean;
      try {
        empty = true;
        for await (const _entry of Deno.readDir(dir)) {
          empty = false;
          break;
        }
      } catch {
        break; // absent or not a directory
      }
      if (!empty) {
        break;
      }
      await Deno.remove(dir);
      removed.push(rel);
      rel = dirname(rel);
    }
  }
  return removed;
}

/** Apply the plan's removals and rewrites, then prune emptied directories. */
async function applyUninstallPlan(
  root: string,
  plan: UninstallPlan,
): Promise<void> {
  for (const op of plan.ops) {
    const target = join(root, op.rel);
    if (op.action === "delete") {
      await Deno.remove(target, op.isDir ? { recursive: true } : undefined);
    } else if (op.newText !== undefined) {
      await Deno.writeTextFile(target, op.newText);
    }
  }
  await pruneEmptyDirs(root, plan.emptyDirCandidates);
}

/** The `--json` / result payload for an uninstall plan. */
function planData(plan: UninstallPlan): Record<string, unknown> {
  return {
    removed: plan.ops.filter((o) => o.action === "delete").map((o) => o.rel),
    stripped: plan.ops.filter((o) => o.action === "rewrite").map((o) => o.rel),
    kept: plan.kept.map((k) => k.rel),
    binary_hint: BINARY_HINT,
  };
}

/** Render the human view of the plan (shared by dry-run and applied). */
function renderPlan(log: Logger, plan: UninstallPlan, applied: boolean): void {
  const deletes = plan.ops.filter((o) => o.action === "delete");
  const rewrites = plan.ops.filter((o) => o.action === "rewrite");

  log.heading(applied ? "Uninstalled discern" : "Uninstall plan (--dry-run)");
  if (deletes.length === 0 && rewrites.length === 0) {
    log.info("No discern wiring found here — nothing to remove.");
  }
  if (deletes.length > 0) {
    log.ok(applied ? "removed discern-generated files" : "would remove");
    for (const op of deletes) {
      log.detail(`${op.rel}${op.isDir ? "/" : ""} — ${op.reason}`);
    }
  }
  if (rewrites.length > 0) {
    log.ok(
      applied
        ? "stripped discern's entries from co-owned files (your settings kept)"
        : "would strip discern's entries from",
    );
    for (const op of rewrites) {
      log.detail(`${op.rel} — ${op.reason}`);
    }
  }

  log.line();
  log.heading("Kept — your content");
  for (const item of plan.kept) {
    log.detail(`${item.rel} — ${item.why}`);
  }

  log.line();
  if (applied) {
    log.info(BINARY_HINT);
  } else {
    log.info(
      "No files were changed (--dry-run). Re-run without --dry-run to apply.",
    );
  }
}

/** Run `discern uninstall`. Returns a process exit code. */
export async function runUninstall(options: UninstallOptions): Promise<number> {
  const log = new Logger(options);
  const startDir = options.cwd ?? Deno.cwd();

  const root = await findRoot(startDir);
  if (root === undefined) {
    const message =
      "no discern install here — nothing to uninstall. `uninstall` removes discern's wiring from a project it set up.";
    if (options.json) {
      log.result({
        ok: false,
        verb: "uninstall",
        error: "not_initialized",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // Refuse while linked worktrees are in flight — never pull the wiring out from
  // under work in progress, and never uninstall from a worktree rather than the
  // main checkout (do it from the trunk once the fleet is landed).
  const fleet = await listWorktreeFleet(root);
  const mainEntry = fleet.find((w) => w.isMain);
  const rootReal = await Deno.realPath(root).catch(() => root);
  if (mainEntry !== undefined && mainEntry.path !== rootReal) {
    const message =
      `run uninstall from the main checkout, not a linked worktree — it is at ${mainEntry.path}.`;
    if (options.json) {
      log.result({
        ok: false,
        verb: "uninstall",
        error: "not_main_checkout",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }
  const linked = fleet.filter((w) => !w.isMain);
  if (linked.length > 0) {
    const message =
      `refusing to uninstall while ${linked.length} linked worktree(s) are still active — land or remove them first, then uninstall from the main checkout.`;
    if (options.json) {
      log.result({
        ok: false,
        verb: "uninstall",
        error: "active_worktrees",
        message,
        data: { worktrees: linked.map((w) => w.path) },
      });
    } else {
      log.error(message);
      for (const w of linked) {
        log.detail(w.path);
      }
    }
    return 1;
  }

  // Load config (for the Codex writable-root recomputation and the kept-paths
  // resolution). A broken config still uninstalls — fall back to defaults.
  let config: DiscernConfig;
  try {
    config = await loadConfig(root);
  } catch {
    config = parseConfigOrThrow("");
  }

  const plan = await computeUninstallPlan(root, config);

  if (options.dryRun) {
    if (options.json) {
      log.result({
        ok: true,
        verb: "uninstall",
        dry_run: true,
        data: planData(plan),
      });
    } else {
      renderPlan(log, plan, false);
    }
    return 0;
  }

  // Confirm before removing anything discern created but git can't recover (the
  // gitignored generated files). Auto-yes when non-interactive or with --yes.
  if (!options.json && plan.ops.length > 0) {
    const proceed = await confirmProceed(
      "Remove discern's wiring from this project?",
      options.yes,
    );
    if (!proceed) {
      log.info("Aborted — nothing was changed.");
      return 0;
    }
  }

  await applyUninstallPlan(root, plan);

  if (options.json) {
    log.result({ ok: true, verb: "uninstall", data: planData(plan) });
  } else {
    renderPlan(log, plan, true);
  }
  return 0;
}
