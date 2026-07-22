import { assertEquals } from "@std/assert";
import { planTidy } from "../src/engine/tidy/tidy.ts";

/** Prove a production config writer already emitted `discern tidy toml` bytes. */
export async function assertDiscernTomlTidy(
  root: string,
  context: string,
): Promise<void> {
  const plan = await planTidy(root, "toml");
  assertEquals(
    plan.changes.map((change) => change.display),
    [],
    `${context}: a subsequent \`discern tidy toml\` must be a no-op`,
  );
}
