/** The approved browser-art family and its pure enrolment boundary. */

/** Immutable metadata for one reviewed browser motion study. */
export interface BrowserArtworkMetadata {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly sourceCommit: string;
}

/**
 * The single authority for browser-art membership, order, metadata,
 * provenance, stylesheet serving, and structural test enrolment.
 */
export const BROWSER_ARTWORKS = [
  {
    slug: "alignment",
    title: "Alignment",
    description:
      "Three displaced planes register into one exact split triangle while a separate authority mark settles nearby.",
    sourceCommit: "3006e8622db947c4417b4df2055e28820646ad2e",
  },
  {
    slug: "bifurcation",
    title: "Bifurcation",
    description:
      "One uninterrupted sweep opens a one-to-two-to-four-to-eight branching system, terminating in restrained split marks.",
    sourceCommit: "36084a9cf3cdabd04e9734468b07bdde6f73107b",
  },
  {
    slug: "contour",
    title: "One-way contour",
    description:
      "Six softly faceted contours expand together from one compact origin into their retained final extents.",
    sourceCommit: "f7599b7669bfd3c4842c430adeb96330fbfa75d5",
  },
  {
    slug: "persistent-trace",
    title: "Persistent trace",
    description:
      "A balanced angular spiral records its inward route permanently and resolves at the exact central split mark.",
    sourceCommit: "ae15a479e7f169cbebcbf6c598d8c8b5d2ccbede",
  },
  {
    slug: "invariant-core",
    title: "Invariant core",
    description:
      "Cartesian, oblique, and radial frames change around a split triangular core that never leaves its centre.",
    sourceCommit: "9b7b3eac0f1ffd1addeb970e1167866c855a37b1",
  },
  {
    slug: "circuit",
    title: "The circuit",
    description:
      "An emblem unfolds into three stationed vertices and one pulse completes their triangular exchange before the form recollects itself.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "seal",
    title: "The seal",
    description:
      "Scattered fragments register into one exact triangle whose right half takes ink under a confirming sweep, until a single fragment drifts.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "delta",
    title: "The delta",
    description:
      "One line opens into parallel channels whose travelling marks work apart, wait for one another, and reconverge through a single settling point.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "ratchet",
    title: "The ratchet",
    description:
      "A trembling measure tightens two converging limits notch by notch until their corridor closes into an apex and begins again, finer.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "rule",
    title: "The rule",
    description:
      "Compass arcs subdivide one triangle through three quiet generations and one small pulse retraces the figure before the construction unwinds.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
] as const satisfies readonly BrowserArtworkMetadata[];

/** The shared foundation stylesheet every figure-series member consumes. */
export const BROWSER_ART_FOUNDATION_STYLESHEET = "art-figures.css";

export type BrowserArtworkSlug = typeof BROWSER_ARTWORKS[number]["slug"];

/** Derive the development stylesheet name from the membership authority. */
export function browserArtworkStylesheetName(slug: string): string {
  return `art-${slug}.css`;
}

/** Derive the ordered stylesheet projection for any registry-shaped family. */
export function browserArtworkStylesheetNames(
  artworks: readonly Pick<BrowserArtworkMetadata, "slug">[] = BROWSER_ARTWORKS,
): readonly string[] {
  return artworks.map(({ slug }) => browserArtworkStylesheetName(slug));
}
