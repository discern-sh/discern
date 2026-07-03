/**
 * Agent-integration PARITY guard — the forcing function that keeps every coding
 * agent handled identically across discern's cross-cutting surfaces.
 *
 * The typed provider registry (ADR 0031) is the single source of truth for
 * everything agent-specific, and it is a TOTAL `Record<AgentName, Provider>`, so
 * adding a name to `AGENT_NAMES` already forces a complete `PROVIDERS` entry (a
 * compile error otherwise). That coupling protects the runtime engine — but the
 * SATELLITE surfaces that re-encode agent paths (the seed `.gitignore`, the
 * neutral-scope defaults, improve's agent-file probe) have no compile-time tie to
 * the registry. This test is that tie: for EVERY known agent it asserts every
 * satellite covers it, so a new agent red-lights the gate until each surface is
 * updated — divergence becomes a failing test, never a silent gap (the trajectory
 * ADR 0042 set: ".agents/skills/ joined .claude/skills as the registry grew, and
 * the satellites must grow with it").
 *
 * When this test fails for a newly-added agent, the fix is NOT to weaken the test —
 * it is to teach the named satellite about the agent (the failure message says
 * which one and how).
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import {
  agentArtifactPaths,
  allGuidanceFilePaths,
  allSkillsDirs,
  emitsGuidanceFile,
  neutralAgentScopePaths,
  providerFor,
  providersWithHooks,
} from "../src/lib/providers.ts";
import { defaultNeutralScopes } from "../src/lib/config.ts";
import {
  canonicalDiscernGitignoreBlock,
  ignoreCovers,
} from "../src/lib/agent_gitignore.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** The seed `.gitignore` fragment — the static distribution surface every install
 * receives. Read once; the per-line predicates below decide coverage. */
const FRAGMENT = await Deno.readTextFile(
  join(REPO, "templates", ".gitignore.fragment"),
);
const CANONICAL_GITIGNORE_BLOCK = canonicalDiscernGitignoreBlock(FRAGMENT);
const FRAGMENT_LINES = CANONICAL_GITIGNORE_BLOCK.split("\n").map((l) =>
  l.trim()
);

// Coverage is decided by the ONE shared definition from the reconciler module
// (`ignoreCovers`), so this guard and the upgrade-time convergence can never disagree
// about what counts as "already ignored" — no second copy of the gitignore semantics.
const fragmentIgnoresFile = (path: string) =>
  ignoreCovers(FRAGMENT_LINES, path, false);
const fragmentIgnoresDir = (dir: string) =>
  ignoreCovers(FRAGMENT_LINES, dir, true);

Deno.test("the shipped .gitignore fragment is the same canonical block upgrade writes", () => {
  assertEquals(
    CANONICAL_GITIGNORE_BLOCK,
    FRAGMENT.endsWith("\n") ? FRAGMENT : `${FRAGMENT}\n`,
  );
});

Deno.test("every known agent declares at least one detection binary (match-any)", () => {
  // PATH auto-detect (src/lib/detect_agents.ts) iterates AGENT_NAMES × each
  // provider's `binaries`, so a provider with an empty list silently never
  // detects — a new agent must name its CLI executable(s) or red-light here.
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);
    assert(
      p.binaries.length > 0 && p.binaries.every((b) => b.length > 0),
      `${name}: empty binaries — declare the agent's CLI executable name(s) so PATH auto-detect can find it`,
    );
  }
});

Deno.test("registry aggregators stay total: one guidance file + a skills dir per known agent", () => {
  const guidanceFiles = allGuidanceFilePaths();
  const skillsDirs = allSkillsDirs();
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);
    assert(
      guidanceFiles.includes(p.guidanceFile.path),
      `allGuidanceFilePaths() is missing ${name}'s ${p.guidanceFile.path} — it must derive from PROVIDERS, not a literal list`,
    );
    if (p.skillsDir !== undefined) {
      assert(
        skillsDirs.includes(p.skillsDir),
        `allSkillsDirs() is missing ${name}'s ${p.skillsDir}`,
      );
    }
  }
  // The aggregator and the registry agree on the artifact set (no third encoding).
  const artifacts = agentArtifactPaths();
  assert(
    artifacts.guidanceFiles.length === guidanceFiles.length &&
      artifacts.skillsDirs.length === skillsDirs.length,
    "agentArtifactPaths() must be the union of the two aggregators",
  );
});

