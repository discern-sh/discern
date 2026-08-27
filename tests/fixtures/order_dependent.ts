/** Deliberately unsafe test module used to prove seeded shuffle catches order. */

const observed: string[] = [];

Deno.test("order fixture records evidence", () => {
  observed.push("ready");
});

Deno.test("order fixture assumes earlier evidence", () => {
  if (observed.length === 0) {
    throw new Error("order-dependent fixture ran its reader before its writer");
  }
});
