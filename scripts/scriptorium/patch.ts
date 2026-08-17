/**
 * The scriptorium's pen: the narrowest possible write-back. A save replaces
 * exactly one editable literal — prose string or supported typed string list
 * — in memory, through the syntax view. Never a structural rewrite, template,
 * or id. Everything else the save-and-prove pipeline needs happens around
 * this module, not in it; the patcher stays boring on purpose.
 */

import { Node } from "ts-morph";
import {
  fieldTarget,
  findEntries,
  openRegistryProject,
  registryEntries,
} from "./registry_ast.ts";
import type { RegistryName } from "./registry_ast.ts";
import { fieldSpecFor } from "./fields.ts";
import { MARK_CLOSE, MARK_OPEN, MARK_SEP } from "./annotation.ts";
import { type PickerCatalogEntry, pickerFromCatalog } from "./pickers.ts";

/** The field address shared by every patch request. */
interface PatchAddress {
  readonly registry: RegistryName;
  readonly slug: string;
  readonly field: string;
}

/** One requested prose replacement. */
export interface ProsePatchRequest extends PatchAddress {
  readonly mode: "prose";
  /** The literal value the editor opened; write-back is compare-and-swap. */
  readonly expected: string;
  readonly value: string;
}

/** One requested ordered-list replacement. */
export interface ListPatchRequest extends PatchAddress {
  readonly mode: "list";
  /** The complete ordered list the editor opened; write-back is CAS. */
  readonly expected: readonly string[];
  readonly value: readonly string[];
}

/** One settled patch request, validated structurally at the HTTP boundary. */
export type PatchRequest = ProsePatchRequest | ListPatchRequest;

/** Live option authorities available to the pure patch decision. */
export interface PatchContext {
  readonly pickers?: readonly PickerCatalogEntry[];
}

/** The patch outcome: the whole patched source, or the refusal. */
export type PatchOutcome =
  | { readonly ok: true; readonly file: string; readonly text: string }
  | { readonly ok: false; readonly issue: string; readonly conflict?: true };

/** Refuse values that cannot be honest single-paragraph registry prose. */
export function proseValueIssue(value: string): string | undefined {
  if (value.trim() === "") return "prose cannot be empty";
  if (/[\r\n]/.test(value)) {
    return "registry prose is a single paragraph — no line breaks";
  }
  for (const marker of [MARK_OPEN, MARK_SEP, MARK_CLOSE]) {
    if (value.includes(marker)) {
      return "the value carries a studio annotation marker";
    }
  }
  return undefined;
}

/** Refuse duplicate or out-of-registry list values before syntax mutation. */
export function listValueIssue(
  values: readonly string[],
  picker: PickerCatalogEntry,
): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return `the list repeats ${value}`;
    seen.add(value);
  }
  const allowed = new Set(picker.options.map((option) => option.value));
  const unknown = values.find((value) => !allowed.has(value));
  return unknown === undefined
    ? undefined
    : `${unknown} is not a live ${picker.source} value — reload the picker`;
}

/** Ordered array equality for compare-and-swap. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Apply one settled literal replacement in memory and return the full source.
 * The real file is untouched; the caller owns formatting, proving, and the
 * swap into place.
 */
export function patchRegistrySource(
  root: string,
  request: PatchRequest,
  context: PatchContext = {},
): PatchOutcome {
  if (request.mode === "prose") {
    const valueIssue = proseValueIssue(request.value);
    if (valueIssue !== undefined) return { ok: false, issue: valueIssue };
  }

  const project = openRegistryProject(root);
  const entries = registryEntries(project, root).filter(
    (entry) => entry.registry === request.registry,
  );
  const matches = findEntries(entries, request.slug).filter(
    (entry) => entry.slug === request.slug,
  );
  const entry = matches[0];
  if (entry === undefined || matches.length !== 1) {
    return {
      ok: false,
      issue: `no ${request.registry} entry has the slug ${request.slug}`,
    };
  }

  const spec = fieldSpecFor(entry.registry, entry.kind, request.field);
  if (spec === undefined) {
    return {
      ok: false,
      issue: `${request.field} has no studio semantics on a ${entry.kind}`,
    };
  }
  if (request.mode === "prose" && spec.edit !== "prose") {
    return {
      ok: false,
      issue: spec.edit === "locked"
        ? `${request.field} is locked: ${spec.reason}`
        : `${request.field} is ${spec.edit}, not in-place prose`,
    };
  }
  if (
    request.mode === "list" &&
    (spec.edit !== "list" || spec.write !== "picker")
  ) {
    return {
      ok: false,
      issue: spec.edit === "locked"
        ? `${request.field} is locked: ${spec.reason}`
        : spec.edit === "list"
        ? `${request.field} has no in-studio picker write-back`
        : `${request.field} is ${spec.edit}, not a typed list`,
    };
  }

  const target = fieldTarget(entry, request.field);
  if (target === undefined) {
    return {
      ok: false,
      issue:
        `${entry.id} declares no ${request.field} — adding a field is structural work`,
    };
  }
  if (request.mode === "prose") {
    if (target.kind !== "string" || !Node.isStringLiteral(target.node)) {
      return {
        ok: false,
        issue:
          `${request.field} is ${target.kind} in the source — derived spans stay IDE jumps`,
      };
    }

    const current = target.node.getLiteralValue();
    if (current !== request.expected) {
      return {
        ok: false,
        issue:
          `${request.field} changed on disk after the editor opened — reload before saving so neither version is overwritten`,
        conflict: true,
      };
    }

    target.node.setLiteralValue(request.value);
    return {
      ok: true,
      file: entry.file,
      text: target.node.getSourceFile().getFullText(),
    };
  }

  if (spec.edit !== "list" || spec.write !== "picker") {
    throw new Error("list patch reached non-list semantics");
  }
  const picker = pickerFromCatalog(context.pickers ?? [], spec.picker);
  if (picker === undefined) {
    return {
      ok: false,
      issue:
        `${request.field} has no supported ${spec.picker} picker in this studio`,
    };
  }
  const valueIssue = listValueIssue(request.value, picker);
  if (valueIssue !== undefined) return { ok: false, issue: valueIssue };
  if (
    target.kind !== "string-array" ||
    !Node.isArrayLiteralExpression(target.node)
  ) {
    return {
      ok: false,
      issue:
        `${request.field} is ${target.kind} in the source — derived lists stay IDE jumps`,
    };
  }
  const current = target.node.getElements().map((element) => {
    if (!Node.isStringLiteral(element)) {
      throw new Error("string-array classification admitted a non-string");
    }
    return element.getLiteralValue();
  });
  if (!sameList(current, request.expected)) {
    return {
      ok: false,
      issue:
        `${request.field} changed on disk after the editor opened — reload before saving so neither version is overwritten`,
      conflict: true,
    };
  }

  target.node.replaceWithText(JSON.stringify(request.value));
  return {
    ok: true,
    file: entry.file,
    text: target.node.getSourceFile().getFullText(),
  };
}
