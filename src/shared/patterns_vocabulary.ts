/**
 * The `patterns` verb's **wire vocabulary and data shapes** — the detector
 * enums the registry derives from, and the Zod schemas its `data` payloads
 * validate against.
 *
 * A dedicated module (rather than a section of `result_schemas.ts`) because
 * the logbook subsystem sits behind the no-network guard, which walks every
 * module it imports: this file's whole dependency footprint is Zod, so the
 * detector registry can share one vocabulary with the wire layer without
 * pulling the rest of the result-schema surface inside the wall.
 * `result_schemas.ts` re-exports everything here, so wire consumers keep one
 * import site.
 */

import { z } from "@zod/zod";

/** The detector families the `patterns` registry groups by: how agents behave,
 * how the gate fits the stack, how the task funnel flows, and how the numbers
 * move over time. SSOT for the family vocabulary — the schema enums below and
 * the engine's detector registry both derive from it. */
export const DETECTOR_FAMILIES = [
  "behaviour",
  "gate-fit",
  "funnel",
  "trajectory",
] as const;
/** One detector family ({@link DETECTOR_FAMILIES}). */
export type DetectorFamily = (typeof DETECTOR_FAMILIES)[number];

/** What a finding is ABOUT — the surface a later wave routes it to: one
 * branch's work, one conversation's runs, or the whole project. */
export const DETECTOR_SCOPES = ["branch", "session", "project"] as const;
/** One detector scope ({@link DETECTOR_SCOPES}). */
export type DetectorScope = (typeof DETECTOR_SCOPES)[number];

/** How costly a detector is to run: `inline` is cheap enough for the receipt
 * and `status` to carry (a glance at recent events); `batch` runs only under
 * the `patterns` verb, so `done` never pays for longitudinal analysis. */
export const DETECTOR_TIERS = ["inline", "batch"] as const;
/** One detector tier ({@link DETECTOR_TIERS}). */
export type DetectorTier = (typeof DETECTOR_TIERS)[number];

/** How a detector's run turned out: it spoke (`fired`), it saw enough evidence
 * and found nothing (`quiet`), or the logbook is too young for it to speak
 * (`insufficient-evidence` — reported as such, never extrapolated past). */
export const DETECTOR_STATUSES = [
  "fired",
  "quiet",
  "insufficient-evidence",
] as const;
/** One detector status ({@link DETECTOR_STATUSES}). */
export type DetectorStatus = (typeof DETECTOR_STATUSES)[number];

/** One `patterns` finding: which detector spoke, what it observed (one
 * plain-count sentence), the named counts behind it, and the recommended next
 * step. `strength` is the report's ranking key — unitless, never evidence. */
const patternsFindingSchema = z.strictObject({
  detector: z.string(),
  family: z.enum(DETECTOR_FAMILIES),
  scope: z.enum(DETECTOR_SCOPES),
  subject: z.string().optional(),
  observed: z.string(),
  evidence: z.record(z.string(), z.number()),
  strength: z.number(),
  next_step: z.string(),
});
/** One patterns finding. */
export type PatternsFinding = z.infer<typeof patternsFindingSchema>;

/** One detector's run in a `patterns` report: its registry identity, how many
 * qualifying events it saw against its threshold, and how it turned out —
 * `insufficient-evidence` is reported, never hidden. `findings` is the count;
 * the findings themselves ride the top-level ranked list. */
const patternsDetectorSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  family: z.enum(DETECTOR_FAMILIES),
  scope: z.enum(DETECTOR_SCOPES),
  tier: z.enum(DETECTOR_TIERS),
  status: z.enum(DETECTOR_STATUSES),
  considered: z.number().int(),
  threshold: z.number().int(),
  findings: z.number().int(),
});
/** One detector's reported run. */
export type PatternsDetector = z.infer<typeof patternsDetectorSchema>;

/** The logbook the report was read from, in counts: parsed events, skipped
 * torn/foreign lines, month files, the span, distinct branches seen, and
 * whether recording is currently on (`[project].logbook`) — the report reads
 * existing history either way. */
const patternsLogbookSchema = z.strictObject({
  events: z.number().int(),
  unparsed: z.number().int(),
  months: z.number().int(),
  first_at: z.string().optional(),
  last_at: z.string().optional(),
  branches: z.number().int(),
  recording: z.boolean(),
});

/** Who plausibly drove the analyzed runs, scored by the reader from recorded
 * driver evidence — never stored, so a smarter release re-scores all history.
 * `analyzed` counts the analysis population (CI and previews excluded);
 * `agent`/`human`/`unknown` partition it. `identities` counts the runs whose
 * invocation-scoped evidence names exactly one agent, by stable catalogue id
 * with its display label — ambient host state and conflicting evidence
 * attribute nothing, so the identity counts can sum below `agent`. */
const patternsPopulationSchema = z.strictObject({
  analyzed: z.number().int(),
  agent: z.number().int(),
  human: z.number().int(),
  unknown: z.number().int(),
  identities: z.array(z.strictObject({
    agent: z.string(),
    label: z.string(),
    runs: z.number().int(),
  })),
});
/** The scored driver population of one report. */
export type PatternsPopulation = z.infer<typeof patternsPopulationSchema>;

/** `patterns` — the logbook read back as findings: `findings` ranked by
 * evidence strength, `detectors` reporting every registry member (fired,
 * quiet, or insufficient evidence), the `logbook` counts behind them, and the
 * scored driver `population`. */
export const PatternsDataSchema = z.strictObject({
  logbook: patternsLogbookSchema,
  population: patternsPopulationSchema,
  findings: z.array(patternsFindingSchema),
  detectors: z.array(patternsDetectorSchema),
});
export type PatternsData = z.infer<typeof PatternsDataSchema>;

/** `patterns reset` — what the deletion (or its `--dry-run` preview) covers:
 * the logbook directory and every file in it, with sizes. */
export const PatternsResetDataSchema = z.strictObject({
  dir: z.string(),
  removed: z.array(z.strictObject({
    file: z.string(),
    bytes: z.number().int(),
  })),
  bytes: z.number().int(),
});
export type PatternsResetData = z.infer<typeof PatternsResetDataSchema>;
