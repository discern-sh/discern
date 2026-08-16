/**
 * The scriptorium's pen: the narrowest possible write-back. A save replaces
 * exactly one string-literal prose field, in memory, through the syntax view
 * — never a structural rewrite, never a template, never an id. Everything
 * else the save-and-prove pipeline needs (formatting, re-rendering, guards,
 * the swap into place) happens around this module, not in it; the patcher
 * stays boring on purpose.
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

/** One requested prose replacement. */
export interface PatchRequest {
  readonly registry: RegistryName;
  readonly slug: string;
  readonly field: string;
  readonly value: string;
}

/** The patch outcome: the whole patched source, or the refusal. */
export type PatchOutcome =
  | { readonly ok: true; readonly file: string; readonly text: string }
  | { readonly ok: false; readonly issue: string };

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

/**
 * Apply one prose replacement in memory and return the full patched source.
 * The real file is untouched; the caller owns formatting, proving, and the
 * swap into place.
 */
export function patchRegistrySource(
  root: string,
  request: PatchRequest,
): PatchOutcome {
  const valueIssue = proseValueIssue(request.value);
  if (valueIssue !== undefined) return { ok: false, issue: valueIssue };

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
  if (spec.edit !== "prose") {
    return {
      ok: false,
      issue: spec.edit === "locked"
        ? `${request.field} is locked: ${spec.reason}`
        : `${request.field} is ${spec.edit}, not in-place prose`,
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
  if (target.kind !== "string" || !Node.isStringLiteral(target.node)) {
    return {
      ok: false,
      issue:
        `${request.field} is ${target.kind} in the source — derived spans stay IDE jumps`,
    };
  }

  target.node.setLiteralValue(request.value);
  return {
    ok: true,
    file: entry.file,
    text: target.node.getSourceFile().getFullText(),
  };
}
