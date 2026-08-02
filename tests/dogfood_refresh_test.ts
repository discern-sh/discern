/**
 * Dogfood guard: discern's own checked-in provider integrations must already be
 * in the state `discern refresh` expects.
 *
 * Temp-project tests prove the generic scaffold/refresh path. This file covers
 * the self-hosted case that temp scaffolds miss: the discern repo is itself a
 * long-lived discern install with tracked, co-managed provider settings.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { checkProviderHooksCurrent } from "../src/lib/provider_hooks.ts";
import { providerFor } from "../src/lib/providers.ts";
import {
  loadConfig,
  resolveConfiguredAgents,
} from "../src/shared/config_schema.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** Narrow decoded provider configuration to a non-null, non-array record. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively collect executable command and bash strings from provider hook JSON. */
function commandStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(commandStrings);
  }
  if (!isJsonObject(value)) {
    return [];
  }

  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if ((key === "command" || key === "bash") && typeof child === "string") {
      found.push(child);
    }
    found.push(...commandStrings(child));
  }
  return found;
}

/** Select legacy or canonical worktree lifecycle invocations from hook commands. */
function worktreeCommands(value: unknown): string[] {
  return commandStrings(value).filter((command) =>
    /\bworktree\s+(ensure|create|remove|teardown)\b/.test(command)
  );
}

/** Decode a dogfooded provider artifact relative to the repository root. */
async function readJson(rel: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(join(REPO, rel)));
}

/** Report hook events whose command groups are not represented as arrays. */
function hookEventShapeErrors(rel: string, value: unknown): string[] {
  if (!isJsonObject(value) || !isJsonObject(value.hooks)) {
    return [];
  }
  return Object.entries(value.hooks)
    .filter(([, groups]) => !Array.isArray(groups))
    .map(([event]) => `${rel}: hooks.${event}`);
}

Deno.test("dogfooded provider hook files are refresh-current", async () => {
  const drift = await checkProviderHooksCurrent(REPO, await loadConfig(REPO));
  assertEquals(drift, []);
});

Deno.test("dogfooded provider hooks use the canonical shipped worktree commands once", async () => {
  const config = await loadConfig(REPO);
  const legacyCommands: string[] = [];
  const malformedHookEvents: string[] = [];

  for (const agent of resolveConfiguredAgents(config)) {
    const provider = providerFor(agent);
    const rel = provider?.hooks?.settingsFile;
    if (rel === undefined || !rel.endsWith(".json")) {
      continue;
    }

    const settings = await readJson(rel);
    malformedHookEvents.push(...hookEventShapeErrors(rel, settings));
    const actual = worktreeCommands(settings);
    const template = worktreeCommands(
      await readJson(join("templates", `${rel}.tmpl`)),
    );
    legacyCommands.push(
      ...actual
        .filter((command) =>
          command.startsWith("deno task dev worktree ") ||
          command.startsWith("./agent worktree ") ||
          command.startsWith("./bin/agent worktree ")
        )
        .map((command) => `${rel}: ${command}`),
    );

    assertEquals(
      actual.filter((command) => command.startsWith("discern worktree "))
        .sort(),
      template.sort(),
      `${rel} should carry each shipped discern worktree hook exactly once`,
    );
  }

  assertEquals(legacyCommands, []);
  assertEquals(malformedHookEvents, []);
});
