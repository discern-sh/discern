/**
 * The provider-driven settings seed/merge seam (Phase A, deliverable 3).
 *
 * The scaffolder routes settings templates by the registry's `settingsSeeds()` —
 * every hooks provider's settings file + its merge strategy — not a hardcoded
 * `.claude/settings.json` special-case. So a NEW hooks provider seeds purely by (a)
 * declaring a `HooksIntegration` (which `settingsSeeds()` turns into a `SettingsSeed`)
 * and (b) dropping a `${settingsFile}.tmpl` template — with no edit to fs_plan or the
 * merge engine.
 *
 * These prove: Claude's seed is byte-identical through the default JSON strategy; a
 * synthetic SessionStart-only provider seeds and deep-merges purely from its
 * declaration + template (injected via `buildPlan({ seeds })`, which is exactly what
 * a registry entry produces).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { applyPlan, buildPlan } from "../src/lib/fs_plan.ts";
import {
  type HooksIntegration,
  type SettingsSeed,
  settingsSeeds,
} from "../src/lib/providers.ts";
import {
  mergeJsonSettingsText,
  mergeSettings,
} from "../src/lib/settings_merge.ts";
import { COMMENT_INCAPABLE_ARTIFACT } from "../src/shared/file_ownership.ts";
import { readTarget, testTokens, withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

const SyntheticSettingsSchema = z.object({
  model: z.string().optional(),
  permissions: z.object({ deny: z.array(z.string()) }).passthrough(),
  hooks: z.object({
    SessionStart: z.array(
      z.object({
        hooks: z.array(
          z.object({
            type: z.string(),
            command: z.string(),
          }).passthrough(),
        ),
      }).passthrough(),
    ),
  }).passthrough(),
}).passthrough();

Deno.test("settingsSeeds(): the registry yields Claude's settings file with the default JSON strategy", () => {
  const seeds = settingsSeeds();
  const claude = seeds.find((s) => s.targetRel === ".claude/settings.json");
  assert(
    claude !== undefined,
    "Claude's settings seed must come from the registry",
  );
  // Claude declares no custom mergeSeed, so it gets the default JSON deep-merge —
  // the strategy that keeps its seeded output byte-identical.
  assertEquals(claude.merge, mergeJsonSettingsText);
});

Deno.test("mergeJsonSettingsText: byte-identical to the JSON deep-merge it lifts", () => {
  // The default strategy must be exactly parse → mergeSettings → 2-space JSON + "\n"
  // (the pre-generalization Claude behaviour), so no install's settings churn.
  const existing = { model: "opus", permissions: { deny: ["Read(./secret)"] } };
  const incoming = { permissions: { deny: ["Read(./.env)"] }, extra: true };
  const viaText = mergeJsonSettingsText(
    JSON.stringify(existing),
    JSON.stringify(incoming),
  );
  const viaObject = `${
    JSON.stringify(mergeSettings(existing, incoming), null, 2)
  }\n`;
  assertEquals(viaText, viaObject);
  // An absent existing file is treated as an empty object.
  assertEquals(
    mergeJsonSettingsText(undefined, JSON.stringify(incoming)),
    `${JSON.stringify(mergeSettings({}, incoming), null, 2)}\n`,
  );
});

/** A SYNTHETIC second hooks provider: SessionStart-only (empty worktreeEventKeys),
 * its settings file at `.acme/settings.json`. Stands in for a future vendor. */
const ACME_HOOKS: HooksIntegration = {
  settingsFile: ".acme/settings.json",
  ownership: { shared: true },
  writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
  worktreeEventKeys: [], // SessionStart-only — no worktree create/remove events
  sessionHookNeedle: "discern worktree ensure",
};

/** The SettingsSeed `settingsSeeds()` would derive for ACME — the exact registry
 * declaration, replicated here since the closed AGENT_NAMES can't take a synthetic
 * agent. Injecting it into buildPlan models "the registry now has this provider". */
const ACME_SEED: SettingsSeed = {
  targetRel: ACME_HOOKS.settingsFile,
  merge: ACME_HOOKS.mergeSeed ?? mergeJsonSettingsText,
};

/** Lay a one-file templates tree holding the synthetic provider's settings seed. */
async function acmeTemplates(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, ".acme"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".acme", "settings.json.tmpl"),
    JSON.stringify(
      {
        hooks: {
          SessionStart: [{
            hooks: [{ type: "command", command: "discern worktree ensure" }],
          }],
        },
        permissions: { deny: ["Read(./.env)"] },
      },
      null,
      2,
    ),
  );
}

Deno.test("a synthetic SessionStart-only hooks provider seeds purely from its declaration + template", async () => {
  await withTempDir(async (templates) => {
    await acmeTemplates(templates);
    await withTempDir(async (dest) => {
      const plan = await buildPlan({
        templatesDir: templates,
        destDir: dest,
        tokens: testTokens(),
        seeds: [ACME_SEED], // ← the registry declaration; no fs_plan edit needed
      });
      // The template was ROUTED to a settings-merge op at the provider's target —
      // not written verbatim — purely because its target matched the injected seed.
      const op = plan.ops.find((o) => o.targetRel === ".acme/settings.json");
      assert(
        op !== undefined,
        "the synthetic settings template must be planned",
      );
      assertEquals(op.kind, "merge-settings");

      await applyPlan(plan);
      const settings = decodeWith(
        SyntheticSettingsSchema,
        await readTarget(dest, ".acme/settings.json"),
      );
      const sessionStart = settings.hooks.SessionStart[0];
      assertExists(sessionStart);
      const commandHook = sessionStart.hooks[0];
      assertExists(commandHook);
      assertEquals(
        commandHook.command,
        "discern worktree ensure",
      );
      assertEquals(settings.permissions.deny, ["Read(./.env)"]);
    });
  });
});

Deno.test("the synthetic provider's seed deep-merges into an existing settings file (never clobbers)", async () => {
  await withTempDir(async (templates) => {
    await acmeTemplates(templates);
    await withTempDir(async (dest) => {
      // A pre-existing user settings file with their own keys.
      await Deno.mkdir(join(dest, ".acme"), { recursive: true });
      await Deno.writeTextFile(
        join(dest, ".acme", "settings.json"),
        JSON.stringify({
          model: "custom",
          permissions: { deny: ["Read(./secret)"] },
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "mine" }] }],
          },
        }),
      );
      const plan = await buildPlan({
        templatesDir: templates,
        destDir: dest,
        tokens: testTokens(),
        seeds: [ACME_SEED],
      });
      await applyPlan(plan);
      const settings = decodeWith(
        SyntheticSettingsSchema,
        await readTarget(dest, ".acme/settings.json"),
      );
      // User scalar preserved; deny unioned; SessionStart carries both hooks.
      assertEquals(settings.model, "custom");
      assertEquals(settings.permissions.deny, [
        "Read(./secret)",
        "Read(./.env)",
      ]);
      assertEquals(settings.hooks.SessionStart.length, 2);
    });
  });
});
