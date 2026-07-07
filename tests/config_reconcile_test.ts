import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  reconcileConfigTextWithTemplate,
  renderConfigTemplateForConfig,
} from "../src/lib/config_reconcile.ts";
import { sectionBlockFromTemplate } from "../src/lib/config_template.ts";

async function renderedTemplate(): Promise<string> {
  const template = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const config = parseConfigOrThrow([
    "[project]",
    'slug = "demo"',
    "",
    "[guidance]",
    'agents = ["claude_code", "codex"]',
  ].join("\n"));
  return renderConfigTemplateForConfig(template, config);
}

function withoutSection(text: string, section: string): string {
  const block = sectionBlockFromTemplate(text, section);
  assert(block !== undefined, `expected [${section}] in template`);
  return text.replace(`\n\n${block}`, "").replace(block, "");
}

Deno.test("config reconciliation restores a missing fixed section with comments", async () => {
  const template = await renderedTemplate();
  const drifted = withoutSection(template, "recipes");

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, [{ kind: "section", path: "recipes" }]);
  assertStringIncludes(
    result.text,
    "# [recipes] — your own `discern` commands",
  );
  assertStringIncludes(result.text, "\n[recipes]\n");
  assertStringIncludes(result.text, 'dir = "discern/recipes"');

  const again = reconcileConfigTextWithTemplate(result.text, template);
  assertEquals(again.operations, []);
  assertEquals(again.text, result.text);
});

Deno.test("config reconciliation restores a missing fixed key in template order", async () => {
  const template = await renderedTemplate();
  const drifted = template.replace(
    /\n# Cancel the in-flight sibling commands[\s\S]*?fail_fast = true\n/u,
    "\n",
  );

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, [{ kind: "key", path: "gate.fail_fast" }]);
  assertStringIncludes(result.text, "# Cancel the in-flight sibling commands");
  assertStringIncludes(result.text, "fail_fast = true");
  assert(
    result.text.indexOf("stream = false") <
        result.text.indexOf("fail_fast = true") &&
      result.text.indexOf("fail_fast = true") <
        result.text.indexOf("[coupling]"),
    "restored key should sit after stream and before the next section",
  );
});

Deno.test("config reconciliation preserves existing customized values", async () => {
  const template = await renderedTemplate();
  const drifted = template.replace("stream = false", "stream = true").replace(
    /\n# Cancel the in-flight sibling commands[\s\S]*?fail_fast = true\n/u,
    "\n",
  );

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, [{ kind: "key", path: "gate.fail_fast" }]);
  assertStringIncludes(result.text, "stream = true");
  assertStringIncludes(result.text, "fail_fast = true");
});

Deno.test("config reconciliation treats named record tables as project-owned", async () => {
  const template = await renderedTemplate();
  const drifted = template.replace(
    /# Paths that need no gate at all:[\s\S]*?neutral = true\n\n/u,
    "",
  );

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, []);
  assert(!/^\[scopes\.docs\]$/m.test(result.text));
});
