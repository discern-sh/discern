/**
 * Agent-agnosticism guard. discern is stack- AND agent-neutral: the only
 * agent-specific paths it builds belong to the agent-integration FEATURES it
 * provides to end users — materializing skills into each agent's skills dir
 * (`.claude/skills/`, the cross-tool `.agents/skills/`) and writing the
 * `.claude/settings.json` hooks (all in the feature layer under `src/lib`, the
 * provider registry, / `src/commands`). The stack-neutral ENGINE (`src/engine/**`)
 * and the GENERIC resource tests must NEVER build such a path — assuming it exists,
 * is gitignored, or stays the de-facto agent config dir is exactly the coupling
 * discern forbids. This pins the invariant: it would have caught a resource test
 * that scratched markers under `.claude/`, and an orphan sweep that hardcoded
 * `.claude/worktrees`.
 *
 * It scans CODE only — comments are stripped first, so explaining the rule (or a
 * skills/settings feature) by NAME is fine; only constructing a `.claude` path is
 * a violation.
 */

import { assert } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";
import { PROVIDERS } from "../src/lib/providers.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** Source with block + line comments removed, so the scan sees code, not prose. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Provider-specific path fragments the stack-neutral engine must never CONSTRUCT,
 * derived from the registry's integration surfaces. Most providers own a top-level
 * dot-dir (`.claude`, `.codex`, ...), which catches any hardcoded subpath such as
 * the historic `.claude/worktrees`; `.agents/skills` and `.github/hooks` stay
 * narrower because their parent dirs can appear in neutral prose/config contexts.
 */
const FORBIDDEN_AGENT_PATHS = forbiddenAgentPathFragments();

interface AgentPathHit {
  readonly rel: string;
  readonly fragment: string;
}

interface AgentPathException extends AgentPathHit {
  readonly reason: string;
}

const AGENT_PATH_EXCEPTIONS: readonly AgentPathException[] = [];

function providerPathFragments(): string[] {
  const paths: string[] = [];
  for (const provider of Object.values(PROVIDERS)) {
    paths.push(provider.guidanceFile.path);
    if (provider.skillsDir !== undefined) {
      paths.push(provider.skillsDir);
    }
    if (provider.hooks !== undefined) {
      paths.push(provider.hooks.settingsFile);
    }
    if (provider.worktreeApp !== undefined) {
      paths.push(provider.worktreeApp.configFile);
    }
    if (provider.projectRules !== undefined) {
      paths.push(provider.projectRules.rulesFile);
    }
    switch (provider.mcp.kind) {
      case "wired":
        paths.push(provider.mcp.integration.configFile);
        break;
      case "pending":
        paths.push(provider.mcp.targetFile);
        break;
      case "none":
        break;
    }
  }

  return paths.flatMap((path) => {
    const fragment = forbiddenFragmentFor(path);
    return fragment === undefined ? [] : [fragment];
  });
}

function forbiddenFragmentFor(path: string): string | undefined {
  const parts = path.split("/").filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined || !first.startsWith(".")) {
    return undefined;
  }
  if (first === ".agents" || first === ".github") {
    const second = parts[1];
    return second === undefined ? first : `${first}/${second}`;
  }
  return first;
}

function forbiddenAgentPathFragments(): string[] {
  const fragments: string[] = [];
  for (const fragment of providerPathFragments()) {
    if (!fragments.includes(fragment)) {
      fragments.push(fragment);
    }
  }
  return fragments;
}

function agentPathHits(rel: string, code: string): AgentPathHit[] {
  return FORBIDDEN_AGENT_PATHS.flatMap((fragment) =>
    code.includes(fragment) ? [{ rel, fragment }] : []
  );
}

function isException(hit: AgentPathHit): boolean {
  return AGENT_PATH_EXCEPTIONS.some((exception) =>
    exception.rel === hit.rel && exception.fragment === hit.fragment
  );
}

function assertExceptionsAreLive(
  hits: readonly AgentPathHit[],
  scannedRels: ReadonlySet<string>,
): void {
  for (const exception of AGENT_PATH_EXCEPTIONS) {
    if (!scannedRels.has(exception.rel)) {
      continue;
    }
    assert(
      FORBIDDEN_AGENT_PATHS.includes(exception.fragment),
      `AGENT_PATH_EXCEPTIONS lists ${exception.fragment} for ${exception.rel}, but that fragment is no longer derived from PROVIDERS`,
    );
    assert(
      hits.some((hit) =>
        hit.rel === exception.rel && hit.fragment === exception.fragment
      ),
      `AGENT_PATH_EXCEPTIONS lists ${exception.fragment} for ${exception.rel}, but that code hit is gone`,
    );
  }
}

Deno.test("the stack-neutral engine builds no provider-specific agent path", async () => {
  const hits: AgentPathHit[] = [];
  const scannedRels = new Set<string>();
  for await (
    const entry of walk(join(REPO, "src", "engine"), { exts: [".ts"] })
  ) {
    const rel = relative(REPO, entry.path);
    scannedRels.add(rel);
    const code = codeOnly(await Deno.readTextFile(entry.path));
    hits.push(...agentPathHits(rel, code));
  }
  assertExceptionsAreLive(hits, scannedRels);
  const offenders = hits.filter((hit) => !isException(hit));
  assert(
    offenders.length === 0,
    `the engine must be agent-agnostic, but these BUILD an agent-specific path (one of ${
      FORBIDDEN_AGENT_PATHS.join(", ")
    }): ${
      offenders.map((hit) => `${hit.rel} (${hit.fragment})`).join(", ")
    }. An agent-specific path belongs in the feature layer (src/lib skills/settings/` +
      `providers), or is discovered from git — never hardcoded in the stack-neutral engine.`,
  );
});

Deno.test("the generic resource tests and the shared engine harness build no agent-specific path", async () => {
  const hits: AgentPathHit[] = [];
  const scannedRels = new Set<string>();
  for (
    const rel of [
      "tests/worktree_resources_test.ts",
      "tests/engine_worktree_resources_test.ts",
      // The shared engine-test harness: `addWorktree` once placed test worktrees
      // under `.claude/worktrees`; it now resolves the default sibling through the
      // production `resolveWorktreeRoot`, so this guard keeps it agent-neutral.
      "tests/engine_helpers.ts",
    ]
  ) {
    scannedRels.add(rel);
    const code = codeOnly(await Deno.readTextFile(join(REPO, rel)));
    hits.push(...agentPathHits(rel, code));
  }
  assertExceptionsAreLive(hits, scannedRels);
  const hit = hits.find((candidate) => !isException(candidate));
  assert(
    hit === undefined,
    `${hit?.rel} must not build an agent-specific path (found \`${hit?.fragment}\`) — a worktree/` +
      `resource test's checkouts and markers belong in a neutral location (a sibling ` +
      `or external temp dir), never an agent-specific path that merely happens to be ` +
      `gitignored.`,
  );
});
