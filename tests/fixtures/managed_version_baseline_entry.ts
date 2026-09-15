/** Capture entrypoint for the immutable first-public adoption compatibility slice.
 * The fixture executable bundles these production authorities and their reader
 * dependencies once; normal tests never execute this live-source entrypoint.
 */
import { parseConfig } from "../../src/shared/config_schema.ts";
import { DISCERN_VERSION, SCHEMA_VERSION } from "../../src/lib/version.ts";
import { compareManagedVersion, managedMaterialBoundary } from "../../src/shared/managed_version.ts";
import { buildGatePlan, gatePlanToEngine } from "../../src/engine/gate/plan.ts";
import { checkInstructionCurrent } from "../../src/engine/instruction_render.ts";
import { inspectRecordedSchema } from "../../src/lib/schema.ts";
import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";

const root = Deno.args[0];
if (root === undefined) throw new Error("Pass a fixture project root.");
const text = await Deno.readTextFile(join(root, "discern.toml"));
const schema = inspectRecordedSchema(parseToml(text));
if (schema.status === "valid" && schema.value > SCHEMA_VERSION) {
  console.log(JSON.stringify({ error: "schema_version_too_new" }));
} else {
  const parsed = parseConfig(text);
  if (parsed.config === undefined) {
    console.log(JSON.stringify({ error: "invalid_config", issues: parsed.issues }));
  } else {
    const config = parsed.config;
    const boundary = managedMaterialBoundary(config);
    const gate = gatePlanToEngine(buildGatePlan(config, []));
    console.log(JSON.stringify({
      running: DISCERN_VERSION,
      comparison: compareManagedVersion(DISCERN_VERSION, config.meta.managed_version),
      ...(boundary === undefined ? {} : { boundary }),
      gate,
      currency: boundary === undefined
        ? { state: "checked", drift: (await checkInstructionCurrent(root, config)).map((entry) => ({ path: entry.path, reason: entry.reason })) }
        : { state: "unverified" },
    }));
  }
}
