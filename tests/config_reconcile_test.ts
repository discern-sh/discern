import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  reconcileConfigTextWithTemplate,
  RECORD_CONFIG_PATHS,
  renderConfigTemplateForConfig,
} from "../src/lib/config_reconcile.ts";
import { sectionBlockFromTemplate } from "../src/lib/config_template.ts";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { formatTomlText } from "../src/lib/tidy_format.ts";
import { DISCERN_NO_ATTRIBUTION, type EnvReader } from "../src/shared/env.ts";
import { fakeEnv } from "./helpers.ts";

/** Render the real template against a minimal project so reconciliation tests start from production output. */
async function renderedTemplate(
  env: EnvReader = fakeEnv(),
): Promise<string> {
  const template = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const config = parseConfigOrThrow([
    "[project]",
    'slug = "demo"',
    'agents = ["claude_code", "codex"]',
  ].join("\n"));
  return renderConfigTemplateForConfig(template, config, env);
}

/** Remove one complete TOML section block without disturbing adjacent sections. */
function withoutSection(text: string, section: string): string {
  const block = sectionBlockFromTemplate(text, section);
  assert(block !== undefined, `expected [${section}] in template`);
  return text.replace(`\n\n${block}`, "").replace(block, "");
}

Deno.test("config reconciliation replaces the legacy provenance marker and is idempotent", async () => {
  const template = await renderedTemplate();
  const marker = generatedArtifactMarker(
    ARTIFACT_PROVENANCE_SOURCES.config,
    fakeEnv(),
  );
  const drifted = template.replace(
    marker,
    "# discern | https://discern.sh | project configuration file",
  );

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, [{
    kind: "marker",
    path: "discern.toml",
  }]);
  assertEquals(result.text.split("\n").slice(0, 2), [
    "#:schema https://discern.sh/schema/v1/discern-config.schema.json",
    marker,
  ]);

  const again = reconcileConfigTextWithTemplate(result.text, template);
  assertEquals(again.operations, []);
  assertEquals(again.text, result.text);
});

Deno.test("config reconciliation switches attribution modes without duplicate markers", async () => {
  const attributedEnv = fakeEnv();
  const sourceOnlyEnv = fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" });
  const attributed = await renderedTemplate(attributedEnv);
  const sourceOnlyTemplate = await renderedTemplate(sourceOnlyEnv);
  const attributedMarker = generatedArtifactMarker(
    ARTIFACT_PROVENANCE_SOURCES.config,
    attributedEnv,
  );
  const sourceOnlyMarker = generatedArtifactMarker(
    ARTIFACT_PROVENANCE_SOURCES.config,
    sourceOnlyEnv,
  );

  const withoutAttribution = reconcileConfigTextWithTemplate(
    attributed,
    sourceOnlyTemplate,
  );
  assertEquals(withoutAttribution.operations, [{
    kind: "marker",
    path: "discern.toml",
  }]);
  assert(!withoutAttribution.text.includes(attributedMarker));
  assertEquals(
    withoutAttribution.text.split("\n").filter((line) =>
      line === sourceOnlyMarker
    ).length,
    1,
  );

  const restored = reconcileConfigTextWithTemplate(
    withoutAttribution.text,
    attributed,
  );
  assert(!restored.text.includes(sourceOnlyMarker));
  assertEquals(
    restored.text.split("\n").filter((line) => line === attributedMarker)
      .length,
    1,
  );
});

Deno.test("config reconciliation restores a missing fixed section with comments", async () => {
  const template = await renderedTemplate();
  const drifted = withoutSection(template, "scripts");

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, [{ kind: "section", path: "scripts" }]);
  assertStringIncludes(
    result.text,
    "# [scripts] — your own executable project scripts",
  );
  assertStringIncludes(result.text, "\n[scripts]\n");
  assertStringIncludes(result.text, 'dir = "discern/scripts"');

  const again = reconcileConfigTextWithTemplate(result.text, template);
  assertEquals(again.operations, []);
  assertEquals(again.text, result.text);
});

Deno.test("config reconciliation restores a missing fixed key in template order", async () => {
  const template = await renderedTemplate();
  const drifted = template.replace(
    /\n\s*# Cancel the in-flight sibling commands[\s\S]*?fail_fast = true\n/u,
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
    /\n\s*# Cancel the in-flight sibling commands[\s\S]*?fail_fast = true\n/u,
    "\n",
  );

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, [{ kind: "key", path: "gate.fail_fast" }]);
  assertStringIncludes(result.text, "stream = true");
  assertStringIncludes(result.text, "fail_fast = true");
});

Deno.test("config reconciliation treats named record tables as project-owned", async () => {
  const template = await renderedTemplate();
  const instructionMark = template.indexOf("# Agent-instruction surfaces:");
  const instructionStart = template.lastIndexOf("\n", instructionMark) + 1;
  const acceptanceHeading = template.indexOf(
    "# [acceptance] — standing grants",
  );
  const acceptanceStart = template.lastIndexOf("# ─", acceptanceHeading);
  assert(instructionStart >= 0 && acceptanceStart > instructionStart);
  const drifted = template.slice(0, instructionStart) +
    template.slice(acceptanceStart);

  const result = reconcileConfigTextWithTemplate(drifted, template);

  assertEquals(result.operations, []);
  assert(/^\s*\[scopes\.map\]$/m.test(result.text));
  assert(!/^\s*\[scopes\.instructions\]$/m.test(result.text));
});

