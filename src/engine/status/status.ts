/**
 * `status` — the situation/orientation verb: *what is true right now, and what
 * should I do next?* (ADR 0033). It complements the two setup-facing verbs without
 * overlapping either: `doctor` answers "is it correctly installed?" (health),
 * `audit` answers "is the setup any good?" (quality, changes rarely), and `status`
 * answers "what changed and what now?" (situation, changes every commit) — so an
 * agent calls it reflexively at the start of a session.
 *
 * `status` is PURE OBSERVATION. It never runs the gate, runs tests, measures
 * ratchets, probes resource readiness, or creates/destroys anything. It does git
 * *reads*, file reads (`.env`, config), and identity derivation only — fast enough
 * to call reflexively. It reports what the gate WOULD fire and what CHANGED; it
 * never asserts a pass/fail it didn't verify.
 *
 * The view is LOCATION-AWARE (ADR 0033): from a linked worktree the default is the
 * local view (this worktree's own state); from the main checkout — with worktrees
 * enabled and at least one live worktree — it leads with the fleet survey (a row per
 * worktree, the main checkout included). `--all` adds the fleet from a worktree;
 * `--local` suppresses it from the main checkout.
 */

import { basename } from "@std/path";
import {
  type DiscernConfig,
  loadConfig,
  toCommandList,
} from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  Location,
  StatusData,
  StatusFeatures,
  StatusFleetEntry,
  StatusGate,
  StatusGit,
  StatusWorktree,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { findRoot } from "../../shared/env.ts";
import { FEATURES, isFeatureEnabled } from "../../shared/features.ts";
import {
  type Capability,
  KNOWN_CAPABILITIES,
} from "../../shared/capabilities.ts";
import {
  findSkeletonMarkers,
  setupUnfinishedHint,
} from "../../shared/setup_state.ts";
import { changedScopes, isScopeMarker } from "../scopes/changed.ts";
import { planScopeGates } from "../gate/plan.ts";
import {
  checkGuidanceCurrent,
  type GuidanceDriftEntry,
} from "../guidance_render.ts";
import { checkSkillsCurrent, type SkillsDriftEntry } from "../../lib/skills.ts";
import {
  assertMainMerged,
  type FleetWorktree,
  gitSnapshot,
  listWorktreeFleet,
  mainRepoPath,
  worktreeGitKey,
} from "../worktree/git.ts";
import { IdentityError, resolveIdentity } from "../worktree/identity.ts";
import { readResourceSpecs, resourceEnvName } from "../worktree/resources.ts";
import { readEnvFile } from "../worktree/env_file.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";

/** The not-inside-a-project message (matches the dispatcher / MCP server slug). */
const NO_PROJECT =
  "not inside a discern project (no discern.toml in this directory or any parent).";

/** Flags accepted by `status` on both surfaces. */
export interface StatusOptions {
  /** Include the fleet survey even from a worktree (a worktree surveying its siblings). */
  all?: boolean;
  /** Local view only — suppress the fleet survey even in the main checkout. */
  local?: boolean;
}

// ── the `data` payload shapes ──────────────────────────────────────────────────
// The wire contract (discriminated by `location` and the presence of `fleet`) lives
// as Zod schemas in `result_schemas.ts` — the SSOT the MCP `outputSchema` advertises.
// Typing this core's `data` (and its sub-blocks) as the inferred types means any
// drift from the schema is a compile error.