Deno.test("guidance modelling stays sound: exactly one canonical, reuse-canonical reads it without duplicates", () => {
  // The invariant the reuse-canonical model rests on (deliverable 2): one provider
  // holds the canonical full body; a reuse-canonical provider reads THAT file and
  // discern emits no provider-specific file for it — so it can never leak a
  // duplicate.
  const canonicals = AGENT_NAMES
    .map((n) => providerFor(n)?.guidanceFile)
    .filter((g) => g !== undefined && g.canonical)
    .map((g) => g?.path);
  assertEquals(
    canonicals.length,
    1,
    `expected exactly one canonical agent file, got: ${canonicals.join(", ")}`,
  );
  const canonicalPath = canonicals[0];
  for (const name of AGENT_NAMES) {
    const gf = providerFor(name)?.guidanceFile;
    if (gf === undefined || emitsGuidanceFile(gf)) {
      continue; // only inspect reuse-canonical providers
    }
    assertEquals(
      gf.path,
      canonicalPath,
      `${name}: a reuse-canonical provider must read the canonical ${canonicalPath}, not ${gf.path}`,
    );
    assertEquals(
      gf.canonical,
      false,
      `${name}: reuseCanonical and canonical are mutually exclusive`,
    );
  }
  // The emitted set never carries a path twice — a reuse-canonical provider's path
  // collapses into the canonical's, so the aggregator stays free of duplicates.
  const emitted = allGuidanceFilePaths();
  assertEquals(
    emitted.length,
    new Set(emitted).size,
    `allGuidanceFilePaths() must be duplicate-free, got: ${emitted.join(", ")}`,
  );
});

Deno.test("MCP coverage is accounted for every known agent (wired, or explicitly pending with a target)", () => {
  // The typed MCP-status forcing function (ADR 0051, deliverable 4): every provider
  // accounts for its MCP wiring — a live integration, an explicit `pending` marker
  // naming the committable file discern will write into, or `none`. Never the old
  // silent `mcp?` gap. The union + the required `Provider.mcp` field make a missing
  // declaration a COMPILE error; this asserts the runtime half (a pending status
  // names a real target). It TIGHTENS automatically: a later plan flipping a pending
  // to wired keeps this green with no edit.
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);
    const mcp = p.mcp;
    switch (mcp.kind) {
      case "wired":
        assert(
          mcp.integration.configFile.length > 0,
          `${name}: a wired MCP must name its config file`,
        );
        break;
      case "pending":
        assert(
          mcp.targetFile.length > 0 && mcp.targetFile.includes("."),
          `${name}: a pending MCP must name the committable target file discern will write into (got "${mcp.targetFile}")`,
        );
        break;
      case "none":
        break; // an agent with no committable project-scoped MCP mechanism
    }
  }
  // The reference implementation stays wired — a regression here is a real break,
  // not a pending flip.
  assertEquals(providerFor("claude_code")?.mcp.kind, "wired");
});

Deno.test("every known agent declares trust metadata, naming the action when trust is required", () => {
  // Trust-gate coverage (deliverable 5): `Provider.trust` is compile-required, so a
  // new agent must declare it; this asserts the runtime half — a REQUIRED trust must
  // name the action/bypass, or doctor would report "trust needed" with no "how".
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);
    if (p.trust.required) {
      assert(
        p.trust.hint.trim().length > 0,
        `${name}: a required trust must name the user-facing action/bypass`,
      );
    }
  }
});

Deno.test("the seed .gitignore fragment ignores EVERY known agent's compiled guidance file", () => {
  for (const path of allGuidanceFilePaths()) {
    assert(
      fragmentIgnoresFile(path),
      `templates/.gitignore.fragment does not ignore ${path}. A new agent's compiled ` +
        `guidance file is a build artifact — add "/${path}" to the fragment's guidance-file group.`,
    );
  }
});

Deno.test("the seed .gitignore fragment ignores EVERY known agent's materialized skills dir", () => {
  for (const dir of allSkillsDirs()) {
    assert(
      fragmentIgnoresDir(dir),
      `templates/.gitignore.fragment does not ignore the materialized skills dir ${dir}. ` +
        `Add "/${dir}/" (or an ancestor wildcard like "/${
          dir.split("/")[0]
        }/*") to the fragment.`,
    );
  }
});

Deno.test("the seed neutral scopes neutralize EVERY known agent's generated dir", () => {
  const neutral = defaultNeutralScopes(); // already TOML-quoted, e.g. '".claude/"'
  for (const top of neutralAgentScopePaths()) {
    assert(
      neutral.includes(`"${top}"`),
      `defaultNeutralScopes() does not neutralize ${top} — a change under an agent's ` +
        `generated dir would wrongly fire the gate. It must derive from neutralAgentScopePaths().`,
    );
  }
  // Every known agent contributes a neutral region (none silently absent).
  for (const name of AGENT_NAMES) {
    const dir = providerFor(name)?.skillsDir;
    if (dir === undefined) continue;
    const top = `${dir.split("/")[0]}/`;
    assert(
      neutralAgentScopePaths().includes(top),
      `${name}'s generated region ${top} is missing from neutralAgentScopePaths()`,
    );
  }
});

