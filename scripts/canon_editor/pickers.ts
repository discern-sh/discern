/**
 * Typed list choices for Canon Editor. Field semantics own which exact
 * list fields have write-back; this module exhaustively handles the option
 * sources those fields name. Every option derives from the registry that owns
 * the value, never from a copied browser list.
 */

import { HINTS } from "../../src/shared/hints.ts";
import {
  allFeatureNodes,
  allHumanBenefitEntries,
  SURFACE_SETS,
} from "../feature_registry.ts";
import { liveFeatureSurfaceMembers } from "../feature_surface_catalog.ts";
import { CLAIMS } from "../brand/claims.ts";
import type { PickerSource } from "./fields.ts";

/** One saved value and its picker presentation. */
export interface PickerOption {
  readonly value: string;
  readonly label: string;
  readonly group?: string | undefined;
}

/** One supported typed picker and its complete live option set. */
export interface PickerCatalogEntry {
  readonly source: WritablePickerSource;
  readonly options: readonly PickerOption[];
}

type PickerBuilder = () =>
  | readonly PickerOption[]
  | Promise<readonly PickerOption[]>;

/**
 * The handled subset of the field-semantics picker vocabulary. The parity
 * guard binds these handlers both ways to fields marked `write: "picker"`.
 */
const PICKER_BUILDERS = {
  "feature-node": (): readonly PickerOption[] =>
    allFeatureNodes().map(({ node, parent }) => ({
      value: node.id,
      label: node.title,
      ...(parent === undefined ? {} : { group: parent }),
    })),
  "benefit-entry": (): readonly PickerOption[] =>
    allHumanBenefitEntries().map(({ cluster, entry }) => ({
      value: entry.id,
      label: entry.title,
      group: cluster.title,
    })),
  claim: (): readonly PickerOption[] =>
    Object.entries(CLAIMS).map(([value, claim]) => ({
      value,
      label: claim.title,
    })),
  hint: (): readonly PickerOption[] =>
    Object.entries(HINTS).map(([value, hint]) => ({
      value,
      label: value,
      group: hint.category,
    })),
  surface: async (): Promise<readonly PickerOption[]> => {
    const members = await liveFeatureSurfaceMembers();
    return SURFACE_SETS.flatMap((group) =>
      members[group].map((member) => ({
        value: `${group}:${member}`,
        label: `${group}:${member}`,
        group,
      }))
    );
  },
} as const satisfies Partial<Record<PickerSource, PickerBuilder>>;

/** A picker source whose complete option authority is wired into the editor. */
export type WritablePickerSource = keyof typeof PICKER_BUILDERS;

/** The supported source names, derived from the builder table. */
export const WRITABLE_PICKER_SOURCES: readonly WritablePickerSource[] = Object
  .keys(PICKER_BUILDERS) as WritablePickerSource[];

/** Build the serialized catalog in the builder table's stable order. */
export async function buildPickerCatalog(): Promise<PickerCatalogEntry[]> {
  const catalog: PickerCatalogEntry[] = [];
  for (const source of WRITABLE_PICKER_SOURCES) {
    catalog.push({ source, options: await PICKER_BUILDERS[source]() });
  }
  return catalog;
}

/** Find a supported picker by its field-semantics source. */
export function pickerFromCatalog(
  catalog: readonly PickerCatalogEntry[],
  source: PickerSource,
): PickerCatalogEntry | undefined {
  return catalog.find((entry) => entry.source === source);
}