const RULE = `# ${"─".repeat(77)}`;

Deno.test("fixed-section banner reconciliation owns the ruled region and preserves project comments outside it", () => {
  // An unrelated future fixed section: enrollment comes from the template's
  // section/banner structure, never a production-name allowlist.
  const template = [
    RULE,
    "# [telemetry_hub] — canonical section documentation.",
    "# Canonical detail.",
    RULE,
    "",
    "[telemetry_hub]",
    "# Canonical key comment.",
    'mode = "default"',
  ].join("\n");
  const config = [
    "# Project note outside the ruled region.",
    RULE,
    "# [retired_name] — stale section documentation.",
    "# Project prose inside the ruled region is replaceable.",
    RULE,
    "",
    "[telemetry_hub]",
    "# Project annotation attached to this key.",
    'mode = "custom"',
  ].join("\n");

  const result = reconcileConfigTextWithTemplate(config, template);

  assertEquals(result.operations, [{ kind: "banner", path: "telemetry_hub" }]);
  assertStringIncludes(result.text, "# [telemetry_hub] — canonical");
  assert(!result.text.includes("# [retired_name]"));
  assert(!result.text.includes("inside the ruled region is replaceable"));
  assertStringIncludes(result.text, "# Project note outside the ruled region.");
  assertStringIncludes(
    result.text,
    "# Project annotation attached to this key.",
  );
  assertStringIncludes(result.text, 'mode = "custom"');

  const again = reconcileConfigTextWithTemplate(result.text, template);
  assertEquals(again.operations, []);
  assertEquals(again.text, result.text);
});

Deno.test("fixed-section banner reconciliation restores an absent ruled region without moving key comments", () => {
  const template = [
    RULE,
    "# [telemetry_hub] — canonical section documentation.",
    RULE,
    "",
    "[telemetry_hub]",
    'mode = "default"',
  ].join("\n");
  const config = [
    "# Project section note outside any ruled region.",
    "[telemetry_hub]",
    "# Project annotation attached to this key.",
    'mode = "custom"',
  ].join("\n");

  const result = reconcileConfigTextWithTemplate(config, template);

  assertEquals(result.operations, [{ kind: "banner", path: "telemetry_hub" }]);
  assertStringIncludes(result.text, "# [telemetry_hub] — canonical");
  assertStringIncludes(
    result.text,
    "# Project section note outside any ruled region.",
  );
  assertStringIncludes(
    result.text,
    "# Project annotation attached to this key.",
  );
  assertStringIncludes(result.text, 'mode = "custom"');
});

Deno.test("a missing fixed banner never consumes the managed record banner before it", () => {
  const standardsBanner = [
    RULE,
    "# [standards] — managed record documentation.",
    RULE,
  ].join("\n");
  const gateBanner = [
    RULE,
    "# [gate] — canonical fixed documentation.",
    RULE,
  ].join("\n");
  const template = [
    standardsBanner,
    "",
    gateBanner,
    "",
    "[gate]",
    "stream = false",
  ].join("\n");
  const config = [
    standardsBanner,
    "",
    "[gate]",
    "stream = false",
  ].join("\n");

  const result = reconcileConfigTextWithTemplate(config, template);

  assertStringIncludes(result.text, standardsBanner);
  assertStringIncludes(result.text, gateBanner);
  assertEquals(result.operations, [{ kind: "banner", path: "gate" }]);
});

/** A minimal template + config pair sharing a [standards] managed banner, so the
 * banner pass can be exercised in isolation from the real template's churn. */
function standardsFixture(templateBanner: string, configBanner: string): {
  template: string;
  config: string;
} {
  const head = ["[project]", 'slug = "demo"', ""];
  return {
    template: [
      ...head,
      templateBanner,
      "",
      "# Coverage — an example:",
      "# [standards.coverage]",
    ].join("\n"),
    config: [
      ...head,
      configBanner,
      "",
      "# My own coverage floor — hand-written.",
      "[standards.coverage]",
      "limit = 80",
      'run = "cover"',
    ].join("\n"),
  };
}

