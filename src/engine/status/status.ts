/**
 * `status` — the situation/orientation verb: *what is true right now, and what
 * should I do next?* (ADR 0033). It complements the two setup-facing verbs without
 * overlapping either: `doctor` answers "is it correctly installed?" (health),
 * `improvement` answers "what should get better next?" (quality, changes rarely), and `status`
 * answers "what changed and what now?" (situation, changes every commit) — so an
 * agent calls it reflexively at the start of a session.
 *
 * `status` is PURE OBSERVATION. It never runs the gate, runs tests, measures
 * standards, probes resource readiness, or creates/destroys anything. It does git
 * *reads*, file reads (`.env`, config), and identity derivation only — fast enough
 * to call reflexively. It reports what the gate WOULD fire and what CHANGED; it
 * never asserts a pass/fail it didn't verify.
 *
 * The view is LOCATION-AWARE (ADR 0033): from a linked worktree the default is the
 * local view (this worktree's own state); from the main checkout — with worktrees
 * enabled and at least one live worktree — it leads with main state and follows with
 * one task-labelled row per active worktree. `--all` adds the fleet from a worktree;
 * `--local` suppresses it from the main checkout.
 */

import { basename } from "@std/path";
import {
  type DiscernConfig,
  loadConfig,
  toCommandList,
} from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { observeResult } from "../../shared/result_capture.ts";
import {
  failureRecoveryHintTexts,
  fire,
  type FiredHint,
  fireOwnerAttention,
  HINTS,
  hintTexts,
} from "../../shared/hints.ts";
import {
  checkpointInspectionHints,
  inspectCheckpointObligations,
} from "../checkpoints/inspection.ts";
import type {
  GateProofCheckData,
  Location,
  StatusData,
  StatusFleetEntry,
  StatusGate,
  StatusGit,
  StatusWorktree,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import {
  findRoot,
  installedConfigRel,
  NO_PROJECT_MESSAGE,
  notInitializedResult,
} from "../../shared/env.ts";
import {
  setupProgress,
  setupUnfinishedHint,
} from "../../shared/setup_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import { classifyScopes, isScopeMarker } from "../scopes/scopes.ts";
import { planScopeGates } from "../gate/plan.ts";
import { readLandedProofNote } from "../gate/proof_notes.ts";
import {
  checkInstructionCurrent,
  type InstructionDriftEntry,
} from "../instruction_render.ts";
import {
  checkProviderHooksCurrent,
  type ProviderHookDriftEntry,
} from "../../lib/provider_hooks.ts";
import { Logger } from "../../lib/log.ts";
import { checkSkillsCurrent, type SkillsDriftEntry } from "../../lib/skills.ts";
import { type AdrIndexState, adrIndexState } from "../../lib/adr_index.ts";
import { type TerminalContext, terminalContext } from "../../lib/terminal.ts";
import {
  type TrackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifactsHint,
  untrackedInstructionFiles,
  untrackedInstructionFilesHint,
} from "../../lib/agent_gitignore.ts";
import {
  type AdrNumberCollision,
  adrNumberCollisions,
  assertMainMerged,
  detectSilentDivergence,
  type FleetCollision,
  fleetCollisions,
  type FleetWorktree,
  forkPoints,
  gitSnapshot,
  hasUncommittedTrackedChanges,
  incomingOverlap,
  listWorktreeFleet,
  localBranchExists,
  mainRepoPath,
  prefixBranches,
  resolveCommonGitDir,
  unlandedPrefixBranches,
  worktreeGitKey,
} from "../worktree/git.ts";
import { ADR_SUBDIR } from "../../lib/adr_numbers.ts";
import {
  deriveIdentity,
  IdentityError,
  type IdentitySettings,
  loadIdentitySettings,
  resolveIdentity,
  resolveWorktreeId,
} from "../worktree/identity.ts";
import { readResourceSpecs, resourceEnvName } from "../worktree/resources.ts";
import {
  containedRefPointers,
  containmentIdleCheck,
  scanContainedWorktrees,
} from "../worktree/containment.ts";
import { readEnvValueAcross, stripQuotes } from "../worktree/env_file.ts";
import { makeOut } from "../output.ts";
import { inspectGateProof } from "../gate/proof.ts";
import { isLandingCandidate, isReadyToLand } from "../worktree/readiness.ts";
import { addAdvisoryHints } from "../logbook/routing.ts";
import {
  inlineFindingRoutes,
  statusFindingHints,
} from "../logbook/surfaces.ts";
import {
  inspectLandingAuthority,
  landingAuthorityProjection,
  type LandingAuthorityResolution,
} from "../worktree/landing_authority.ts";
import { configEpoch } from "../logbook/epoch.ts";
import {
  type BranchLogbookActivity,
  type DurationPrior,
  type FleetLogbookActivity,
  readFleetLogbookActivity,
} from "../logbook/read.ts";
import {
  idleDaysOf,
  renderStatusDashboard,
  STALE_WORKTREE_DAYS,
} from "./tty.ts";
import {
  planTrackedRefresh,
  type TrackedRefreshPlan,
} from "../tracked_refresh.ts";
import {
  type ReappearedWorktreePath,
  reappearedWorktreePaths,
} from "../worktree/retired_paths.ts";

export { idleDaysOf, relativeAge, STALE_WORKTREE_DAYS } from "./tty.ts";

/** How many overlapping paths the behind-report lists inline (a sample; the hint
 * carries the true count). The intersection is usually small, so this rarely caps. */
const STATUS_OVERLAP_CAP = 20;

/** Flags accepted by `status` on both surfaces. */
export interface StatusOptions {
  /** Include the fleet survey even from a worktree (a worktree surveying its siblings). */
  all?: boolean;
  /** Local view only — suppress the fleet survey even in the main checkout. */
  local?: boolean;
  /** Request the complete structured wire projection instead of orientation. */
  verbose?: boolean;
  /** One effect-boundary clock shared by collection, hints, and presentation. */
  nowMs?: number;
}

/** CLI presentation flags. `verbose` also selects the full structured wire
 * projection when the result crosses a JSON or MCP boundary. */
export interface StatusRenderOptions {
  verbose?: boolean;
  terminal?: TerminalContext;
  nowMs: number;
}

// ── the `data` payload shapes ──────────────────────────────────────────────────
// The wire contract (discriminated by `location` and the presence of `fleet`) lives
// as Zod schemas in `result_schemas.ts` — the SSOT the MCP `outputSchema` advertises.
// Typing this core's `data` (and its sub-blocks) as the inferred types means any
// drift from the schema is a compile error.

// ── the result core (the single source the CLI and the MCP tool both render) ────

/** Committer timestamp for one landed proof subject, when Git can read it. */
async function landedCommitAt(
  root: string,
  commit: string,
): Promise<string | undefined> {
  const shown = await runGit(["show", "-s", "--format=%cI", commit], {
    cwd: root,
  });
  const value = shown.stdout.trim();
  return shown.success && value !== "" && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

/**
 * Compute the `status` {@link DiscernResult} — pure observation, no mutation. The
 * one entry point the MCP server renders and the CLI's `--json` serializes; neither
 * re-derives anything. `ok` is true for any successful observation (a dirty worktree
 * or a branch behind main is still a successful `status`, not a failure) — `ok:false`
 * is reserved for an operational refusal (conflicting flags). `root` is used as the
 * cwd for every git read and identity derivation, matching the other verb cores.
 */
export async function statusResult(
  root: string,
  opts: StatusOptions = {},
): Promise<DiscernResult<StatusData>> {
  const nowMs = opts.nowMs ?? Date.now();
  const all = opts.all ?? false;
  const local = opts.local ?? false;
  if (all && local) {
    return {
      ok: false,
      verb: "status",
      error: "invalid_arguments",
      message: "--all and --local cannot be combined — pick one.",
      hints: failureRecoveryHintTexts("status"),
    };
  }

  const cfg = await loadConfig(root);
  const mainBranch = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk) ||
    cfg.repository.trunk;

  // Location: a linked worktree has its own git admin dir (worktreeGitKey defined);
  // the main checkout (or no git repo) does not.
  const gitKey = await worktreeGitKey(root);
  const location: Location = gitKey !== undefined ? "worktree" : "main";
  const snap = await gitSnapshot(root, mainBranch);

  // The git block — read-only; null when this isn't a git repo or its status
  // cannot be read (degrade, don't throw).
  let git: StatusGit | null = null;
  // The hot zone, when this worktree is behind: the files it changed that the incoming
  // main also changed. Captured for both the git block and the behind hint.
  let overlapInfo: { overlap: string[]; total: number } | undefined;
  let mergeWarning: FiredHint | undefined;
  if (snap !== undefined) {
    // Reuse the canonical main-merged check for the behind/null distinction: it
    // self-skips (→ null) in the main checkout or with no local integration branch.
    const merged = await assertMainMerged(root, mainBranch);
    const behind = merged.kind === "skipped"
      ? null
      : merged.kind === "missing"
      ? null
      : merged.kind === "merged"
      ? 0
      : Number(merged.behind) || 0;
    if (merged.kind === "missing") {
      mergeWarning = fire(HINTS["missing-trunk-branch"], {
        branch: merged.branch,
      });
    }
    // Compute the overlap only when behind in a worktree — the agent sees which of its
    // own work main is about to touch BEFORE updating. Read-only; never merges.
    if (location === "worktree" && behind !== null && behind > 0) {
      const o = await incomingOverlap(root, mainBranch, STATUS_OVERLAP_CAP);
      if (o.total > 0) {
        overlapInfo = o;
      }
    }
    // With no local integration branch there is nothing to count "ahead" against —
    // report an honest null, never a fabricated 0.
    const trunkExists = await localBranchExists(root, mainBranch);
    git = {
      branch: snap.branch,
      trunk: mainBranch,
      clean: snap.clean,
      changed_files: snap.changedFiles,
      behind_trunk: behind,
      ahead_trunk: trunkExists ? snap.ahead : null,
      ...(overlapInfo !== undefined
        ? { incoming_overlap: overlapInfo.overlap }
        : {}),
    };
  }

  // The worktree identity block — only inside a linked worktree.
  const worktree = location === "worktree"
    ? await buildWorktreeBlock(root, cfg)
    : null;

  // Fleet decision. The fleet is only worth surveying from the main checkout (the
  // supervisor view) or when a worktree explicitly asks via --all — so a plain
  // local worktree view never pays for it. The survey is read-only either way.
  const wantFleet = all || location === "main";
  const fleetRows = wantFleet ? await listWorktreeFleet(root, mainBranch) : [];
  const liveCount = fleetRows.filter((w) => !w.isMain).length;
  const includeFleet = all
    ? true
    : local
    ? false
    : location === "main" && liveCount >= 1;
  // "Fleet-led" — the main-checkout supervisor view that leads with the fleet and
  // omits the heavy local-only blocks. A worktree with --all keeps its local blocks
  // AND gains the fleet, so it is not fleet-led.
  const fleetLed = includeFleet && location === "main";

  const data: StatusData = {
    location,
    root,
    project: cfg.project.slug,
    worktree,
    git,
    standards: Object.keys(cfg.standards),
  };
  const reappearedPaths = await reappearedWorktreePaths(root);
  if (reappearedPaths.length > 0) {
    data.reappeared_worktree_paths = reappearedPaths.map((entry) => ({
      ...entry,
      contents: [...entry.contents],
    }));
  }
  const landedProof = await readLandedProofNote(root, mainBranch);
  if (landedProof.status === "valid") {
    const { status: _status, ...note } = landedProof;
    const commitAt = await landedCommitAt(root, note.commit);
    data.landed_proof = {
      ...note,
      ...(commitAt === undefined ? {} : { commit_at: commitAt }),
    };
  } else if (landedProof.status === "unsupported") {
    const { status: _status, ...unread } = landedProof;
    data.landed_proof_unsupported = unread;
  }
  const gateProof = location === "worktree"
    ? await inspectGateProof(root)
    : undefined;
  if (gateProof !== undefined) {
    data.gate_proof = gateProof;
  }
  const landingAuthority = location === "worktree"
    ? await inspectLandingAuthority(root, mainBranch)
    : undefined;
  const authorityProjection = landingAuthority === undefined
    ? undefined
    : landingAuthorityProjection(landingAuthority);
  if (authorityProjection !== undefined) {
    data.landing_authority = authorityProjection;
  }

  // Local-only heavy blocks: the changed scopes and what the gate would fire.
  let changed: string[] | undefined;
  if (!fleetLed) {
    changed = await classifyScopes(root, cfg);
    data.scopes = changed;
    data.gate = buildGateBlock(cfg, changed);
  }

  // Generated-artifacts currency (ADR 0034): a cheap read-only check that the agent
  // files match what `discern refresh` would write. Advisory only here — surfaced as
  // a hint so a drifted or not-yet-built AGENTS.md is noticed at orientation, never
  // an unverified pass/fail.
  const instructionDrift: InstructionDriftEntry[] =
    await checkInstructionCurrent(
      root,
      cfg,
    );
  if (instructionDrift.length > 0) {
    data.stale_generated = instructionDrift.map((d) => d.path);
  }

  // The same read-only currency check, for the MATERIALIZED skills (ADR 0034,
  // extended to skills). Advisory here, like `stale_generated`: a drifted or
  // not-yet-materialized skills dir is noticed at orientation. Reports the
  // affected skill paths (dir/name), `missing` dirs included.
  const skillsDrift: SkillsDriftEntry[] = await checkSkillsCurrent(root, cfg);
  {
    // Report only `missing`/`stale` (parallel to `stale_generated` for instructions) — a
    // `foreign` drop-in is NOT discern's to fix (the materializer leaves it and warns),
    // so listing it under a `stale_`-named field would tell an agent to "refresh" a
    // file a refresh won't touch. It is intentionally absent from the structured field.
    const reportable = skillsDrift.filter((d) => d.reason !== "foreign");
    if (reportable.length > 0) {
      data.stale_materialized = reportable.map((d) =>
        d.name === "" ? d.dir : `${d.dir}/${d.name}`
      );
    }
  }

  // Provider integration currency. Hook files are provider-owned settings that
  // `discern refresh` re-seeds through registry-declared merge strategies. Surface
  // missing/stale hook files during orientation just like generated instructions and
  // materialized skills, but keep status read-only.
  const providerHookDrift = await checkProviderHooksCurrent(root, cfg);
  if (providerHookDrift.length > 0) {
    data.stale_integrations = providerHookDrift.map((d) => d.path);
  }

  // The maintained ADR index — the same read-only currency shape, for the
  // record lists a refresh keeps between markers in the ADR README. Advisory
  // here, like the other stale_* fields; only `stale` is reported (`absent`
  // means the project has not adopted the index, and `invalid` is a source
  // problem the gate diagnoses with the offending record).
  const adrIndex: AdrIndexState = await adrIndexState(root, cfg.map.dir);
  if (adrIndex.kind === "stale") {
    data.stale_adr_index = [adrIndex.path];
  }

  // The complete read-only tracked-refresh plan. Focused stale_* projections
  // above remain for compatibility and richer hints; this field is the one
  // authoritative answer to "would refresh change a tracked file?".
  const trackedRefreshPlan = await planTrackedRefresh(root, cfg);
  if (trackedRefreshPlan.changes.length > 0) {
    data.pending_tracked_refresh = trackedRefreshPlan.changes.map((change) =>
      change.path
    );
  }
  if (trackedRefreshPlan.errors.length > 0) {
    data.tracked_refresh_plan_errors = [...trackedRefreshPlan.errors];
  }

  const trackedIgnoredArtifacts = await trackedDiscernIgnoredArtifacts(root);
  if (trackedIgnoredArtifacts.paths.length > 0) {
    data.tracked_ignored_artifacts = trackedIgnoredArtifacts.paths;
  }

  // Compiled instruction files sitting untracked (and not ignored) — the state an
  // upgraded install lands in once the managed ignore block narrows. Status is
  // the surface for this (not doctor): nothing is misconfigured, it is the
  // every-session orientation nudge until the one-time commit clears it.
  const untrackedInstructions = await untrackedInstructionFiles(root);

  // One-time setup state (ADR 0036). Until `[meta].bootstrapped` is recorded the
  // project is mid-setup and the agent must finish it — surfaced loudly (a banner,
  // a lead hint) so a half-done setup isn't mistaken for a finished one. Walk for
  // leftover skeleton markers only when it could be unfinished (`bootstrapped` is
  // the cheap gate — a finished project never pays for the walk). Present in `data`
  // only while outstanding, mirroring `stale_generated`.
  let setupPending: string[] | undefined;
  if (!cfg.meta.bootstrapped) {
    // Derived progress (ADR 0075): the markers still pending PLUS which known jobs
    // are wired — both read from the tree, unfakeable, so a half-done setup shows
    // what's left rather than relying on a self-reported step.
    const progress = await setupProgress(root, cfg);
    setupPending = progress.pendingMarkers;
    data.setup_unfinished = {
      pending_markers: progress.pendingMarkers,
      known_jobs: progress.knownJobs,
    };
  }

  // In-flight `<branch_prefix>` branches, read once for both cross-branch
  // scans below (changed-file collisions, ADR number collisions), whose
  // fork-point anchors are likewise resolved once for their union.
  const inFlightBranches = includeFleet || location === "worktree"
    ? await prefixBranches(root, cfg.repository.branch_prefix)
    : [];
  let sharedForkPoints: Map<string, string> | undefined;

  // The fleet survey, each row augmented with its id/port — read from its env
  // files when recorded, else DERIVED from the worktree's own identity, so a
  // project with no env file still gets real ids (never a truncated branch name).
  let fleet: StatusFleetEntry[] | undefined;
  let fleetCollisionPairs: FleetCollision[] | undefined;
  if (includeFleet) {
    // Canonicalize the invocation root once so each row's is_current compares like
    // for like against row.path (also canonical).
    const here = await Deno.realPath(root).catch(() => root);
    const settings = await loadIdentitySettings(root).catch(() => undefined);
    let logbookActivity: FleetLogbookActivity | undefined;
    if (cfg.project.logbook) {
      const commonGitDir = await resolveCommonGitDir(root);
      if (commonGitDir !== undefined) {
        logbookActivity = await readFleetLogbookActivity(
          commonGitDir,
          configEpoch(cfg).fingerprint,
          nowMs,
        );
      }
    }
    fleet = await Promise.all(
      fleetRows.map(async (row) => {
        const entry = await fleetEntryFor(row, here, cfg, settings);
        return applyLogbookActivity(
          entry,
          logbookActivity?.byBranch.get(row.branch),
          logbookActivity?.durationPriors,
          nowMs,
        );
      }),
    );
    // The containment fact, carried as advisory colour: a row whose committed
    // work travels inside a live sibling branch (the spent early stage of a
    // `start --from` train) names its container. The desk reads this to offer
    // the human-confirmed reclaim; nothing acts on it here.
    if (fleet.some((e) => !e.is_main)) {
      const contained = await scanContainedWorktrees(root, {
        mainBranch,
        currentPath: here,
        fleet: fleetRows,
        idle: containmentIdleCheck(logbookActivity, nowMs),
      });
      for (const fact of contained) {
        const row = fleet.find((e) => e.path === fact.path);
        if (row !== undefined) {
          row.contained_in = fact.containingBranch;
        }
      }
    }
    data.fleet = fleet;
    // Cross-worktree changed-file collisions — the one fleet fact no single
    // row can carry: pairs of efforts whose fork diffs touch the same paths.
    const collisionBranches = fleet
      .filter((e) =>
        !e.is_main && e.broken !== true && e.git_unavailable !== true &&
        e.branch !== ""
      )
      .map((e) => e.branch);
    if (collisionBranches.length >= 2) {
      sharedForkPoints = await forkPoints(
        root,
        [...collisionBranches, ...inFlightBranches],
        mainBranch,
      );
      const collisions = await fleetCollisions(
        root,
        collisionBranches,
        mainBranch,
        STATUS_OVERLAP_CAP,
        sharedForkPoints,
      );
      if (collisions.length > 0) {
        data.fleet_collisions = collisions;
        fleetCollisionPairs = collisions;
      }
    }
  }

  // Unlanded `<branch_prefix>*` branches with NO worktree — abandoned work that
  // would otherwise be invisible (its worktree is gone, prune keeps unmerged
  // branches, and nothing else lists it). Main-checkout (supervisor) view only.
  // A ref whose tip is contained in a live branch is NOT abandoned: it is a
  // spent train stage the reclaim kept deliberately, riding inside its
  // container until landing — reported as a calm fact, never as work to
  // resume.
  let unlandedBranches: string[] | undefined;
  let containedRefs:
    | Array<{ branch: string; contained_in: string }>
    | undefined;
  if (location === "main") {
    const found = await unlandedPrefixBranches(
      root,
      cfg.repository.branch_prefix,
      mainBranch,
    );
    if (found.length > 0) {
      const containers = await containedRefPointers(root, found, mainBranch);
      const dangling = found.filter((b) => !containers.has(b));
      if (dangling.length > 0) {
        unlandedBranches = dangling;
        data.unlanded_branches = dangling;
      }
      if (containers.size > 0) {
        containedRefs = [...containers.entries()].map((
          [branch, contained_in],
        ) => ({ branch, contained_in }));
        data.contained_refs = containedRefs;
      }
    }
  }

  // In-flight ADR number collisions — number-keyed where the changed-file scan
  // above is path-keyed: two efforts that each picked the next free record
  // number added DIFFERENT files, so no path intersects and both merge cleanly;
  // the gate refuses the duplicate only once both records sit in one tree. The
  // universe is every `<branch_prefix>` branch (worktree-backed and unlanded
  // alike — the second claimant is often a parked branch with no worktree). The
  // local worktree view keeps only collisions involving THIS branch: they are
  // the ones this session can renumber its way out of.
  let adrCollisions: AdrNumberCollision[] | undefined;
  if (includeFleet || location === "worktree") {
    if (inFlightBranches.length >= 2) {
      const adrDir = `${cfg.map.dir.replace(/\/+$/, "")}/${ADR_SUBDIR}`;
      let found = await adrNumberCollisions(
        root,
        inFlightBranches,
        mainBranch,
        adrDir,
        sharedForkPoints,
      );
      if (!includeFleet) {
        const branch = git?.branch ?? "";
        found = found.filter((c) => c.branches.includes(branch));
      }
      if (found.length > 0) {
        adrCollisions = found;
        data.adr_collisions = found;
      }
    }
  }

  // Silent divergence (worktree view): this worktree is pristine while the main
  // checkout accumulates changes — the signature of edits landing on the trunk
  // while the gate runs here. One wording, shared with `done`.
  const divergence = location === "worktree"
    ? await detectSilentDivergence(root, mainBranch)
    : undefined;

  // The checkpoint obligation inspection (one seam shared with `prepare`,
  // `checkpoints`, and both `done` paths): serve each required stop question
  // early. Suppressed while setup is unfinished — the lead hint owns that
  // session, and no governing policy exists to inspect yet.
  const checkpointPreview = setupPending === undefined
    ? checkpointInspectionHints(await inspectCheckpointObligations(root, cfg))
    : [];

  const hints = await buildStatusHints({
    root,
    location,
    mainBranch,
    git,
    changed,
    incomingOverlap: overlapInfo,
    mergeWarning,
    divergence,
    unlandedBranches,
    containedRefs,
    reappearedWorktreePaths: reappearedPaths,
    fleet,
    fleetCollisions: fleetCollisionPairs,
    adrCollisions,
    liveCount,
    instructionDrift,
    skillsDrift,
    providerHookDrift,
    adrIndex,
    trackedRefreshPlan,
    trackedIgnoredArtifacts,
    untrackedInstructions,
    setupPending,
    nowMs,
    gateProof,
    landingAuthority,
    logbookEnabled: cfg.project.logbook,
    checkpointPreview,
  });
  if (opts.verbose !== true) {
    hints.push(fire(HINTS["status-full-structured-detail"]));
  }
  const result: DiscernResult<StatusData> = {
    ok: true,
    verb: "status",
    data,
    ...(opts.verbose === true ? { wireProjection: "full" as const } : {}),
    ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
  };
  // Setup owns the session until bootstrapping completes. Afterwards, append
  // only session-routed inline findings for this branch; detector scoring has
  // already removed interactive human runs and CI noise from their population.
  if (setupPending === undefined) {
    const routes = await inlineFindingRoutes(root, cfg);
    addAdvisoryHints(
      result,
      statusFindingHints(routes.status, git?.branch),
    );
  }
  return result;
}

/** Resolve a worktree's identity block, degrading to null if identity can't be
 * resolved (e.g. an empty slug) rather than crashing the read-only verb. */
async function buildWorktreeBlock(
  root: string,
  cfg: DiscernConfig,
): Promise<StatusWorktree | null> {
  let identity;
  try {
    identity = await resolveIdentity(root, root);
  } catch (e) {
    if (e instanceof IdentityError) {
      return null;
    }
    throw e;
  }
  return {
    id: identity.id,
    branch: identity.branch,
    site: identity.site,
    port: identity.port,
    db: identity.db,
    resources: await readWorktreeResources(root, cfg),
  };
}

/** The resource handles ACTUALLY recorded in this worktree's env files (what was
 * provisioned), not the derived set — a resource not yet created has no env
 * entry and is honestly absent. Reads only; never creates a file or a resource. */
async function readWorktreeResources(
  root: string,
  cfg: DiscernConfig,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const specs = readResourceSpecs(cfg);
  if (specs.length === 0) {
    return out;
  }
  for (const spec of specs) {
    const raw = await readEnvValueAcross(
      root,
      cfg.worktree.env_files,
      resourceEnvName(spec.name),
    );
    const value = raw === undefined ? undefined : stripQuotes(raw.trim());
    if (value !== undefined && value !== "") {
      out[spec.name] = value;
    }
  }
  return out;
}

/** Augment a cheap fleet row with the worktree's id/port — the recorded values
 * from its env files when present, else DERIVED from the worktree's own identity
 * (an env-file-less project still gets real ids, never a truncated branch-name
 * fallback) — and its viability: a checkout with NO project config at its root
 * (the signature of a creation that crashed mid-checkout) is flagged `broken`,
 * not listed as a healthy member. A hand-made `git worktree add` checkout
 * carries the tracked config and stays healthy. */
async function fleetEntryFor(
  row: FleetWorktree,
  here: string,
  cfg: DiscernConfig,
  settings: IdentitySettings | undefined,
): Promise<StatusFleetEntry> {
  const entry: StatusFleetEntry = {
    path: row.path,
    is_main: row.isMain,
    // Occupancy, not git state: the row the call is rooted in. `row.path` is already
    // canonical (realPathOr in listWorktreeFleet); `here` is canonicalized to match.
    is_current: row.path === here,
    branch: row.branch,
  };
  if (row.snapshot !== undefined) {
    entry.clean = row.snapshot.clean;
    entry.changed_files = row.snapshot.changedFiles;
    entry.ahead = row.snapshot.ahead;
    entry.behind = row.snapshot.behind;
    if (row.snapshot.lastActivity !== undefined) {
      entry.last_activity = new Date(row.snapshot.lastActivity * 1000)
        .toISOString();
    }
  } else {
    // Git could not run inside the checkout — its state is unknown, and the
    // honest report is "unknown", never a fabricated clean/0-ahead row.
    entry.git_unavailable = true;
  }
  if (!row.isMain && (await installedConfigRel(row.path)) === undefined) {
    entry.broken = true;
  }
  // The row's complete gate-proof state, read from its own marker — inspected
  // HERE, once, so the dashboard, ready hints, and wire fields cannot disagree.
  // An honored row also carries the compatibility page and line fields.
  if (!row.isMain && entry.broken !== true && entry.git_unavailable !== true) {
    const proof = await inspectGateProof(row.path);
    entry.gate_proof = proof;
    if (proof.status === "honored") {
      entry.proof_honored = true;
      if (proof.proof !== undefined) {
        entry.proof = proof.proof;
      }
      if (proof.proof_line !== undefined) {
        entry.proof_line = proof.proof_line;
      }
    }
    const authority = landingAuthorityProjection(
      await inspectLandingAuthority(row.path, cfg.repository.trunk),
    );
    if (authority !== undefined) {
      entry.landing_authority = authority;
    }
  }
  const files = cfg.worktree.env_files;
  const recordedId = await readEnvValueAcross(
    row.path,
    files,
    DISCERN_ENVIRONMENT_VARIABLES.worktreeId,
  );
  if (recordedId !== undefined && recordedId.trim() !== "") {
    entry.id = stripQuotes(recordedId.trim());
  }
  const recordedPort = await readEnvValueAcross(
    row.path,
    files,
    DISCERN_ENVIRONMENT_VARIABLES.worktreePort,
  );
  if (recordedPort !== undefined && /^\d+$/.test(recordedPort.trim())) {
    entry.port = Number(recordedPort.trim());
  }
  // Derivation fallback: identity is structured state, not filesystem shape — a
  // worktree with no env file still has an id (and, with [worktree].port on, a
  // deterministic port).
  if (!row.isMain && settings !== undefined) {
    if (entry.id === undefined || entry.port === undefined) {
      const id = await resolveWorktreeId(settings, row.path).catch(() =>
        undefined
      );
      if (id !== undefined) {
        entry.id ??= id;
        if (entry.port === undefined && cfg.worktree.port) {
          entry.port = deriveIdentity(id, settings).port;
        }
      }
    }
  }
  return entry;
}

/** Later of 2 ISO timestamps, preserving the available value when only one parses. */
function latestActivity(
  gitAt: string | undefined,
  logbookAt: string | undefined,
): string | undefined {
  if (gitAt === undefined) {
    return logbookAt;
  }
  if (logbookAt === undefined) {
    return gitAt;
  }
  const gitMs = Date.parse(gitAt);
  const logbookMs = Date.parse(logbookAt);
  if (Number.isNaN(logbookMs)) {
    return gitAt;
  }
  if (Number.isNaN(gitMs)) {
    return logbookAt;
  }
  return logbookMs > gitMs ? logbookAt : gitAt;
}

/** Join one fleet row to the bounded logbook read for its branch. */
function applyLogbookActivity(
  entry: StatusFleetEntry,
  activity: BranchLogbookActivity | undefined,
  durationPriors: ReadonlyMap<string, DurationPrior> | undefined,
  nowMs: number,
): StatusFleetEntry {
  if (activity === undefined) {
    return entry;
  }
  entry.last_activity = latestActivity(
    entry.last_activity,
    activity.lastEventAt,
  );
  if (activity.lastAction !== undefined) {
    entry.last_action = {
      verb: activity.lastAction.verb,
      outcome: activity.lastAction.outcome,
      at: activity.lastAction.at,
      ...(activity.lastAction.failedStage !== undefined
        ? { failed_stage: activity.lastAction.failedStage }
        : {}),
    };
  }
  if (activity.running !== undefined) {
    const startedMs = Date.parse(activity.running.started);
    const typical = durationPriors?.get(activity.running.verb)?.medianMs;
    entry.running = {
      verb: activity.running.verb,
      started: activity.running.started,
      elapsed_ms: Number.isNaN(startedMs) ? 0 : Math.max(0, nowMs - startedMs),
      ...(typical !== undefined ? { typical_duration_ms: typical } : {}),
    };
  }
  return entry;
}

/** What the gate would fire: the wired declared jobs and the scope gates the current
 * change triggers — reusing the gate's own
 * scope-gate selection (`planScopeGates`) so status and `done` agree. */
function buildGateBlock(cfg: DiscernConfig, changed: string[]): StatusGate {
  const jobs = Object.entries(cfg.jobs)
    .filter(([, value]) => toCommandList(value).length > 0)
    .map(([name]) => name);
  const scope_gates = planScopeGates(cfg, changed)
    .filter((j) => j.willRun)
    .map((j) => j.label.replace(/^scope:/, ""));
  return { jobs, scope_gates };
}

// ── hints (advisory next-steps; never an unverified pass/fail) ───────────────────

/** Everything the hint builder reads — assembled once so the hints can't drift from
 * the reported data. */
interface HintContext {
  root: string;
  location: Location;
  mainBranch: string;
  git: StatusGit | null;
  changed: string[] | undefined;
  /** The hot zone when behind: the branch's own files the incoming main also changed
   * (capped list + true total). Drives the overlap clause on the behind hint. */
  incomingOverlap: { overlap: string[]; total: number } | undefined;
  /** Warning when the configured integration branch is absent locally. */
  mergeWarning: FiredHint | undefined;
  /** The silent-divergence warning (pristine worktree, dirty main checkout). */
  divergence: FiredHint | undefined;
  /** Genuinely dangling `<branch_prefix>*` branches with no worktree (main
   * view only) — contained refs are excluded before this list is built. */
  unlandedBranches: string[] | undefined;
  /** Reclaimed-stage refs riding inside live branches (main view only). */
  containedRefs: Array<{ branch: string; contained_in: string }> | undefined;
  /** Removed worktree paths currently present again. */
  reappearedWorktreePaths: readonly ReappearedWorktreePath[];
  fleet: StatusFleetEntry[] | undefined;
  /** Cross-worktree changed-file collisions (fleet view; hint fodder — the
   * rows themselves ride `data.fleet_collisions`). */
  fleetCollisions: FleetCollision[] | undefined;
  /** In-flight ADR number collisions (both views; the rows ride
   * `data.adr_collisions`). */
  adrCollisions: AdrNumberCollision[] | undefined;
  liveCount: number;
  /** Agent files that don't match what `discern refresh` would write. */
  instructionDrift: InstructionDriftEntry[];
  /** Materialized skills that don't match the effective set a refresh would place. */
  skillsDrift: SkillsDriftEntry[];
  /** Provider hook files that don't match the configured integration seed. */
  providerHookDrift: ProviderHookDriftEntry[];
  /** How the maintained ADR index stands against the record files on disk. */
  adrIndex: AdrIndexState;
  /** Complete read-only plan for refresh-managed tracked files. */
  trackedRefreshPlan: TrackedRefreshPlan;
  /** Discern-owned ignored artifacts currently tracked by Git. */
  trackedIgnoredArtifacts: TrackedDiscernIgnoredArtifacts;
  /** Compiled instruction files untracked and not ignored — commit recommended. */
  untrackedInstructions: string[];
  /** Scaffolded files still carrying skeleton markers while setup is unfinished;
   * undefined once `[meta].bootstrapped` is recorded. Drives the lead setup hint. */
  setupPending: string[] | undefined;
  /** The invocation clock already captured by the status effect boundary. */
  nowMs: number;
  /** Whether the current clean HEAD has an honored proof from `discern done`. */
  gateProof: GateProofCheckData | undefined;
  /** The current branch's authority, from the one resolver used by acceptance. */
  landingAuthority: LandingAuthorityResolution | undefined;
  /** Whether logbook-backed fleet activity can be read. */
  logbookEnabled: boolean;
  /** The checkpoint obligation's advisory projection (shared with `prepare`
   * and both `done` paths): each required stop question, served early. Empty
   * while setup is unfinished. */
  checkpointPreview: FiredHint[];
}

/**
 * The advisory "what next" lines. Honest by construction: every line is an
 * observation plus a suggested command, never a claim that the gate passed.
 */
async function buildStatusHints(ctx: HintContext): Promise<FiredHint[]> {
  const hints: FiredHint[] = [];
  const main = ctx.mainBranch;

  // Setup not finished — the most fundamental "what now", so it leads every other
  // hint, in every location. The structured evidence is `data.setup_unfinished`;
  // this is its advisory voice.
  if (ctx.setupPending !== undefined) {
    hints.push(setupUnfinishedHint(ctx.setupPending));
  }
  if (ctx.mergeWarning !== undefined) {
    hints.push(ctx.mergeWarning);
  }
  // Silent divergence — the pristine-worktree / dirty-main signature. Loud and
  // early: every later hint assumes the work is happening where the tools point.
  if (ctx.divergence !== undefined) {
    hints.push(ctx.divergence);
  }
  if (ctx.reappearedWorktreePaths.length > 0) {
    hints.push(
      fireOwnerAttention(HINTS["status-reappeared-worktree-paths"], {
        total: ctx.reappearedWorktreePaths.length,
      }),
    );
  }

  if (ctx.trackedIgnoredArtifacts.paths.length > 0) {
    hints.push(trackedDiscernIgnoredArtifactsHint(ctx.trackedIgnoredArtifacts));
  }

  // Tracked-by-default posture: recommend the one-time commit that puts the
  // compiled instructions in reach of agents reading a bare clone. Only fires while
  // the files are untracked AND not ignored, so a project that deliberately
  // ignores them in its own rules is never nagged. Skipped mid-setup — the
  // setup flow's own scaffolding commit captures them.
  if (ctx.untrackedInstructions.length > 0 && ctx.setupPending === undefined) {
    hints.push(untrackedInstructionFilesHint(ctx.untrackedInstructions));
  }

  // Agent files drifted from their source — actionable anywhere, so lead
  // with it. "missing" (not built yet) reads differently from "stale" (a drift that
  // a refresh would overwrite), so the redirect to the source only shows for stale.
  if (ctx.instructionDrift.length > 0) {
    const paths = ctx.instructionDrift.map((d) => d.path).join(", ");
    const allMissing = ctx.instructionDrift.every((d) =>
      d.reason === "missing"
    );
    hints.push(
      allMissing
        ? fire(HINTS["generated-agent-files-missing"], { paths })
        : fire(HINTS["generated-agent-files-stale"], { paths }),
    );
  }

  // Materialized skills drifted from the effective set — the same advisory shape as
  // instructions. `missing`/`foreign` (a not-yet-built dir, an unmanaged drop-in) read
  // differently from `stale` (a drift a refresh overwrites), so only stale gets the
  // edit-the-source redirect; foreign is surfaced but never presented as fixable.
  const realSkillsDrift = ctx.skillsDrift.filter((d) => d.reason !== "foreign");
  if (realSkillsDrift.length > 0) {
    const dirs = [...new Set(realSkillsDrift.map((d) => d.dir))].join(", ");
    const allMissing = realSkillsDrift.every((d) => d.reason === "missing");
    hints.push(
      allMissing
        ? fire(HINTS["materialized-skills-missing"], { dirs })
        : fire(HINTS["materialized-skills-stale"], { dirs }),
    );
  }

  if (ctx.providerHookDrift.length > 0) {
    const paths = [...new Set(ctx.providerHookDrift.map((d) => d.path))]
      .join(", ");
    const allMissing = ctx.providerHookDrift.every((d) =>
      d.reason === "missing"
    );
    hints.push(
      allMissing
        ? fire(HINTS["provider-integrations-missing"], { paths })
        : fire(HINTS["provider-integrations-stale"], { paths }),
    );
  }

  // The maintained ADR index drifted from the record files — the same advisory
  // voice as the other refresh-managed artifacts. Only `stale` speaks here:
  // `absent` is a project that never adopted the index, and `invalid` is a
  // source problem whose diagnosis belongs to the gate.
  if (ctx.adrIndex.kind === "stale") {
    hints.push(fire(HINTS["adr-index-stale"], { path: ctx.adrIndex.path }));
  }

  // The focused hints above already explain instructions, hooks, and the ADR index.
  // Speak once more only for paths they do not cover (or for mode-only drift,
  // which their byte-oriented checks cannot see).
  const focused = new Set([
    ...ctx.instructionDrift.map((entry) => entry.path),
    ...ctx.providerHookDrift.map((entry) => entry.path),
    ...(ctx.adrIndex.kind === "stale" ? [ctx.adrIndex.path] : []),
  ]);
  const remainingRefresh = ctx.trackedRefreshPlan.changes.filter((change) =>
    change.modeChanged || !focused.has(change.path)
  );
  if (remainingRefresh.length > 0) {
    hints.push(fire(HINTS["tracked-refresh-pending"], {
      paths: remainingRefresh.map((change) => change.path).join(", "),
    }));
  }
  if (ctx.trackedRefreshPlan.errors.length > 0) {
    hints.push(fire(HINTS["tracked-refresh-plan-failed"], {
      reason: ctx.trackedRefreshPlan.errors.slice(0, 3).join("; "),
    }));
  }

  // In the main checkout with worktrees on, the agent may be beginning a new
  // effort or returning to one whose client/tool root reset between turns. Lead
  // with the continuity decision before the conditional `discern start` action.
  // Agent channel only: the terminal renderer filters this out (a person here is
  // supervising their fleet), so it never nags the CLI. Suppressed while setup is
  // unfinished: setup runs in the main checkout (on the `discern-setup` branch),
  // so worktree entry advice would contradict the lead "finish setup here" hint.
  //
  // Location (main checkout) and branch identity (trunk vs not) are independent
  // axes — the main checkout can sit on a non-trunk branch (a leftover
  // `discern-setup` branch, a PR checked out directly). Only claim "you're on the
  // trunk" when `git.branch` actually says so; otherwise use the off-trunk sibling,
  // which gives the same advice without the false claim. With no git block to check
  // against (no repo), keep the original wording — unverifiable, not contradicted.
  if (ctx.location === "main" && ctx.setupPending === undefined) {
    // `ahead_trunk === null` is the "no local trunk" signal (the same
    // honesty rule that replaced the fabricated "0 ahead") — the off-trunk
    // wording would prescribe a `git switch` onto a branch that isn't there.
    const missingTrunk = ctx.git !== null && ctx.git.branch !== main &&
      ctx.git.ahead_trunk === null;
    hints.push(
      ctx.git !== null && ctx.git.branch !== main
        ? missingTrunk
          ? fire(HINTS["status-missing-trunk"], {
            branch: ctx.git.branch,
            trunk: main,
          })
          : fire(HINTS["status-start-off-trunk"], {
            branch: ctx.git.branch,
            trunk: main,
          })
        : fire(HINTS["status-start-on-trunk"]),
    );
    if (!missingTrunk) {
      hints.push(fire(HINTS["status-continue-own-effort"]));
    }
  }

  if (ctx.location === "worktree" && ctx.git !== null) {
    const g = ctx.git;
    const firedScopes = (ctx.changed ?? []).filter((s) => !isScopeMarker(s));
    if (!g.clean) {
      hints.push(
        firedScopes.length > 0
          ? fire(HINTS["status-dirty-worktree-scoped"], {
            scopes: firedScopes,
          })
          : fire(HINTS["status-dirty-worktree"]),
      );
    }
    if (g.behind_trunk !== null && g.behind_trunk > 0) {
      hints.push(
        fire(HINTS["status-branch-behind"], {
          behind: g.behind_trunk,
          trunk: main,
          overlap: ctx.incomingOverlap === undefined ? undefined : {
            total: ctx.incomingOverlap.total,
            paths: ctx.incomingOverlap.overlap,
          },
        }),
      );
    }
    const readinessFacts = {
      clean: g.clean,
      ahead: g.ahead_trunk,
      behind: g.behind_trunk,
    };
    if (isLandingCandidate(readinessFacts)) {
      // accept would refuse against tracked changes in the main checkout — say so
      // if we can see them.
      const mainDirty = await isMainCheckoutDirty(ctx.root);
      if (mainDirty) {
        hints.push(
          fire(HINTS["status-main-checkout-dirty"], { trunk: main }),
        );
      } else if (
        isReadyToLand(
          readinessFacts,
          ctx.gateProof?.status === "honored",
        )
      ) {
        if (ctx.landingAuthority?.kind === "authorized") {
          hints.push(
            fire(HINTS["status-land-under-verified-authority"], {
              source: ctx.landingAuthority.consent.source,
              scopes: ctx.landingAuthority.consent.scopes ?? [],
            }),
          );
        } else if (
          ctx.landingAuthority !== undefined &&
          landingAuthorityProjection(ctx.landingAuthority) !== undefined
        ) {
          hints.push(
            fire(HINTS["status-ready-uncovered-authority"], {
              trunk: main,
              branch: g.branch,
            }),
          );
        } else {
          hints.push(
            fire(HINTS["status-ready-for-review"], {
              trunk: main,
              branch: g.branch,
            }),
          );
        }
      } else {
        hints.push(
          fire(HINTS["status-missing-done-proof"], { trunk: main }),
        );
      }
    }
  }

  // The survey holds a registered worktree other than the current checkout. Give
  // the agent the ownership rule that distinguishes this effort's earlier
  // worktree from somebody else's (json/MCP only; humans get the fleet caption).
  // Location-agnostic: fires from main and under --all from a worktree.
  if (ctx.fleet !== undefined && !ctx.logbookEnabled) {
    hints.push(fire(HINTS["status-fleet-logbook-disabled"]));
  }
  if (ctx.fleet?.some((e) => !e.is_main && !e.is_current)) {
    hints.push(fire(HINTS["fleet-ownership"]));
  }

  // In-flight ADR number collisions — location-agnostic like the data: the
  // fleet view sees every contested number, a worktree sees the ones its own
  // branch is party to. The rows ride data.adr_collisions.
  const adrCollisions = ctx.adrCollisions ?? [];
  if (adrCollisions.length > 0) {
    hints.push(
      fire(HINTS["status-adr-number-collisions"], {
        total: adrCollisions.length,
        claims: adrCollisions.map((c) =>
          `${c.number} (${c.branches.join(" ↔ ")})`
        ),
      }),
    );
  }

  // Main-checkout worktree-activity next-steps assume a configured, set-up project.
  // While setup is unfinished these are premature and contradict the lead "finish
  // setup here" hint, so suppress the whole block until `[meta].bootstrapped` is
  // recorded — the setup-unfinished hint at the top is the only "what now" that fits.
  if (ctx.location === "main" && ctx.setupPending === undefined) {
    if (ctx.liveCount === 0) {
      hints.push(fire(HINTS["status-no-active-worktrees"]));
    } else if (ctx.fleet !== undefined) {
      const others = ctx.fleet.filter((e) => !e.is_main);
      // Emit one hint per fleet class. The registry preserves each total and caps
      // its name sample; every row and per-row fact remains in data.fleet.
      // `clean === false` — a row whose git state is UNAVAILABLE (clean absent)
      // is unknown, not dirty; it gets its own hint below.
      const dirty = others.filter((e) => e.clean === false);
      if (dirty.length > 0) {
        hints.push(
          fireOwnerAttention(HINTS["status-dirty-fleet-members"], {
            total: dirty.length,
            names: dirty.map((e) => e.id ?? e.branch),
          }),
        );
      }
      // Review readiness was read once, into each row (`proof_honored`), so the
      // hint and the wire field cannot disagree.
      const ready = others.filter((e) =>
        isReadyToLand(e, e.proof_honored === true)
      );
      const authorizedReady = ready.filter((e) =>
        e.landing_authority?.kind === "authorized"
      );
      if (authorizedReady.length > 0) {
        hints.push(
          fireOwnerAttention(HINTS["status-fleet-authorized-landings"], {
            total: authorizedReady.length,
            names: authorizedReady.map((e) => e.id ?? e.branch),
          }),
        );
      }
      const reviewReady = ready.filter((e) =>
        e.landing_authority?.kind !== "authorized"
      );
      if (reviewReady.length > 0) {
        hints.push(
          fireOwnerAttention(HINTS["status-fleet-member-ready"], {
            total: reviewReady.length,
            names: reviewReady.map((e) => e.id ?? e.branch),
            trunk: main,
          }),
        );
      }
      // Unreadable members: git could not run inside the checkout, so its work
      // state is unknown — say so, rather than letting the row pass as clean.
      // (`worktree drop` fails safe on the same rows: it refuses without
      // --force while the state is unverifiable.) A `broken` row already
      // carries its own hint with the same way out.
      const unreadable = others.filter((e) =>
        e.git_unavailable === true && e.broken !== true
      );
      if (unreadable.length > 0) {
        hints.push(
          fireOwnerAttention(HINTS["status-fleet-member-unreadable"], {
            total: unreadable.length,
            names: unreadable.map((e) => e.id ?? basename(e.path)),
          }),
        );
      }
      // Broken members: setup never completed, so the checkout may be incomplete —
      // not a healthy fleet entry, and not worth resuming. Name the removal path.
      const broken = others.filter((e) => e.broken === true);
      if (broken.length > 0) {
        hints.push(
          fireOwnerAttention(HINTS["status-fleet-member-broken"], {
            total: broken.length,
            names: broken.map((e) => e.id ?? basename(e.path)),
          }),
        );
      }
      // Stale members: idle for a while and still carrying work — surface the
      // abandonment before it fossilises, with both ways out.
      const stale = others.filter((e) => {
        const idleDays = idleDaysOf(e.last_activity, ctx.nowMs);
        return (
          e.broken !== true && idleDays !== undefined &&
          idleDays >= STALE_WORKTREE_DAYS &&
          (e.clean === false || (e.ahead ?? 0) > 0)
        );
      });
      if (stale.length > 0) {
        hints.push(
          fireOwnerAttention(HINTS["status-fleet-member-stale"], {
            total: stale.length,
            names: stale.map((e) => e.id ?? basename(e.path)),
          }),
        );
      }
      // Cross-worktree collisions — the check only the fleet-wide view can
      // make; the pairs and their shared paths ride data.fleet_collisions.
      const collisions = ctx.fleetCollisions ?? [];
      if (collisions.length > 0) {
        hints.push(
          fire(HINTS["status-fleet-collisions"], {
            total: collisions.length,
            pairs: collisions.map((c) => `${c.branches[0]} ↔ ${c.branches[1]}`),
          }),
        );
      }
    }
    // Unlanded branches with no worktree — otherwise-invisible abandoned work.
    if (ctx.unlandedBranches !== undefined && ctx.unlandedBranches.length > 0) {
      hints.push(
        fireOwnerAttention(HINTS["status-unlanded-branches"], {
          branches: ctx.unlandedBranches,
        }),
      );
    }
    // Reclaimed-stage refs are a calm fact, never work to resume: their
    // commits ride inside the named live branch and the ref self-cleans
    // through the ordinary prune once that work lands.
    if (ctx.containedRefs !== undefined && ctx.containedRefs.length > 0) {
      hints.push(
        fire(HINTS["status-contained-refs"], { refs: ctx.containedRefs }),
      );
    }
  }

  // The checkpoint obligation account rides last, after every observation
  // about the broader current state.
  hints.push(...ctx.checkpointPreview);

  return hints;
}

/** Whether the main checkout has uncommitted tracked changes — the cheap read that
 * lets the accept-readiness hint warn that acceptance would refuse. False when it
 * can't be resolved (no main repo, or we're already in it). */
async function isMainCheckoutDirty(
  root: string,
): Promise<boolean> {
  const mainRepo = await mainRepoPath(root);
  if (mainRepo === undefined || mainRepo === root) {
    return false;
  }
  return await hasUncommittedTrackedChanges(mainRepo) ?? false;
}

// ── the CLI runner ───────────────────────────────────────────────────────────

/**
 * Run `status`. Resolves the project root itself (rather than `requireRoot`-ing)
 * so the not-initialized case is reported as the uniform envelope under `--json`,
 * mirroring the MCP server's not-initialized path. Returns a process exit code
 * (0 for any successful observation, 1 for a refusal / not-initialized).
 */
export async function runStatus(
  opts: { json: boolean; all: boolean; local: boolean; verbose: boolean },
): Promise<number> {
  const nowMs = Date.now();
  const root = await findRoot();
  if (root === undefined) {
    if (opts.json) {
      emitResult(notInitializedResult("status"));
    } else {
      new Logger({ json: false, noColor: false }).error(NO_PROJECT_MESSAGE);
    }
    return 1;
  }
  const result = await statusResult(root, {
    all: opts.all,
    local: opts.local,
    verbose: opts.verbose,
    nowMs,
  });
  observeResult(result);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  renderStatusHuman(result, { verbose: opts.verbose, nowMs });
  return result.ok ? 0 : 1;
}

// ── human rendering ──────────────────────────────────────────────────────────

/** Render the width-aware static dashboard on stdout. JSON never calls this path. */
function renderStatusHuman(
  result: DiscernResult<StatusData>,
  render: StatusRenderOptions,
): void {
  const terminal = render.terminal ?? terminalContext();
  const out = makeOut(terminal.color, { terminal });
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "status failed.");
    return;
  }
  out.raw(
    renderStatusDashboard(result.data, result.hints, {
      terminal,
      width: terminal.size.columns,
      verbose: render.verbose ?? false,
      nowMs: render.nowMs,
    }),
  );
}