// ── the result core (the single source the CLI and the MCP tool both render) ────

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
): Promise<DiscernResult> {
  const all = opts.all ?? false;
  const local = opts.local ?? false;
  if (all && local) {
    return {
      ok: false,
      verb: "status",
      error: "conflicting_flags",
      message: "--all and --local cannot be combined — pick one.",
    };
  }

  const cfg = await loadConfig(root);
  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;

  // Location: a linked worktree has its own git admin dir (worktreeGitKey defined);
  // the main checkout (or no git repo) does not.
  const gitKey = await worktreeGitKey(root);
  const location: Location = gitKey !== undefined ? "worktree" : "main";
  const snap = await gitSnapshot(root, mainBranch);

  // The git block — read-only; null when this isn't a git repo (degrade, don't throw).
  let git: StatusGit | null = null;
  if (snap !== undefined) {
    // Reuse the canonical main-merged check for the behind/null distinction: it
    // self-skips (→ null) in the main checkout or with no local integration branch.
    const merged = await assertMainMerged(root, mainBranch);
    const behind = merged.kind === "skipped"
      ? null
      : merged.kind === "merged"
      ? 0
      : Number(merged.behind) || 0;
    git = {
      branch: snap.branch,
      integration_branch: mainBranch,
      clean: snap.clean,
      changed_files: snap.changedFiles,
      behind_integration: behind,
      ahead_integration: snap.ahead,
    };
  }

  // The worktree identity block — only inside a linked worktree.
  const worktree = location === "worktree"
    ? await buildWorktreeBlock(root, cfg)
    : null;

  // Built from the FEATURES SSOT (not a hand-listed object) so every toggle is
  // reported and a new feature can't silently go missing from status.
  const features: StatusFeatures = Object.fromEntries(
    FEATURES.map((f) => [f, isFeatureEnabled(cfg, f)]),
  ) as StatusFeatures;

  // Fleet decision. The fleet is meaningful only with the worktrees feature on, and
  // only worth surveying from the main checkout (the supervisor view) or when a
  // worktree explicitly asks via --all — so a plain local worktree view never pays
  // for it. The survey is read-only either way.
  const wantFleet = features.worktrees && (all || location === "main");
  const fleetRows = wantFleet ? await listWorktreeFleet(root, mainBranch) : [];
  const liveCount = fleetRows.filter((w) => !w.isMain).length;
  const includeFleet = all
    ? true
    : local
    ? false
    : location === "main" && features.worktrees && liveCount >= 1;
  // "Fleet-led" — the main-checkout supervisor view that leads with the fleet and
  // omits the heavy local-only blocks. A worktree with --all keeps its local blocks
  // AND gains the fleet, so it is not fleet-led.
  const fleetLed = includeFleet && location === "main";

  const data: StatusData = {
    location,
    root,
    worktree,
    git,
    features,
    ratchets: Object.keys(cfg.ratchets),
  };

  // Local-only heavy blocks: the changed scopes and what the gate would fire.
  let changed: string[] | undefined;
  if (!fleetLed) {
    changed = await changedScopes(root, cfg);
    data.changed_scopes = changed;
    data.gate = buildGateBlock(cfg, changed);
  }

  // Generated-artifacts currency (ADR 0034): a cheap read-only check that the agent
  // files match what `discern refresh` would write. Advisory only here — surfaced as
  // a hint so a drifted or not-yet-built AGENTS.md is noticed at orientation, never
  // an unverified pass/fail. Skipped when guidance is off (nothing is generated).
  let guidanceDrift: GuidanceDriftEntry[] = [];
  if (isFeatureEnabled(cfg, "guidance")) {
    guidanceDrift = await checkGuidanceCurrent(root, cfg);
    if (guidanceDrift.length > 0) {
      data.stale_generated = guidanceDrift.map((d) => d.path);
    }
  }

  // The same read-only currency check, for the MATERIALIZED skills (ADR 0034,
  // extended to skills). Advisory here, like `stale_generated`: a drifted or
  // not-yet-materialized skills dir is noticed at orientation. Skipped when skills
  // is off. Reports the affected skill paths (dir/name), `missing` dirs included.
  let skillsDrift: SkillsDriftEntry[] = [];
  if (isFeatureEnabled(cfg, "skills")) {
    skillsDrift = await checkSkillsCurrent(root, cfg);
    // Report only `missing`/`stale` (parallel to `stale_generated` for guidance) — a
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

  // One-time setup state (ADR 0036). Until `[meta].bootstrapped` is recorded the
  // project is mid-setup and the agent must finish it — surfaced loudly (a banner,
  // a lead hint) so a half-done setup isn't mistaken for a finished one. Walk for
  // leftover skeleton markers only when it could be unfinished (`bootstrapped` is
  // the cheap gate — a finished project never pays for the walk). Present in `data`
  // only while outstanding, mirroring `stale_generated`.
  let setupPending: string[] | undefined;
  if (!cfg.meta.bootstrapped) {
    setupPending = await findSkeletonMarkers(root);
    data.setup_unfinished = { pending_markers: setupPending };
  }

  // The fleet survey, each row augmented with its best-effort id/port from `.env`.
  let fleet: StatusFleetEntry[] | undefined;
  if (includeFleet) {
    // Canonicalize the invocation root once so each row's is_current compares like
    // for like against row.path (also canonical).
    const here = await Deno.realPath(root).catch(() => root);
    fleet = await Promise.all(fleetRows.map((row) => fleetEntryFor(row, here)));
    data.fleet = fleet;
  }

  const hints = await buildStatusHints({
    root,
    location,
    mainBranch,
    git,
    changed,
    fleet,
    worktreesOn: features.worktrees,
    liveCount,
    guidanceDrift,
    skillsDrift,
    setupPending,
  });

  return {
    ok: true,
    verb: "status",
    data,
    ...(hints.length > 0 ? { hints } : {}),
  };
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

/** The resource handles ACTUALLY recorded in this worktree's `.env` (what was
 * provisioned), not the derived set — a resource not yet created has no `.env`
 * entry and is honestly absent. Reads only; never creates a `.env` or a resource. */
async function readWorktreeResources(
  root: string,
  cfg: DiscernConfig,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const specs = readResourceSpecs(cfg);
  if (specs.length === 0) {
    return out;
  }
  const envText = await readEnvFile(root);
  if (envText === undefined) {
    return out;
  }
  for (const spec of specs) {
    const value = readEnvVar(envText, resourceEnvName(spec.name));
    if (value !== undefined && value !== "") {
      out[spec.name] = value;
    }
  }
  return out;
}

/** Augment a cheap fleet row with the worktree's id/port from its `.env` (best
 * effort — omitted when absent). */
async function fleetEntryFor(
  row: FleetWorktree,
  here: string,
): Promise<StatusFleetEntry> {
  const entry: StatusFleetEntry = {
    path: row.path,
    is_main: row.isMain,
    // Occupancy, not git state: the row the call is rooted in. `row.path` is already
    // canonical (realPathOr in listWorktreeFleet); `here` is canonicalized to match.
    is_current: row.path === here,
    branch: row.branch,
    clean: row.clean,
    changed_files: row.changedFiles,
    ahead: row.ahead,
    behind: row.behind,
  };
  if (row.lastActivity !== undefined) {
    entry.last_activity = new Date(row.lastActivity * 1000).toISOString();
  }
  const envText = await readEnvFile(row.path);
  if (envText !== undefined) {
    const id = readEnvVar(envText, "DISCERN_WORKTREE_ID");
    if (id !== undefined && id !== "") {
      entry.id = id;
    }
    const port = readEnvVar(envText, "DISCERN_WORKTREE_PORT");
    if (port !== undefined && /^\d+$/.test(port)) {
      entry.port = Number(port);
    }
  }
  return entry;
}

/** What the gate would fire: the wired capabilities (canonical order), the declared
 * checks, and the scope gates the current change triggers — reusing the gate's own
 * scope-gate selection (`planScopeGates`) so status and `finish` agree. */
function buildGateBlock(cfg: DiscernConfig, changed: string[]): StatusGate {
  const capabilities = (Object.keys(KNOWN_CAPABILITIES) as Capability[])
    .filter((c) => toCommandList(cfg.capabilities[c]).length > 0);
  const checks = Object.entries(cfg.checks)
    .filter(([, spec]) => toCommandList(spec.run).length > 0)
    .map(([name]) => name);
  const scope_gates = planScopeGates(cfg, changed)
    .filter((j) => j.willRun)
    .map((j) => j.label.replace(/^scope:/, ""));
  return { capabilities, checks, scope_gates };
}

// ── hints (advisory next-steps; never an unverified pass/fail) ───────────────────

/**
 * The fleet ownership rule, agent-facing. Pushed into `hints[]` (the `--json` / MCP
 * channel, ADR 0030) whenever the survey holds a line of work other than this one —
 * never into interactive human output, where the dim caption under the fleet table
 * carries the same framing. Exported as a named constant so both the human renderer
 * (which filters it out) and the test (which asserts it in) reference one string, not
 * a brittle inline literal that could drift.
 */
export const FLEET_OWNERSHIP_HINT =
  "Worktrees in the fleet belong to separate lines of work — never start work in one you didn't create; a clean working tree doesn't mean it's free.";

/**
 * The on-the-trunk guardrail, agent-facing. An agent that finds itself on the main
 * checkout has no isolated workspace yet — point it LOUDLY at `discern start` (its
 * first-class way into its own worktree) so it never improvises into another agent's.
 * Pushed into `hints[]` (the `--json` / MCP channel, ADR 0030) whenever status is
 * rooted in the main checkout with worktrees enabled — never into interactive human
 * output, where a person running `discern status` is monitoring their fleet and the
 * renderer filters it out (exactly like {@link FLEET_OWNERSHIP_HINT}). Exported as a
 * named constant so the human renderer (which drops it) and the test (which asserts
 * it) reference one string, not a brittle inline literal.
 */
export const START_HERE_HINT =
  "You're on the trunk (the main checkout), not an isolated worktree — don't start work here. Run `discern start` to create your own worktree and move into it; never adopt an existing idle worktree (each belongs to another line of work, and a clean tree doesn't mean it's free).";

/** Everything the hint builder reads — assembled once so the hints can't drift from
 * the reported data. */
interface HintContext {
  root: string;
  location: Location;
  mainBranch: string;
  git: StatusGit | null;
  changed: string[] | undefined;
  fleet: StatusFleetEntry[] | undefined;
  worktreesOn: boolean;
  liveCount: number;
  /** Generated agent files that don't match what `discern refresh` would write. */
  guidanceDrift: GuidanceDriftEntry[];
  /** Materialized skills that don't match the effective set a refresh would place. */
  skillsDrift: SkillsDriftEntry[];
  /** Scaffolded files still carrying skeleton markers while setup is unfinished;
   * undefined once `[meta].bootstrapped` is recorded. Drives the lead setup hint. */
  setupPending: string[] | undefined;
}

/**
 * The advisory "what next" lines. Honest by construction: every line is an
 * observation plus a suggested command, never a claim that the gate passed.
 */
async function buildStatusHints(ctx: HintContext): Promise<string[]> {
  const hints: string[] = [];
  const main = ctx.mainBranch;

  // Setup not finished — the most fundamental "what now", so it leads every other
  // hint, in every location. The structured evidence is `data.setup_unfinished`;
  // this is its advisory voice.
  if (ctx.setupPending !== undefined) {
    hints.push(setupUnfinishedHint(ctx.setupPending));
  }

  // Generated agent files drifted from their source — actionable anywhere, so lead
  // with it. "missing" (not built yet) reads differently from "stale" (a drift that
  // a refresh would overwrite), so the redirect to the source only shows for stale.
  if (ctx.guidanceDrift.length > 0) {
    const paths = ctx.guidanceDrift.map((d) => d.path).join(", ");
    const allMissing = ctx.guidanceDrift.every((d) => d.reason === "missing");
    hints.push(
      allMissing
        ? `Generated agent files aren't built yet (${paths}); run \`discern refresh\`.`
        : `Generated agent files are out of date (${paths}); run \`discern refresh\` — edits belong in your [guidance].sources, not the generated file.`,
    );
  }

  // Materialized skills drifted from the effective set — the same advisory shape as
  // guidance. `missing`/`foreign` (a not-yet-built dir, an unmanaged drop-in) read
  // differently from `stale` (a drift a refresh overwrites), so only stale gets the
  // edit-the-source redirect; foreign is surfaced but never presented as fixable.
  const realSkillsDrift = ctx.skillsDrift.filter((d) => d.reason !== "foreign");
  if (realSkillsDrift.length > 0) {
    const dirs = [...new Set(realSkillsDrift.map((d) => d.dir))].join(", ");
    const allMissing = realSkillsDrift.every((d) => d.reason === "missing");
    hints.push(
      allMissing
        ? `Skills aren't materialized yet (${dirs}); run \`discern refresh\`.`
        : `Materialized skills are out of date (${dirs}); run \`discern refresh\` — edits belong in your [skills].dir source, not the materialized copy.`,
    );
  }

  // On the trunk (the main checkout) with worktrees on, the agent has no isolated
  // workspace yet — lead the next-steps with the loud `discern start` guardrail so it
  // never squats in another line of work's worktree. Agent channel only: the human
  // renderer filters this out (a person here is supervising their fleet, not starting
  // work), so it never nags the CLI. Placed before the fleet-ownership rule — the
  // constructive action first, the don't-squat caveat after.
  if (ctx.location === "main" && ctx.worktreesOn) {
    hints.push(START_HERE_HINT);
  }

  if (ctx.location === "worktree" && ctx.git !== null) {
    const g = ctx.git;
    const firedScopes = (ctx.changed ?? []).filter((s) => !isScopeMarker(s));
    if (!g.clean) {
      hints.push(
        firedScopes.length > 0
          ? `Changes in ${
            firedScopes.join(", ")
          }; run \`discern finish\` before calling work done.`
          : "Uncommitted changes; run `discern finish` before calling work done.",
      );
    }
    if (g.behind_integration !== null && g.behind_integration > 0) {
      hints.push(
        `Branch is ${g.behind_integration} behind ${main}; run \`discern integrate\` → \`discern finish\`, before \`discern graduate\`.`,
      );
    }
    if (g.clean && g.behind_integration === 0 && g.ahead_integration > 0) {
      // graduate would refuse against a dirty main checkout — say so if we can see it.
      const mainDirty = await isMainCheckoutDirty(ctx.root, main);
      hints.push(
        mainDirty
          ? `Committed and up to date with ${main}, but the main checkout has uncommitted changes — commit or stash them there before \`discern graduate\`.`
          : `Committed and up to date with ${main}; \`discern graduate\` when ready.`,
      );
    }
  }

  // The survey holds a line of work other than this one — give the agent the
  // ownership rule (json/MCP only; humans get the caption under the fleet table).
  // Location-agnostic: fires from the main checkout and under --all from a worktree.
  if (ctx.fleet?.some((e) => !e.is_main && !e.is_current)) {
    hints.push(FLEET_OWNERSHIP_HINT);
  }

  if (ctx.location === "main") {
    // (Setup-incomplete leads the hints in every location — see the top of this
    // builder — so there is no separate main-only setup nudge here.)
    if (!ctx.worktreesOn) {
      hints.push(
        "The worktrees workflow is off; work happens directly in this checkout.",
      );
    } else if (ctx.liveCount === 0) {
      hints.push("No active worktrees; start one to begin work.");
    } else if (ctx.fleet !== undefined) {
      const others = ctx.fleet.filter((e) => !e.is_main);
      const dirty = others.filter((e) => !e.clean);
      if (dirty.length > 0) {
        const names = dirty.map((e) => e.id ?? e.branch).join(", ");
        hints.push(
          `${dirty.length} worktree${dirty.length === 1 ? "" : "s"} ${
            dirty.length === 1 ? "has" : "have"
          } uncommitted changes: ${names}.`,
        );
      }
      for (const e of others) {
        if (e.clean && e.behind === 0 && e.ahead > 0) {
          hints.push(
            `Worktree ${e.id ?? e.branch} looks ready to graduate.`,
          );
        }
      }
    }
  }

  return hints;
}

/** Whether the main checkout has uncommitted changes — the cheap read that lets the
 * graduate-readiness hint warn that graduation would refuse. False when it can't be
 * resolved (no main repo, or we're already in it). */
async function isMainCheckoutDirty(
  root: string,
  mainBranch: string,
): Promise<boolean> {
  const mainRepo = await mainRepoPath(root);
  if (mainRepo === undefined || mainRepo === root) {
    return false;
  }
  const snap = await gitSnapshot(mainRepo, mainBranch);
  return snap !== undefined && !snap.clean;
}

/** Read a `KEY=value` from `.env` text (first match), stripping one layer of quotes. */
function readEnvVar(text: string, key: string): string | undefined {
  const prefix = `${key}=`;
  for (const line of text.split("\n")) {
    if (line.startsWith(prefix)) {
      return stripQuotes(line.slice(prefix.length).trim());
    }
  }
  return undefined;
}

/** Strip one layer of matching surrounding quotes. */
function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ── the CLI runner ───────────────────────────────────────────────────────────

/**
 * Run `status`. Resolves the project root itself (rather than `requireRoot`-ing)
 * so the not-initialized case is reported as the uniform envelope under `--json`,
 * mirroring the MCP server's not-initialized path. Returns a process exit code
 * (0 for any successful observation, 1 for a refusal / not-initialized).
 */
export async function runStatus(
  opts: { json: boolean; all: boolean; local: boolean },
): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    if (opts.json) {
      emitResult({
        ok: false,
        verb: "status",
        error: "not_initialized",
        message: NO_PROJECT,
      });
    } else {
      console.error(`discern: ${NO_PROJECT}`);
      console.error("       Run `discern setup` to scaffold one.");
    }
    return 1;
  }
  const result = await statusResult(root, { all: opts.all, local: opts.local });
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  renderStatusHuman(result);
  return result.ok ? 0 : 1;
}