Deno.test("banner reconciliation refreshes a stale record banner, sparing the project's tables and comments", () => {
  const stale = [
    RULE,
    "# [standards] — quality floors",
    "#   limit  the floor/ceiling",
    RULE,
  ].join("\n");
  const current = [
    RULE,
    "# [standards] — quality floors",
    "#   limit   the floor/ceiling",
    "#   margin  headroom `discern standards --pin` leaves",
    RULE,
  ].join("\n");
  const { template, config } = standardsFixture(current, stale);

  const result = reconcileConfigTextWithTemplate(config, template);

  assertEquals(result.operations, [{ kind: "banner", path: "standards" }]);
  // the newly-documented knob reaches the config …
  assertStringIncludes(
    result.text,
    "#   margin  headroom `discern standards --pin` leaves",
  );
  // … while the project's own table, value, and comment are untouched.
  assertStringIncludes(result.text, "# My own coverage floor — hand-written.");
  assertStringIncludes(result.text, "[standards.coverage]");
  assertStringIncludes(result.text, "limit = 80");

  // Idempotent: a second pass is a byte-stable no-op.
  const again = reconcileConfigTextWithTemplate(result.text, template);
  assertEquals(again.operations, []);
  assertEquals(again.text, result.text);
});

Deno.test("banner reconciliation leaves a current banner untouched", () => {
  const banner = [
    RULE,
    "# [standards] — quality floors",
    "#   limit  the floor/ceiling",
    RULE,
  ].join("\n");
  const { template, config } = standardsFixture(banner, banner);

  const result = reconcileConfigTextWithTemplate(config, template);

  assertEquals(result.operations, []);
  assertEquals(result.text, config);
});

/** Model a newly introduced record-table member with either current or stale managed documentation. */
function futureRecordMemberFixture(
  family: (typeof RECORD_CONFIG_PATHS)[number],
  stale: boolean,
): { template: string; config: string } {
  const bannerIndent = "  ".repeat(family.split(".").length - 1);
  const currentBanner = [
    `${bannerIndent}${RULE}`,
    `${bannerIndent}# [${family}] — current family documentation.`,
    `${bannerIndent}# Current detail.`,
    `${bannerIndent}${RULE}`,
  ].join("\n");
  const staleBanner = [
    `${bannerIndent}${RULE}`,
    `${bannerIndent}# [${family}] — stale family documentation.`,
    `${bannerIndent}${RULE}`,
  ].join("\n");
  return {
    template: [
      currentBanner,
      "",
      `${bannerIndent}# [${family}.example]`,
    ].join("\n"),
    config: [
      stale ? staleBanner : currentBanner,
      "",
      `[${family}.future_member]`,
      'project_value = "kept"',
    ].join("\n"),
  };
}

Deno.test("managed record banners stay current after formatting a future member at every family depth", async () => {
  // The class: a managed banner's prose is current even when the formatter
  // changes its indentation to sit beside a real named member. Drive every
  // record family from reconciliation's own enrollment source, and give each an
  // unrelated future member so neither production entry names nor today's
  // family depths define the guard.
  const drifted: string[] = [];
  for (const family of RECORD_CONFIG_PATHS) {
    const { template, config } = futureRecordMemberFixture(family, false);
    const formatted = await formatTomlText("discern.toml", config);
    const result = reconcileConfigTextWithTemplate(formatted, template);

    if (result.operations.some((operation) => operation.kind === "banner")) {
      drifted.push(family);
    } else {
      assertEquals(result.text, formatted);
    }
  }
  assertEquals(
    drifted,
    [],
    "managed record families gained false banner drift after canonical formatting",
  );
});

Deno.test("managed record banner refreshes converge through the formatter for every family", async () => {
  const nonConvergent: string[] = [];
  for (const family of RECORD_CONFIG_PATHS) {
    const { template, config } = futureRecordMemberFixture(family, true);
    const formatted = await formatTomlText("discern.toml", config);
    const refreshed = reconcileConfigTextWithTemplate(formatted, template);
    assertEquals(
      refreshed.operations.filter((operation) => operation.kind === "banner"),
      [{ kind: "banner", path: family }],
    );
    assertStringIncludes(refreshed.text, "# Current detail.");
    assertStringIncludes(refreshed.text, 'project_value = "kept"');

    const formattedRefresh = await formatTomlText(
      "discern.toml",
      refreshed.text,
    );
    const again = reconcileConfigTextWithTemplate(
      formattedRefresh,
      template,
    );
    if (
      again.operations.some((operation) => operation.kind === "banner") ||
      again.text !== formattedRefresh
    ) {
      nonConvergent.push(family);
    }
  }
  assertEquals(
    nonConvergent,
    [],
    "managed record banner refreshes did not converge through canonical formatting",
  );
});

Deno.test("banner reconciliation never half-matches a hand-mangled banner", () => {
  // The closing rule is gone, so the banner has no clean boundary. The scan must
  // refuse to touch it rather than consume forward into the project's own table.
  const mangled = [
    RULE,
    "# [standards] — quality floors",
    "#   limit  the floor/ceiling",
  ].join("\n");
  const current = [
    RULE,
    "# [standards] — quality floors",
    "#   limit  the floor/ceiling",
    "#   margin  new",
    RULE,
  ].join("\n");
  const { template, config } = standardsFixture(current, mangled);

  const result = reconcileConfigTextWithTemplate(config, template);

  assert(
    !result.operations.some((op) => op.kind === "banner"),
    "a banner with no clean closing rule must be left alone",
  );
  assertStringIncludes(result.text, "[standards.coverage]");
  assertStringIncludes(result.text, "limit = 80");
});
