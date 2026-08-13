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
    sourceCommit: "49104c19ddb978b6d78b7327ef7658e80a640095",
  },
  {
    slug: "seal",
    title: "The seal",
    description:
      "Scattered fragments register into one exact triangle whose right half takes ink under a confirming sweep, until a single fragment drifts.",
    sourceCommit: "73f09b4994be31ed1b8e1cb56e28b454239d7c5d",
  },
  {
    slug: "delta",
    title: "The delta",
    description:
      "One line opens into parallel channels whose travelling marks work apart, wait for one another, and reconverge through a single settling point.",
    sourceCommit: "48f1d3509b67195281102bfabacfa46cd03fcde7",
  },
  {
    slug: "ratchet",
    title: "The ratchet",
    description:
      "A trembling measure tightens two converging limits notch by notch until their corridor closes into an apex and begins again, finer.",
    sourceCommit: "c238e1237cea38fed67ee2f67fae88551b88ff75",
  },
  {
    slug: "rule",
    title: "The rule",
    description:
      "Compass arcs subdivide one triangle through three quiet generations and one small pulse retraces the figure before the construction unwinds.",
    sourceCommit: "5b3e48ae75dc345aa63454cf2063d11923046634",
  },
  {
    slug: "survey",
    title: "The survey",
    description:
      "Measuring marks study an irregular found figure until one exact triangle inscribes itself within it and rests fitted to its bounds.",
    sourceCommit: "2a94d9131027085e1d2869c631445d7fd67bd023",
  },
  {
    slug: "interference",
    title: "The interference",
    description:
      "Two fine triangular line grids drift slowly against each other inside one bounded triangle, letting larger figures bloom, travel, and settle home.",
    sourceCommit: "abb4c5474843a8892d65523a2e50f93819238176",
  },
  {
    slug: "mesh",
    title: "The mesh",
    description:
      "Fourteen scattered sites admit one triangulation, empty-circle tests re-derive it, and the central cell takes the mark.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "phase",
    title: "The phase",
    description:
      "A field of cells inverts one at a time as a slanted front crosses it, holds inverted, and inverts back behind the next.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "prism",
    title: "The prism",
    description:
      "One beam enters a triangular body at an angle and leaves it decomposed, each component deviating by its own amount.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "packing",
    title: "The packing",
    description:
      "A triangle fills itself with self-similar cells in order of size while a measure records the area it can never reach.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "quorum",
    title: "The quorum",
    description:
      "Five witnesses return verdicts independently, one hesitating, and the composite mark inks only on unanimity.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "isolate",
    title: "The isolate",
    description:
      "Three sealed chambers each work at their own angle without ever crossing, and their trunk carries all three at once.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "ledger",
    title: "The ledger",
    description:
      "Entries seat upward, each keyed to the one below, until one cut to a wider key overhangs the notch and is refused.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "gate",
    title: "The gate",
    description:
      "A stream is measured against one fixed aperture; those that clear it carry on and one cut too wide is turned back.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
  {
    slug: "shadow",
    title: "The shadow",
    description:
      "One solid drawn from three vantages, every wireframe differing, every footprint the identical split triangle.",
    sourceCommit: "0000000000000000000000000000000000000000",
  },
] as const satisfies readonly BrowserArtworkMetadata[];

/** The shared foundation stylesheet every figure-series member consumes. */
export const BROWSER_ART_FOUNDATION_STYLESHEET = "art-figures.css";

/**
 * The figure-series members bound to the shared metre in figures.css.
 * A slug listed here enrols in the series-law structural tests.
 */
export const FIGURE_SERIES_SLUGS = [
  "circuit",
  "seal",
  "delta",
  "ratchet",
  "rule",
  "survey",
  "interference",
  "mesh",
  "phase",
  "prism",
  "packing",
  "quorum",
  "isolate",
  "ledger",
  "gate",
  "shadow",
] as const satisfies readonly BrowserArtworkSlug[];

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