// ── human rendering (a compact situation summary; the fleet table when present) ──

/** Left-pad a field label to a fixed gutter so the summary lines align. */
function label(text: string): string {
  return text.padEnd(11);
}

/** Truncate `s` to `n` chars with an ellipsis, for fixed-width table columns. */
function trunc(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** A compact relative age ("3d ago", "2h ago", "just now") from an ISO timestamp,
 * for the fleet table's Last Activity column. "—" when unknown. */
function relativeAge(iso: string | undefined): string {
  if (iso === undefined) {
    return "—";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "—";
  }
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Render the status result as a compact human summary on stdout (quiet under
 * `--json`, which never calls this). */
function renderStatusHuman(result: DiscernResult): void {
  const out = makeOut(colorEnabled());
  if (!result.ok) {
    out.error(result.message ?? "status failed.");
    return;
  }
  const data = result.data as StatusData;
  const c = out.c;
  const dot = `  ${c.dim}·${c.reset} `;

  out.heading(
    `discern status — ${
      data.location === "worktree" ? "worktree" : "main checkout"
    }`,
  );

  // Setup-not-finished leads everything else, loudly — a half-configured project
  // mistaken for a finished one is the failure this banner guards. (Structured
  // evidence is in data.setup_unfinished; this is its human face.)
  if (data.setup_unfinished !== undefined) {
    const pending = data.setup_unfinished.pending_markers;
    out.raw(
      `\n  ${c.yellow}${c.bold}⚠ SETUP NOT FINISHED${c.reset}${c.yellow} — this project is half-configured; completing it is your job, not a report to hand back.${c.reset}\n`,
    );
    out.raw(
      `  ${c.dim}Work the brief \`discern setup\` prints (re-run it to reprint), then run \`discern setup done\` to finish.${c.reset}\n`,
    );
    if (pending.length > 0) {
      const shown = pending.slice(0, 6).join(", ");
      const more = pending.length > 6 ? `, +${pending.length - 6} more` : "";
      out.raw(
        `  ${c.dim}Still carrying skeleton markers: ${shown}${more}.${c.reset}\n`,
      );
    }
  }

  if (data.git !== null) {
    const g = data.git;
    const state = g.clean ? "clean" : `${g.changed_files} changed`;
    const behind = g.behind_integration === null
      ? ""
      : `, ${g.behind_integration} behind`;
    out.raw(
      `  ${label("branch")}${
        g.branch || "(detached)"
      }${dot}${state}${dot}${g.ahead_integration} ahead${behind} ${g.integration_branch}\n`,
    );
  } else {
    out.raw(
      `  ${label("git")}${c.dim}unavailable (not a git repository)${c.reset}\n`,
    );
  }

  if (data.worktree !== null) {
    const w = data.worktree;
    out.raw(`  ${label("worktree")}${w.id}${dot}port ${w.port}\n`);
    const resNames = Object.keys(w.resources);
    if (resNames.length > 0) {
      out.raw(
        `  ${label("resources")}${
          resNames.map((n) => `${n}=${w.resources[n]}`).join("  ")
        }\n`,
      );
    }
  }

  if (data.changed_scopes !== undefined) {
    out.raw(
      `  ${label("scopes")}${
        data.changed_scopes.length > 0
          ? data.changed_scopes.join(", ")
          : "(none changed)"
      }\n`,
    );
  }

  if (data.gate !== undefined) {
    const g = data.gate;
    const caps = g.capabilities.length > 0
      ? g.capabilities.join(", ")
      : "(none wired)";
    const checks = g.checks.length > 0 ? `, ${g.checks.join(", ")}` : "";
    const sg = g.scope_gates.length > 0
      ? `${dot}scope gates: ${g.scope_gates.join(", ")}`
      : "";
    out.raw(`  ${label("gate")}${caps}${checks}${sg}\n`);
  }

  if (data.ratchets.length > 0) {
    out.raw(`  ${label("ratchets")}${data.ratchets.join(", ")}\n`);
  }

  if (data.fleet !== undefined) {
    renderFleetTable(out, data.fleet);
  }

  for (const hint of result.hints ?? []) {
    // The fleet ownership rule and the on-the-trunk `discern start` guardrail are
    // agent-only (json/MCP). A human running `discern status` from the main checkout
    // is monitoring their fleet, not starting work — so neither is rendered here
    // (the fleet table's caption carries the ownership framing for humans).
    if (hint === FLEET_OWNERSHIP_HINT || hint === START_HERE_HINT) continue;
    out.info(hint);
  }
}

/** Render the fleet survey as an aligned table. */
function renderFleetTable(out: Out, fleet: StatusFleetEntry[]): void {
  const c = out.c;
  out.raw(
    `\n  ${c.dim}${"WORKTREE".padEnd(20)}${"BRANCH".padEnd(24)}${
      "STATE".padEnd(12)
    }${"AHEAD/BEHIND".padEnd(13)}LAST ACTIVITY${c.reset}\n`,
  );
  for (const e of fleet) {
    const name = e.is_main ? "(main)" : (e.id ?? e.branch ?? basename(e.path));
    const state = e.clean ? "clean" : `${e.changed_files} changed`;
    const counts = e.is_main ? "—" : `${e.ahead}/${e.behind}`;
    const you = e.is_current ? ` ${c.dim}← you${c.reset}` : "";
    out.raw(
      `  ${trunc(name, 19).padEnd(20)}${
        trunc(e.branch || "(detached)", 23).padEnd(24)
      }${state.padEnd(12)}${counts.padEnd(13)}${
        relativeAge(e.last_activity)
      }${you}\n`,
    );
  }
  // The ownership framing for humans (the agent-facing form is the --json-only hint):
  // only when the survey holds a line of work other than the current one.
  if (fleet.some((e) => !e.is_main && !e.is_current)) {
    out.raw(
      `  ${c.dim}Other worktrees are separate lines of work — don't start work in one you didn't create.${c.reset}\n`,
    );
  }
}