Deno.test("KEYSTONE: every known agent is covered by every cross-cutting satellite", () => {
  // One agent × every satellite. This is the single assertion a new agent must
  // satisfy: extend each named surface until it passes — never relax the check. The
  // six-vendor foundation (Phase A) added seams 3-6 below, so a future Cursor/Copilot/
  // Antigravity red-lights here on EACH one it hasn't yet learned.
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);

    // 1. Compiled guidance file: gitignored. (A reuse-canonical provider's `path` is
    // the canonical it reads, which the canonical provider already covers — so this
    // holds for emitting AND reuse-canonical agents alike.)
    assert(
      fragmentIgnoresFile(p.guidanceFile.path),
      `${name}: guidance file ${p.guidanceFile.path} not gitignored by the seed fragment`,
    );

    // 2. Materialized skills dir (when the agent has one): gitignored + neutral.
    if (p.skillsDir !== undefined) {
      assert(
        fragmentIgnoresDir(p.skillsDir),
        `${name}: skills dir ${p.skillsDir} not gitignored by the seed fragment`,
      );
      const top = `${p.skillsDir.split("/")[0]}/`;
      assert(
        defaultNeutralScopes().includes(`"${top}"`),
        `${name}: generated region ${top} not in the seed neutral scopes`,
      );
    }

    // 3. PATH auto-detect: at least one detection binary, match-any (deliverable 1).
    assert(
      p.binaries.length > 0 && p.binaries.every((b) => b.length > 0),
      `${name}: empty binaries — PATH auto-detect can't find it`,
    );

    // 4. Guidance modelling: a reuse-canonical provider reads the canonical without
    // a duplicate provider file; an emitting provider's path is in the deduped
    // aggregator exactly once (deliverable 2).
    if (emitsGuidanceFile(p.guidanceFile)) {
      assert(
        allGuidanceFilePaths().filter((x) => x === p.guidanceFile.path)
          .length === 1,
        `${name}: emitted guidance ${p.guidanceFile.path} must appear once in allGuidanceFilePaths()`,
      );
    }

    // 5. MCP status accounted: wired, pending-with-a-named-target, or none — never a
    // silent gap (deliverable 4).
    assert(
      p.mcp.kind === "wired" ||
        (p.mcp.kind === "pending" && p.mcp.targetFile.length > 0) ||
        p.mcp.kind === "none",
      `${name}: MCP status not accounted (wired | pending+target | none)`,
    );

    // 6. Trust metadata: present, and naming the action when trust is required
    // (deliverable 5).
    assert(
      !p.trust.required || p.trust.hint.trim().length > 0,
      `${name}: a required trust must name the user-facing action`,
    );
  }
});

Deno.test("the seed settings template seeds each hooks provider's registry worktree-event keys", async () => {
  // A hooks provider's worktree-lifecycle hooks are seeded into a STATIC settings
  // template, but the ENGINE reads the event names from the registry's
  // HooksIntegration (the hook-stripper in `setup`, the doctor worktree-automation
  // advisory). If the static seed and the registry drift, new installs seed hook
  // names the engine no longer recognises — an agent surface diverging with a green
  // gate (the gap ADR 0043's "every satellite" claim must actually cover). This ties
  // the seed back: a renamed event key red-lights the gate until the template follows.
  for (const provider of providersWithHooks()) {
    const integ = provider.hooks;
    assert(
      integ !== undefined,
      `${provider.name}: providersWithHooks but no hooks`,
    );
    const tmplPath = join(REPO, "templates", `${integ.settingsFile}.tmpl`);
    let tmpl: string;
    try {
      tmpl = await Deno.readTextFile(tmplPath);
    } catch {
      throw new Error(
        `${provider.name} declares hooks in ${integ.settingsFile}, but no seed template exists at templates/${integ.settingsFile}.tmpl — its seeded hooks cannot be kept in step with the registry`,
      );
    }
    for (const key of integ.worktreeEventKeys) {
      assert(
        tmpl.includes(`"${key}"`),
        `templates/${integ.settingsFile}.tmpl does not seed the "${key}" hook the registry declares for ${provider.name} — the seed and the engine's hook vocabulary have drifted`,
      );
    }
    // The session-start hook the registry identifies by needle must be seeded too.
    assert(
      new RegExp(integ.sessionHookNeedle, "i").test(tmpl),
      `templates/${integ.settingsFile}.tmpl seeds no command matching the registry's sessionHookNeedle ("${integ.sessionHookNeedle}") for ${provider.name}`,
    );
  }
});
