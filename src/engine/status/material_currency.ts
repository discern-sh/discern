/** Read-only managed currency and its status presentation (ADR 0401).
 * An older engine reports unavailable evidence before consulting its templates;
 * equality still runs every byte-level authority. */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import {
  checkInstructionCurrent,
  type InstructionDriftEntry,
} from "../instruction_render.ts";
import {
  checkProviderHooksCurrent,
  type ProviderHookDriftEntry,
} from "../../lib/provider_hooks.ts";
import { checkSkillsCurrent, type SkillsDriftEntry } from "../../lib/skills.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import {
  compareManagedVersion,
  managedVersionAdvice,
} from "../../shared/managed_version.ts";
import { managedMaterialBoundary } from "../managed_version.ts";
import { type AdrIndexState, adrIndexState } from "../../lib/adr_index.ts";
import {
  planTrackedRefresh,
  type TrackedRefreshPlan,
} from "../tracked_refresh.ts";

export interface StatusMaterialCurrency {
  data: Pick<
    StatusData,
    | "managed_version"
    | "managed_currency_unavailable"
    | "pending_tracked_refresh"
    | "tracked_refresh_plan_errors"
  >;
  artifactHints: FiredHint[];
  adoptionHints: FiredHint[];
}

/** Keep the observations and hints based on the same available evidence. */
export async function statusMaterialCurrency(
  root: string,
  cfg: DiscernConfig,
): Promise<StatusMaterialCurrency> {
  const adoption = compareManagedVersion(
    DISCERN_VERSION,
    cfg.meta.managed_version,
  );
  const adoptionAdvice = managedVersionAdvice(adoption, "references");
  const currencyUnavailable = managedMaterialBoundary(cfg);
  const data: StatusMaterialCurrency["data"] = {
    managed_version: adoption,
    ...(currencyUnavailable === undefined
      ? {}
      : { managed_currency_unavailable: currencyUnavailable }),
  };
  // Generated-artifacts currency (ADR 0034): a cheap read-only check that the agent
  // files match what `discern refresh` would write. Advisory only here — surfaced as
  // a hint so a drifted or not-yet-built AGENTS.md is noticed at orientation, never
  // an unverified pass/fail.
  const instructionDrift: InstructionDriftEntry[] =
    currencyUnavailable !== undefined ? [] : await checkInstructionCurrent(
      root,
      cfg,
    );

  // The same read-only currency check, for the MATERIALIZED skills (ADR 0034,
  // extended to skills). A drifted or not-yet-materialized skills dir is
  // noticed at orientation through its registered hint.
  const skillsDrift: SkillsDriftEntry[] = currencyUnavailable !== undefined
    ? []
    : await checkSkillsCurrent(root, cfg);

  // Provider integration currency. Hook files are provider-owned settings that
  // `discern refresh` re-seeds through registry-declared merge strategies. Surface
  // missing/stale hook files during orientation just like generated instructions and
  // materialized skills, but keep status read-only.
  const providerHookDrift = currencyUnavailable !== undefined
    ? []
    : await checkProviderHooksCurrent(root, cfg);

  // The maintained ADR index — the same read-only currency shape, for the
  // record lists a refresh keeps between markers in the ADR README. Advisory
  // here, like the other stale_* fields; only `stale` is reported (`absent`
  // means the project has not adopted the index, and `invalid` is a source
  // problem the gate diagnoses with the offending record).
  const adrIndex: AdrIndexState = await adrIndexState(root, cfg.map.dir);

  // The complete read-only tracked-refresh plan. This field is the one
  // authoritative answer to "would refresh change a tracked file?".
  const trackedRefreshPlan = await planTrackedRefresh(root, cfg);
  if (
    trackedRefreshPlan.unavailable === undefined &&
    trackedRefreshPlan.changes.length > 0
  ) {
    data.pending_tracked_refresh = trackedRefreshPlan.changes.map((change) =>
      change.path
    );
  }
  if (
    trackedRefreshPlan.unavailable === undefined &&
    trackedRefreshPlan.errors.length > 0
  ) {
    data.tracked_refresh_plan_errors = [...trackedRefreshPlan.errors];
  }

  const adoptionHints: FiredHint[] = [];
  if (adoptionAdvice !== undefined) {
    adoptionHints.push(
      fire(HINTS["managed-version-adoption"], { advice: adoptionAdvice }),
    );
  }
  return {
    data,
    artifactHints: materialCurrencyHints({
      instructionDrift,
      skillsDrift,
      providerHookDrift,
      adrIndex,
      trackedRefreshPlan,
    }),
    adoptionHints,
  };
}

interface CurrencyEvidence {
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
}

/** Focused drift hints precede the remaining complete-refresh diagnostics. */
function materialCurrencyHints(ctx: CurrencyEvidence): FiredHint[] {
  const hints: FiredHint[] = [];
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
  const remainingRefresh = ctx.trackedRefreshPlan.unavailable !== undefined
    ? []
    : ctx.trackedRefreshPlan.changes.filter((change) =>
      change.modeChanged || !focused.has(change.path)
    );
  if (remainingRefresh.length > 0) {
    hints.push(fire(HINTS["tracked-refresh-pending"], {
      paths: remainingRefresh.map((change) => change.path).join(", "),
    }));
  }
  if (
    ctx.trackedRefreshPlan.unavailable === undefined &&
    ctx.trackedRefreshPlan.errors.length > 0
  ) {
    hints.push(fire(HINTS["tracked-refresh-plan-failed"], {
      reason: ctx.trackedRefreshPlan.errors.slice(0, 3).join("; "),
    }));
  }

  return hints;
}
