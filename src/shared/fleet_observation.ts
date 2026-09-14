/** Bounded fan-out for read-only fleet facts, preserving canonical source order. */
export const FLEET_OBSERVATION_CONCURRENCY = 4;

/** Observe each fleet member once without launching a process per task at once. */
export async function observeFleet<T, R>(
  items: readonly T[],
  observe: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({
      length: Math.min(items.length, FLEET_OBSERVATION_CONCURRENCY),
    }, async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        if (item === undefined) {
          throw new TypeError("Fleet observation requires a dense collection");
        }
        result[index] = await observe(item, index);
      }
    }),
  );
  return result;
}
