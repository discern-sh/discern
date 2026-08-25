/** Numeric projection helpers shared by logbook discovery and reporting. */

/** Compute the middle value, averaging the two middle values for an even list. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1] ?? hi;
  return (lo + hi) / 2;
}

/** Project a number onto the one-decimal precision used by logbook evidence. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
