/**
 * `discern doctor`'s completion checks: what the configured validation
 * establishes, how its producers combine, and what the durable completion
 * records currently hold.
 *
 * Two groups, both read-only:
 *  - configuration checks derive from `discern.toml` alone through the shared
 *    producer authority, so setup and doctor explain the same facts;
 *  - record checks observe the completion records in common Git administration
 *    and name the supported next action. Doctor never repairs anything.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Check } from "../../shared/result_schemas.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { newerOnDiskFormatMessage } from "../../shared/on_disk_formats.ts";
import {
  CANDIDATE_BOUND_REMEDY,
  producerFacts,
} from "../validation/producer_facts.ts";
import {
  observableCompletionCheckout,
  observeCompletionRecords,
} from "../validation/runtime.ts";
import { openCompletionRecordStore } from "../completion/store.ts";
import { emergencyValidationStatus } from "../emergency/obligations.ts";
import type { CompletionObservation } from "../completion/protocol.ts";

/** A check before doctor grades it; `status` defaults from `ok` and `warn`. */
export type DoctorDraftCheck = Omit<Check, "status"> & {
  status?: Check["status"];
};

/** At most this many named items in one check's detail; the rest are counted. */
const LISTED_ITEMS = 8;

/** Join a list for prose, bounding its length, with a fallback for an empty list. */
function list(items: readonly string[], empty = "none"): string {
  if (items.length === 0) return empty;
  const shown = items.slice(0, LISTED_ITEMS).join(", ");
  const rest = items.length - LISTED_ITEMS;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

/** Checks derived from configuration alone: producers and their closures. */
export async function completionConfigurationChecks(
  config: DiscernConfig,
): Promise<DoctorDraftCheck[]> {
  const checks: DoctorDraftCheck[] = [];
  const producers = await producerFacts(config);
  if (producers.error !== undefined) {
    checks.push({
      name: "producer coverage",
      ok: false,
      detail:
        `validation cannot resolve its producers: ${producers.error}. \`discern done\` would refuse before running anything`,
      fix:
        "point each standard's `producer` at an existing `jobs.<name>`, `scopes.<name>.gate`, or `standards.<name>`, and remove dependency cycles",
    });
  } else {
    const sharedDetail = producers.shared.map((entry) =>
      `${entry.producer} supplies ${entry.standards.join(", ")}`
    );
    const summary = `${producers.producers.length} producer${
      producers.producers.length === 1 ? "" : "s"
    }; ${
      producers.standards.length === 0
        ? "no standards configured"
        : `${producers.standards.length} standard${
          producers.standards.length === 1 ? "" : "s"
        }${sharedDetail.length === 0 ? "" : ` (${sharedDetail.join("; ")})`}`
    }`;
    if (producers.duplicated.length > 0) {
      const repeats = producers.duplicated.map((group) =>
        `${group.producers.join(" and ")} run \`${
          group.commands.join(" && ")
        }\``
      );
      checks.push({
        name: "producer coverage",
        ok: true,
        status: "warn",
        detail: `${summary}; matching commands require separate executions: ${
          repeats.join("; ")
        }`,
        fix:
          'review the differing inputs, prerequisites, and execution settings. Compatible jobs already share an execution; standards can reference a shared producer with `producer = "jobs.<name>"` or `producer = "standards.<name>"`',
      });
    } else {
      checks.push({ name: "producer coverage", ok: true, detail: summary });
    }
    checks.push({
      name: "evidence reuse",
      ok: true,
      detail: producers.candidate_bound.length === 0
        ? producers.producers.length === 0
          ? "no producers configured yet"
          : "every producer declares its inputs, so unchanged evidence is reused across commits"
        : `candidate-bound: ${
          list(producers.candidate_bound)
        }. Evidence for these is produced again for every commit. ${CANDIDATE_BOUND_REMEDY}`,
    });
  }
  return checks;
}

/** The completion store observed once, or undefined outside a usable repository. */
async function observeStore(
  root: string,
  clock: Clock,
): Promise<CompletionObservation | undefined> {
  if (!await observableCompletionCheckout(root)) return undefined;
  if (await openCompletionRecordStore(root) === undefined) return undefined;
  return await observeCompletionRecords(root, clock);
}

/** Read-only checks over the durable completion records. */
export async function completionRecordChecks(
  root: string,
  clock: Clock = SYSTEM_CLOCK,
): Promise<DoctorDraftCheck[]> {
  const observation = await observeStore(root, clock);
  if (observation === undefined) return [];
  const checks: DoctorDraftCheck[] = [];

  const unreadable = observation.records.filter(({ reading }) =>
    reading.kind !== "recorded" && reading.kind !== "missing"
  );
  const newer = unreadable.filter(({ reading }) => reading.kind === "newer");
  if (newer.length > 0) {
    const found = Math.max(
      ...newer.map(({ reading }) =>
        reading.kind === "newer" ? reading.version : 0
      ),
    );
    checks.push({
      name: "completion records",
      ok: false,
      detail: `${newer.length} record${
        newer.length === 1 ? "" : "s"
      } written by a newer discern (${
        newer.map(({ selector }) => `${selector.kind}/${selector.id}`).join(
          ", ",
        )
      }). ${newerOnDiskFormatMessage("completionRecord", found)}`,
      fix:
        "update discern, then read the records again; do not edit or delete them with this build",
    });
  } else if (unreadable.length > 0) {
    checks.push({
      name: "completion records",
      ok: true,
      status: "warn",
      detail: `${unreadable.length} record${
        unreadable.length === 1 ? " is" : "s are"
      } unreadable: ${
        unreadable.map(({ selector, reading }) =>
          `${selector.kind}/${selector.id} (${reading.kind}${
            "reason" in reading ? `: ${reading.reason}` : ""
          })`
        ).join("; ")
      }`,
      fix:
        "preserve the record bytes and restore them from the engine that wrote them; nothing that reads them treats the damage as absence",
    });
  } else {
    checks.push({
      name: "completion records",
      ok: true,
      detail: observation.records.length === 0
        ? "none yet"
        : `${observation.records.length} readable`,
    });
  }

  const emergencies = await emergencyValidationStatus(root);
  if (emergencies.length > 0) {
    checks.push({
      name: "emergency validation",
      ok: true,
      status: "warn",
      detail: `${emergencies.length} emergency landing${
        emergencies.length === 1 ? "" : "s"
      } still ${
        emergencies.length === 1 ? "has" : "have"
      } validation outstanding: ${
        emergencies.map((row) =>
          `${row.landing_id} at ${
            row.head.slice(0, 12)
          } (${row.exceptions.length} exception${
            row.exceptions.length === 1 ? "" : "s"
          })`
        ).join("; ")
      }`,
      fix: emergencies[0]?.next_action ??
        "run discern done --rerun on the current committed trunk",
    });
  }
  return checks;
}
