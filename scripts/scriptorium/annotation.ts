/**
 * The scriptorium's provenance channel through the real canon renderers.
 *
 * A renderer wraps each prose field it emits in {@link annotateProse}. With no
 * annotator installed — codegen, the sync guards, every ordinary consumer —
 * the call is the identity function and the rendered page stays byte-identical
 * to today's. The scriptorium installs {@link markerAnnotator}, whose
 * private-use-area sentinels ride through Markdown untouched and strip back
 * out losslessly; the scriptorium parity guard holds that round trip exact.
 *
 * This module stays dependency-free on purpose: the registries import it, and
 * everything that imports a registry — codegen, the standards probes, the
 * guard tests — inherits its import graph.
 */

/** Which registry a rendered prose span belongs to. */
export type ProseRegistry =
  | "feature"
  | "benefit"
  | "practice"
  | "glossary"
  | "claims";

/** The provenance of one rendered prose span. */
export interface ProseRef {
  readonly registry: ProseRegistry;
  /** The owning entry's slug: node/benefit/tenet id, term slug, claim slug. */
  readonly entry: string;
  /** Dotted field path within the entry (`what`, `plain.why`, `title`). */
  readonly field: string;
}

/** A hook wrapping rendered field text with its provenance. */
export type ProseAnnotator = (text: string, ref: ProseRef) => string;

let active: ProseAnnotator | undefined;

/** Install (or clear) the annotator the renderers route field text through. */
export function setProseAnnotator(annotator: ProseAnnotator | undefined): void {
  active = annotator;
}

/**
 * The renderers' single seam: field text passes through the installed
 * annotator, or unchanged when none is installed — the identity that keeps
 * every ordinary render byte-identical to the committed pages.
 */
export function annotateProse(text: string, ref: ProseRef): string {
  return active === undefined ? text : active(text, ref);
}

/** Opens an annotated span; carries the ref token until {@link MARK_SEP}. */
export const MARK_OPEN = String.fromCharCode(0xE000);

/** Separates a span's ref token from its field text. */
export const MARK_SEP = String.fromCharCode(0xE001);

/** Closes an annotated span. */
export const MARK_CLOSE = String.fromCharCode(0xE002);

/**
 * Serialize a ref into the colon-joined token carried inside markers. Colons,
 * unlike pipes, are inert in every Markdown context a span can land in — a
 * pipe here would split the benefit canon's at-a-glance table cells.
 */
export function refToken(ref: ProseRef): string {
  return `${ref.registry}:${ref.entry}:${ref.field}`;
}

/** Parse a marker's ref token back into a ref; undefined when malformed. */
export function parseRefToken(token: string): ProseRef | undefined {
  const [registry, entry, field, ...rest] = token.split(":");
  if (
    registry === undefined || entry === undefined || field === undefined ||
    rest.length > 0
  ) {
    return undefined;
  }
  const known: readonly string[] = [
    "feature",
    "benefit",
    "practice",
    "glossary",
    "claims",
  ];
  if (!known.includes(registry)) return undefined;
  return { registry: registry as ProseRegistry, entry, field };
}

/**
 * The scriptorium's standard annotator: wrap field text in private-use-area
 * sentinels that survive Markdown rendering as ordinary text and never occur
 * in authored prose.
 */
export function markerAnnotator(text: string, ref: ProseRef): string {
  return `${MARK_OPEN}${refToken(ref)}${MARK_SEP}${text}${MARK_CLOSE}`;
}

const STRIP_PATTERN = new RegExp(
  `${MARK_OPEN}[^${MARK_SEP}${MARK_CLOSE}]*${MARK_SEP}|${MARK_CLOSE}`,
  "g",
);

/** Remove every annotation marker, restoring the unannotated render. */
export function stripAnnotationMarkers(text: string): string {
  return text.replace(STRIP_PATTERN, "");
}

/**
 * Lowercase, dash-separated form of an id or term — the entry spelling refs
 * carry, shared with the AST layer so both sides of the scriptorium name an
 * entry identically.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
