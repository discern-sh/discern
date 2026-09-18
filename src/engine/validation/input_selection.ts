/** Observe only applicable inputs; absent declarations retain the candidate-wide fallback. */
import type { ObligationDeclaration, ResolvedProducer } from "./catalog.ts";
import { producerClosure } from "./demand.ts";
import { classifyPattern, pathMatchesPattern } from "../scopes/glob.ts";
import type { ValidationTextMeasures } from "./input_identity.ts";
import { planStandardInput } from "../../shared/config_schema.ts";

export interface ValidationInputSelection {
  readonly toolchain: readonly string[];
  /** Null means the producer or extractor has not declared a complete closure. */
  readonly patterns: readonly string[] | null;
  /** Only extent denominators request text work; every selected file is still hashed. */
  readonly text?: Readonly<
    Partial<Record<"lines" | "words", readonly string[]>>
  >;
}

/** Dependencies, extractors and extent denominators contribute to the same closure. */
export function validationInputSelection(
  producers: ReadonlyMap<string, ResolvedProducer>,
  obligations: readonly (ObligationDeclaration & { producer: string })[],
  demandedProducers: readonly string[] = [],
): ValidationInputSelection {
  const nodes = [
    ...producerClosure(producers, [
      ...demandedProducers,
      ...obligations.map((entry) => entry.producer),
    ])
      .values(),
  ];
  const text: Partial<Record<"lines" | "words", string[]>> = {};
  for (const entry of obligations) {
    const per = entry.standard?.per;
    if (
      per?.kind === "extent" &&
      (per.measure === "lines" || per.measure === "words")
    ) {
      (text[per.measure] ??= []).push(...per.globs);
    }
  }
  return {
    text,
    toolchain: [...new Set(nodes.flatMap((node) => node.recipe.toolchain))],
    patterns: nodes.some((node) => node.recipe.inputs === undefined) ||
        obligations.some((entry) =>
          planStandardInput(entry.input).extraction !== null &&
          entry.inputs === undefined
        )
      ? null
      : [
        ...nodes.flatMap((node) => node.recipe.inputs ?? []),
        ...obligations.flatMap((entry) => entry.inputs ?? []),
        ...obligations.flatMap((entry) =>
          entry.standard?.per?.kind === "extent" ? entry.standard.per.globs : []
        ),
      ],
  };
}

/** Filter before touching a listed filesystem boundary, including submodules and nested repositories. */
export function selectedValidationInput(
  path: string,
  selection?: ValidationInputSelection,
): boolean {
  return selection === undefined || selection.patterns === null ||
    selection.toolchain.includes(path) ||
    selection.patterns.some((pattern) =>
      pathMatchesPattern(path.replace(/\/$/u, ""), pattern)
    );
}

/** A repository boundary must not disappear when a declaration names its descendants.
 * Ambiguous wildcard intersections retain the boundary for an explicit unsupported-input refusal.
 */
export function selectedValidationBoundary(
  path: string,
  selection?: ValidationInputSelection,
): boolean {
  const boundary = path.replace(/\/$/u, "");
  if (selectedValidationInput(boundary, selection) || selection === undefined) {
    return true;
  }
  return selection.toolchain.some((file) => file.startsWith(`${boundary}/`)) ||
    selection.patterns?.some((pattern) => {
        const kind = classifyPattern(pattern)?.name;
        if (kind === undefined) return false;
        if (kind === "segment" || kind === "suffix") return true;
        if (kind === "exact") return pattern.startsWith(`${boundary}/`);
        const segments = pattern.replace(/^\//u, "").split("/");
        const fixed: string[] = [];
        for (const segment of segments) {
          if (classifyPattern(segment)?.name !== "exact") break;
          fixed.push(segment);
        }
        const prefix = fixed.join("/").replace(/\/$/u, "");
        return prefix === "" || boundary === prefix ||
          prefix.startsWith(`${boundary}/`) ||
          boundary.startsWith(`${prefix}/`);
      }) === true;
}

/** Text work follows the requested measure and its own denominator paths. */
export function selectedValidationText(
  path: string,
  selection?: ValidationInputSelection,
): ValidationTextMeasures {
  return {
    lines:
      selection?.text?.lines?.some((pattern) =>
        pathMatchesPattern(path, pattern)
      ) ?? false,
    words:
      selection?.text?.words?.some((pattern) =>
        pathMatchesPattern(path, pattern)
      ) ?? false,
  };
}
