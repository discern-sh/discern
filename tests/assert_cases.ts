/** Named case matrices preserve every failure without registering a test per row. */

/** Report the named failures only after every row has been checked. */
function finishCases(count: number, failures: Error[]): void {
  if (count === 0) {
    throw new Error("A case matrix must contain at least one row");
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} of ${count} cases failed: ${
        failures.map((e) => e.message).join("; ")
      }`,
    );
  }
}

/** Check synchronous cases with their names and original failure causes intact. */
export function assertCases<T>(
  cases: Iterable<T>,
  label: (row: T) => string,
  check: (row: T) => undefined,
): void {
  const failures: Error[] = [];
  let count = 0;
  for (const row of cases) {
    count++;
    const name = label(row);
    try {
      check(row);
    } catch (cause) {
      failures.push(new Error(name, { cause }));
    }
  }
  finishCases(count, failures);
}

/** Await read-only observations in order, retaining every named failure. */
export async function assertCasesAsync<T>(
  cases: Iterable<T>,
  label: (row: T) => string,
  check: (row: T) => Promise<void>,
): Promise<void> {
  const failures: Error[] = [];
  let count = 0;
  for (const row of cases) {
    count++;
    const name = label(row);
    try {
      await check(row);
    } catch (cause) {
      failures.push(new Error(name, { cause }));
    }
  }
  finishCases(count, failures);
}

/** Check named synchronous callbacks without repeating the entry adapter. */
export function assertNamedCases(
  cases: Record<string, () => undefined>,
): void {
  assertCases(Object.entries(cases), ([name]) => name, ([, check]) => check());
}

/** Await named observations in order, including synchronous observations. */
export async function assertNamedCasesAsync(
  cases: Record<string, () => undefined | Promise<void>>,
): Promise<void> {
  await assertCasesAsync(
    Object.entries(cases),
    ([name]) => name,
    async ([, check]) => {
      await check();
    },
  );
}
