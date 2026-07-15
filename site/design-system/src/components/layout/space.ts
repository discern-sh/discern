export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24;
export function spaceValue(step: SpaceStep): string {
  return step === 0 ? "0" : `var(--discern-space-${step})`;
}
