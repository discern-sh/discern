/**
 * The two-lane rule as a CLASS guard (ADR 0086/0078): any verb whose `--json`
 * data carries a prose `instructions` string must embed that string VERBATIM in its
 * human render — the prose is the load-bearing lane, and a renderer that
 * paraphrases or truncates it re-opens the drift the rule closed.
 *
 * Membership is DERIVED, not hand-listed: the sweep introspects every contract
 * in the public result registry for a `instructions` field in its data schema, and
 * a set-equality guard forces each member to have a driver here — so a new
 * instructions-carrying verb fails this suite until its human render is proven,
 * and a schema that drops the field retires its driver. The per-verb deep
 * tests (welcome/pages suites) keep asserting their load-bearing needles; this
 * suite owns the embeds-verbatim property and the enrolment.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { CLI_JSON_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/** Recursively flatten nested optional/union schemas into their object leaves. */
function objectVariants(schema: unknown): z.ZodObject[] {
  if (schema instanceof z.ZodOptional) {
    return objectVariants(schema.unwrap());
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap(objectVariants);
  }
  return schema instanceof z.ZodObject ? [schema] : [];
}

/** The object leaves beneath one serialized envelope's optional `data` field. */
function dataVariants(outputSchema: z.ZodType): z.ZodObject[] {
  return outputSchema instanceof z.ZodObject
    ? objectVariants(outputSchema.shape["data"])
    : [];
}

/** True when any data variant of the contract's schema carries `instructions`. */
function carriesInstructions(outputSchema: z.ZodType): boolean {
  return dataVariants(outputSchema).some((o) => "instructions" in o.shape);
}

/** A fresh one-commit repo with no discern config — the pre-setup state. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
}

/** How to drive one instructions-carrying contract to a run whose data carries a
 * non-empty `instructions` — the same argv is run with and without `--json`. */
interface TwoLaneDriver {
  fixture: (dir: string) => Promise<void>;
  argv: string[];
  /** The expected exit code (the consent refusal exits 1 by design). */
  code: number;
}

const DRIVERS: Record<string, TwoLaneDriver> = {
  // The `setup begin` envelope's instructions carrier is the awaiting-consent refusal: a
  // fresh flag-less `begin` re-serves the consent message on both surfaces.
  setupBegin: { fixture: freshRepo, argv: ["setup", "begin"], code: 1 },
  setupVerify: { fixture: freshRepo, argv: ["setup", "verify"], code: 0 },
  setupStep: {
    fixture: (dir) => scaffoldEngine(dir, { bootstrapped: false }),
    argv: ["setup", "step", "4"],
    code: 0,
  },
  setupDone: {
    fixture: (dir) => scaffoldEngine(dir, { bootstrapped: false }),
    argv: ["setup", "done", "--force"],
    code: 0,
  },
};

Deno.test("every instructions-carrying result contract has a two-lane driver (enrolment)", () => {
  const carrying = CLI_JSON_RESULT_CONTRACTS
    .filter((contract) => carriesInstructions(contract.schema))
    .map((contract) => contract.id)
    .sort();
  assertEquals(
    carrying,
    Object.keys(DRIVERS).sort(),
    "a contract whose data carries `instructions` must prove its human render embeds it — add a driver above (or retire one whose schema dropped the field)",
  );
});

Deno.test("the instructions detector catches a fresh-name future sibling and ignores non-carriers", () => {
  // The adversarial future sibling: unrelated verb, unrelated field names, the
  // instructions field buried in one option of a data union — detected purely by
  // shape, with no case-table edit.
  const sibling = z.strictObject({
    ok: z.boolean(),
    verb: z.literal("orbit calibrate"),
    data: z.union([
      z.strictObject({ calibration: z.number(), instructions: z.string() }),
      z.strictObject({ aborted: z.boolean() }),
    ]).optional(),
  });
  assert(carriesInstructions(sibling), "a fresh-name carrier must be detected");

  const nonCarrier = z.strictObject({
    ok: z.boolean(),
    verb: z.literal("orbit list"),
    data: z.strictObject({ items: z.array(z.string()) }).optional(),
  });
  assert(!carriesInstructions(nonCarrier), "a non-carrier must not enrol");
});

for (const [id, driver] of Object.entries(DRIVERS)) {
  Deno.test(
    `two-lane (ADR 0086): \`${
      driver.argv.join(" ")
    }\` embeds its --json instructions verbatim in the human render [${id}]`,
    async () => {
      await withTempDir(async (dir) => {
        await driver.fixture(dir);
        const json = await runAgent(dir, [...driver.argv, "--json"]);
        assertEquals(json.code, driver.code, json.output);
        const result = decodeCliResult(
          json.stdout,
          driver.argv.slice(0, 2).join(" "),
        );
        assertResultDataKey(result, "instructions");
        const instructions = result.data.instructions;
        assert(
          typeof instructions === "string" && instructions.length > 0,
          `the driver must produce a non-empty instructions: ${json.stdout}`,
        );
        const human = await runAgent(dir, driver.argv);
        assertEquals(human.code, driver.code, human.output);
        assertStringIncludes(
          human.stdout,
          instructions,
          `the human render must embed the --json instructions verbatim (${id})`,
        );
      });
    },
  );
}
