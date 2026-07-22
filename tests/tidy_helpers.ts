import { assertEquals } from "@std/assert";
import { planTidy } from "../src/engine/tidy/tidy.ts";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";

/** Apply the same Markdown convention as the codegen write chokepoint. */
export async function canonicalGeneratedMarkdown(
  path: string,
  rendered: string,
): Promise<string> {
  return await formatMarkdownText(path, rendered);
}

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
