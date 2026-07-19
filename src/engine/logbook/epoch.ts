/**
 * The **config epoch** — a fingerprint of `discern.toml`'s behaviour-relevant
 * projection, stamped on every logbook event so longitudinal readers can tell
 * REAL reconfiguration from the standards ratchet doing its job.
 *
 * `discern.toml` churns by design: every `standards --pin` rewrites a limit, so
 * hashing the whole file would shatter history into useless slivers precisely in
 * the healthiest repositories — the ones ratcheting. Instead each TOP-LEVEL
 * SECTION is hashed on its own with volatile values masked out, and the combined
 * fingerprint is the epoch:
 *
 *  - a pin (a `limit` edit) changes NO section hash — the limit is masked;
 *  - a real edit (a command, an input list, a measure mode) flips exactly the
 *    section it lives in, and the recorder logs a `config-change` event naming it.
 *
 * The masking table (the deliberate exceptions):
 *  - `standards` — each entry's `limit` is masked; its command, `metric`,
 *    `direction`, `per`, `scale`, `margin`, `inputs`, `measure`, and `timeout`
 *    are kept. Only the limit is the ratchet's write target.
 *  - `meta` — masked whole: installer bookkeeping (schema version, setup
 *    provenance) that changes on `upgrade` without changing what any verb does.
 *
 * The SECTION LIST is never hand-copied: it iterates `configSchema.shape`, the
 * config's single source of truth, so a new section auto-enrols (hashed unmasked
 * until a deliberate mask is added here). Hashing uses the shared POSIX `cksum`
 * over a canonical (sorted-key) JSON projection of the FULLY-DEFAULTED config,
 * so an absent section and an explicitly-defaulted one fingerprint identically,
 * and a purely cosmetic reordering of tables in the file changes nothing.
 */

import {
  configSchema,
  type DiscernConfig,
} from "../../shared/config_schema.ts";
import { cksumString } from "../../shared/crc.ts";

/** One computed epoch: the per-section hashes and their combined fingerprint. */
export interface ConfigEpoch {
  /** Masked hash per top-level config section, keyed by section name. */
  sections: Record<string, string>;
  /** The combined fingerprint stamped on each event. */
  fingerprint: string;
}

/** A section's masking transform: the projection hashed instead of the raw value. */
type SectionMask = (value: unknown) => unknown;

/** True for a non-null, non-array object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mask each `[standards.<name>]` entry's `limit`, keeping every other knob. */
function maskStandardLimits(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) {
    out[name] = isRecord(entry) ? { ...entry, limit: null } : entry;
  }
  return out;
}

/**
 * The masking table — the DELIBERATE exceptions to "hash the section verbatim".
 * Keyed by top-level section name; a section absent here hashes unmasked. Kept
 * intentionally small: masking hides drift from readers, so every entry needs
 * the argument its doc line carries (see the module doc).
 */
const SECTION_MASKS: Readonly<Record<string, SectionMask>> = {
  standards: maskStandardLimits,
  meta: () => null,
};

/**
 * Canonical JSON: like `JSON.stringify`, but with object keys sorted at every
 * depth and undefined-valued keys dropped — so two structurally-equal configs
 * serialize identically regardless of declaration order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A cksum rendered as fixed-width lowercase hex. */
function hex(n: number): string {
  return n.toString(16).padStart(8, "0");
}

/**
 * Compute the config epoch for a fully-defaulted config: one masked hash per
 * `configSchema` section (the SSOT section list — a new section auto-enrols),
 * combined into the per-event fingerprint. Pure.
 */
export function configEpoch(config: DiscernConfig): ConfigEpoch {
  const sections: Record<string, string> = {};
  const asRecord = config as unknown as Record<string, unknown>;
  for (const name of Object.keys(configSchema.shape).sort()) {
    const mask = SECTION_MASKS[name] ?? ((v: unknown): unknown => v);
    sections[name] = hex(cksumString(canonicalJson(mask(asRecord[name]))));
  }
  const combined = Object.entries(sections)
    .map(([name, digest]) => `${name}:${digest}`)
    .join("\n");
  return { sections, fingerprint: hex(cksumString(combined)) };
}

/**
 * The section names whose hashes differ between two epochs — what a
 * `config-change` event names. Sorted; a section present on only one side
 * (a schema migration boundary) counts as changed.
 */
export function changedSections(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}
