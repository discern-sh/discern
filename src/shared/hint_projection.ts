/** Hint delivery preserves registry identities across wire and surface projections. */
import type { DiscernResult } from "./result.ts";
import type { FiredHint } from "./hints.ts";

/**
 * The in-process identity carried by one projected `hints[]` array. A WeakMap
 * keeps the metadata off the public array and lets it disappear with the
 * result; serialization therefore remains `string[]` while the logbook can
 * recover the ids from the exact envelope it records.
 */
const firedHintsByTexts = new WeakMap<
  readonly string[],
  readonly FiredHint[]
>();

/** Project fired hints onto the envelope's wire shape, order preserved. */
export function hintTexts(fired: readonly FiredHint[]): string[] {
  const texts = fired.map((f) => f.text);
  firedHintsByTexts.set(texts, [...fired]);
  return texts;
}

/** Recover the fired pairs associated with one projected wire array. */
export function firedHintsFromTexts(
  texts: readonly string[] | undefined,
): FiredHint[] {
  return texts === undefined ? [] : [...(firedHintsByTexts.get(texts) ?? [])];
}

/**
 * Combine projected hint arrays without dropping their in-process identities.
 * Unassociated strings stay on the wire but contribute no invented id.
 */
export function mergeHintTexts(
  ...groups: readonly (readonly string[])[]
): string[] {
  const texts = groups.flatMap((group) => [...group]);
  const fired = groups.flatMap((group) => firedHintsFromTexts(group));
  firedHintsByTexts.set(texts, fired);
  return texts;
}

/** Append fired hints to an existing wire array, preserving both identities. */
export function appendHintTexts(
  existing: readonly string[] | undefined,
  fired: readonly FiredHint[],
): string[] {
  return mergeHintTexts(existing ?? [], hintTexts(fired));
}

/**
 * Re-render a wire hints array for one delivery surface: each fired entry's
 * authored command references resolve through `resolveText`, identity moves
 * to the new array, and strings with no recovered identity pass through
 * unchanged (they carry no references — only registry templates author
 * tokens). Returns the same array when nothing resolves differently, so the
 * CLI path — whose spelling `fire` already produced — costs nothing.
 */
export function resolveHintTextsForSurface(
  texts: readonly string[] | undefined,
  resolveText: (authored: string) => string,
): string[] | undefined {
  if (texts === undefined) {
    return undefined;
  }
  const fired = firedHintsFromTexts(texts);
  const resolvedByText = new Map<string, string>();
  const resolvedFired = fired.map((hint) => {
    if (hint.authored === undefined) {
      return hint;
    }
    const text = resolveText(hint.authored);
    resolvedByText.set(hint.text, text);
    return { id: hint.id, text };
  });
  const resolvedTexts = texts.map((text) => resolvedByText.get(text) ?? text);
  if (resolvedFired.length > 0) {
    firedHintsByTexts.set(resolvedTexts, resolvedFired);
  }
  return resolvedTexts;
}

/**
 * Re-render a result's hints for one delivery surface — call it at the
 * surface boundary BEFORE the envelope is observed, recorded, and serialized,
 * so the logbook and the wire carry the same rendering (hint identity itself
 * is the registry id and never changes with the surface).
 */
export function resolveResultHintsForSurface<TData>(
  result: DiscernResult<TData>,
  resolveText: (authored: string) => string,
): DiscernResult<TData> {
  const hints = resolveHintTextsForSurface(result.hints, resolveText);
  return hints === undefined ? result : { ...result, hints };
}
