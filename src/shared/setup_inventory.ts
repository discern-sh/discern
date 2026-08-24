/**
 * Mechanical completion inventory for setup's closing relay.
 *
 * The agent must not count the Map, ledger, or job states from memory. This
 * module derives those facts from the configured authorities after the final
 * setup tree has been proved, so every presentation can quote one inventory.
 */

import { join } from "@std/path";
import type { DiscernConfig } from "./config_schema.ts";
import type { SetupAssurance } from "./setup_assurance.ts";

export interface SetupCompletionInventory {
  map_regions: { count: number; items: string[] };
  ledger_items: { count: number; items: string[] };
  jobs: {
    enforced: string[];
    deferred: string[];
    absent: string[];
    not_applicable: string[];
  };
}

/** Read the configured top-level numbered Map regions in stable path order. */
async function mapRegions(root: string, mapDir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(join(root, mapDir))) {
      if (entry.isDirectory && /^\d{2}-.+/.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names.toSorted();
}

/** Extract every open checkbox from the configured ledger in source order. */
function openLedgerItems(markdown: string): string[] {
  const items: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*-\s+\[\s\]\s+(.+?)\s*$/);
    if (match === null) continue;
    const body = match[1] ?? "";
    const title = body.match(/^\*\*(.+?)\*\*/)?.[1] ?? body;
    items.push(title.trim());
  }
  return items;
}

/** Read open ledger items, treating a missing configured ledger as empty. */
async function ledgerItems(root: string, todoRel: string): Promise<string[]> {
  try {
    return openLedgerItems(await Deno.readTextFile(join(root, todoRel)));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}

/** Derive the exact completion counts and lists used by every closing surface. */
export async function deriveSetupCompletionInventory(
  root: string,
  config: DiscernConfig,
  assurance: SetupAssurance,
): Promise<SetupCompletionInventory> {
  const [regions, ledger] = await Promise.all([
    mapRegions(root, config.map.dir),
    ledgerItems(root, config.project.todo),
  ]);
  const notApplicable = assurance.known_jobs.filter((job) =>
    job.not_applicable === true
  ).map((job) => job.name);
  const applicable = assurance.known_jobs.filter((job) =>
    job.not_applicable !== true
  );
  return {
    map_regions: { count: regions.length, items: regions },
    ledger_items: { count: ledger.length, items: ledger },
    jobs: {
      enforced: applicable.filter((job) => job.state === "enforced").map((
        job,
      ) => job.name),
      deferred: applicable.filter((job) => job.state === "deferred").map((
        job,
      ) => job.name),
      absent: applicable.filter((job) => job.state === "absent").map((job) =>
        job.name
      ),
      not_applicable: notApplicable,
    },
  };
}

export const _setupInventoryTest = { openLedgerItems };
