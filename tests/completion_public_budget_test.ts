/** Public leases cover every configured producer and environment procedure. */
import { assert, assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { completionLease } from "../src/engine/landing_queue/public_completion.ts";

const base = `[project]
slug = 'lease-test'
[gate]
timeout = 10
[jobs]
test = { run = 'true', timeout = 20 }
`;

for (
  const [name, declaration, extraSeconds] of [
    [
      "custom job",
      "[jobs.extra]\nstage = 'check'\nrun = 'true'\ntimeout = 70",
      70,
    ],
    [
      "scope gate",
      "[scopes.extra]\npaths = ['feature/**']\ngate = 'true'\ntimeout = 80",
      80,
    ],
    [
      "generated output",
      "[generated.extra]\npaths = ['output']\nrun = 'true'\ntimeout = 90",
      180,
    ],
    [
      "standalone standard",
      "[standards.extra]\nrun = 'true'\ndirection = 'down'\nlimit = 1\ntimeout = 100",
      100,
    ],
    [
      "shared producer",
      "[standards.extra]\nproducer = 'jobs.test'\ndirection = 'down'\nlimit = 1",
      0,
    ],
    [
      "extraction",
      "[standards.extra]\nproducer = 'jobs.test'\nextract = 'cat'\ndirection = 'down'\nlimit = 1\ntimeout = 30",
      30,
    ],
  ] as const
) {
  Deno.test(`public completion budget includes ${name} through the canonical graph`, async () => {
    const baseline = await completionLease(parseConfigOrThrow(base));
    const expanded = await completionLease(
      parseConfigOrThrow(base + declaration),
    );
    assertEquals(expanded - baseline, extraSeconds * 1000);
  });
}

Deno.test("an empty graph still budgets its implicit producer and both lifecycle procedures", async () => {
  const config = parseConfigOrThrow("[project]\nslug = 'empty'\n");
  const lease = await completionLease(config);
  assert(lease >= 3 * config.gate.timeout * 1000);
  assert(Number.isSafeInteger(lease) && lease > 0);
});

Deno.test("unbounded job watchdogs retain a finite execution lease", async () => {
  const config = parseConfigOrThrow(
    base.replace("timeout = 20", "timeout = 0"),
  );
  const lease = await completionLease(config);
  assert(Number.isSafeInteger(lease) && lease > 0);
  assertEquals(config.jobs.test, { run: "true", timeout: 0 });
});
