/**
 * Compact, deterministic number formatting for user-facing evidence.
 *
 * Values keep at most 4 significant digits. Values below 1 million retain
 * their full scale with grouping; larger values use a compact suffix.
 */

const COMPACT_SCALES = [
  { threshold: 1_000_000_000_000, suffix: "T" },
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
] as const;

const SIGNIFICANT = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 4,
  useGrouping: true,
});
const INTEGER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/** Format one finite number for a compact evidence sentence. */
export function formatHumanNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`cannot format a non-finite number: ${value}`);
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  const scale = COMPACT_SCALES.find((candidate) =>
    magnitude >= candidate.threshold
  );
  if (scale !== undefined) {
    return `${SIGNIFICANT.format(normalized / scale.threshold)}${scale.suffix}`;
  }
  if (Number.isInteger(normalized)) {
    return INTEGER.format(normalized);
  }
  return SIGNIFICANT.format(normalized);
}
