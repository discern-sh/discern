/**
 * Agent-integration PARITY guard — the forcing function that keeps every coding
 * agent handled identically across discern's cross-cutting surfaces.
 *
 * The shared identity catalogue (ADR 0166) derives the native `AGENT_NAMES`, and
 * the typed provider registry (ADR 0031) is the single source of truth for every
 * native integration surface. It is a TOTAL `Record<AgentName, Provider>`, so
 * adding a native catalogue entry already forces a complete `PROVIDERS` entry (a
 * compile error otherwise). That coupling protects the runtime engine — but the
 * SATELLITE surfaces that re-encode agent paths or identities (the seed
 * `.gitignore`, the neutral-scope defaults, improve's agent-file probe, and the
 * site's brand assets) have no compile-time tie to the registry. This test is
 * that tie: for EVERY known agent it asserts every
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
import { guidancePathForNative } from "../src/shared/agent_catalogue.ts";
import {
  agentArtifactPosture,
  allGuidanceFilePaths,
  allLocalStateFiles,
  allSkillsDirs,
  emitsGuidanceFile,
  neutralAgentScopePaths,
  PROVIDER_BRAND_ASSET_ROOT,
  providerBrandSilhouette,
  providerFor,
  providersWithHooks,
} from "../src/lib/providers.ts";
import { defaultGuidanceScopes } from "../src/lib/config.ts";
import {
  canonicalDiscernGitignoreBlock,
  ignoreCovers,
} from "../src/lib/agent_gitignore.ts";
import { stripGeneratedArtifactMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";

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

function svgAspectRatio(svg: string, path: string): number {
  const match = svg.match(/<svg\b[^>]*\bviewBox=["']([^"']+)["']/i);
  assert(match !== null, `${path}: SVG root must declare a viewBox`);
  const raw = match[1];
  assert(raw !== undefined, `${path}: SVG viewBox is empty`);
  const values = raw.trim().split(/[\s,]+/).map(Number);
  assertEquals(values.length, 4, `${path}: SVG viewBox needs four numbers`);
  const width = values[2];
  const height = values[3];
  assert(
    width !== undefined && height !== undefined && width > 0 && height > 0,
    `${path}: SVG viewBox needs a positive width and height`,
  );
  return width / height;
}

function renderedFullCanvasRects(svg: string, path: string): string[] {
  const viewBox = svg.match(/<svg\b[^>]*\bviewBox=["']([^"']+)["']/i);
  assert(viewBox !== null, `${path}: SVG root must declare a viewBox`);
  const raw = viewBox[1];
  assert(raw !== undefined, `${path}: SVG viewBox is empty`);
  const values = raw.trim().split(/[\s,]+/).map(Number);
  assertEquals(values.length, 4, `${path}: SVG viewBox needs four numbers`);
  const [minX, minY, width, height] = values;
  assert(
    minX !== undefined &&
      minY !== undefined &&
      width !== undefined &&
      height !== undefined,
    `${path}: SVG viewBox needs four numbers`,
  );

  let rendered = svg;
  for (const tag of ["defs", "clipPath", "mask", "symbol"]) {
    rendered = rendered.replace(
      new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"),
      "",
    );
  }
  return [...rendered.matchAll(/<rect\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((rect) => {
      const attribute = (name: string): string | undefined =>
        rect.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
      const x = attribute("x") ?? String(minX);
      const y = attribute("y") ?? String(minY);
      const rectWidth = attribute("width");
      const rectHeight = attribute("height");
      return Number(x) === minX &&
        Number(y) === minY &&
        (rectWidth === "100%" || Number(rectWidth) === width) &&
        (rectHeight === "100%" || Number(rectHeight) === height);
    });
}

Deno.test("landing silhouette detector rejects an unrelated opaque SVG canvas", () => {
  const futureSibling = `
    <svg viewBox="0 0 24 24">
      <rect width="24" height="24" fill="rebeccapurple" />
      <path d="M4 4h16v16H4z" fill="white" />
    </svg>
  `;
  assertEquals(
    renderedFullCanvasRects(futureSibling, "future-provider-mark.svg").length,
    1,
  );
});

Deno.test("every landing provider mark has a backgroundless silhouette", async () => {
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider for ${name}`);
    const asset = providerBrandSilhouette(provider.brand);
    const svg = await Deno.readTextFile(
      join(REPO, "site", "pages", asset.path.slice(1)),
    );
    assertEquals(
      renderedFullCanvasRects(svg, asset.path),
      [],
      `${name}: the landing silhouette must not paint its SVG canvas`,
    );
  }
});

Deno.test("the shipped .gitignore fragment becomes the canonical marked block upgrade writes", () => {
  assertEquals(
    stripGeneratedArtifactMarker(
      CANONICAL_GITIGNORE_BLOCK,
      ARTIFACT_PROVENANCE_SOURCES.gitignore,
    ),
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

Deno.test("every known agent declares one open and at most one continue CLI action", () => {
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider for ${name}`);
    const kinds = provider.cli.actions.map((action) => action.kind);
    assertEquals(
      new Set(kinds).size,
      kinds.length,
      `${name}: duplicate desk CLI action kind`,
    );
    assert(
      kinds.includes("open"),
      `${name}: desk CLI integration must provide a fresh-session action`,
    );
    for (const action of provider.cli.actions) {
      assert(action.label.trim().length > 0, `${name}: empty CLI action label`);
      assert(
        action.args.every((arg) => arg.length > 0),
        `${name}: CLI argv must not contain empty arguments`,
      );
    }
  }
});

Deno.test("every known agent has registered mark, silhouette, and wordmark SVGs", async () => {
  const registered: string[] = [];
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider for ${name}`);
    assert(
      provider.brand.sourceUrl.startsWith("https://") &&
        provider.brand.assetSourceUrl.startsWith("https://"),
      `${name}: brand provenance must use HTTPS sources`,
    );

    for (
      const [kind, asset] of [
        ["mark", provider.brand.mark],
        ["silhouette", providerBrandSilhouette(provider.brand)],
        ["wordmark", provider.brand.wordmark],
      ] as const
    ) {
      assert(
        asset.path.startsWith(`${PROVIDER_BRAND_ASSET_ROOT}/`) &&
          /^[a-z0-9-]+\.svg$/.test(
            asset.path.slice(PROVIDER_BRAND_ASSET_ROOT.length + 1),
          ),
        `${name}: ${kind} must be an SVG under ${PROVIDER_BRAND_ASSET_ROOT}`,
      );
      assert(
        asset.upstream.trim().length > 0,
        `${name}: ${kind} must name its upstream vendor asset`,
      );
      const alreadyRegistered = registered.includes(asset.path);
      assert(
        !alreadyRegistered ||
          (kind === "silhouette" &&
            asset.path === provider.brand.mark.path),
        `${name}: ${kind} reuses the registered path ${asset.path}`,
      );
      if (!alreadyRegistered) registered.push(asset.path);

      const diskPath = join(REPO, "site", "pages", asset.path.slice(1));
      let svg: string;
      try {
        svg = await Deno.readTextFile(diskPath);
      } catch {
        throw new Error(
          `${name}: registered ${kind} is missing at ${asset.path}; add the vendor SVG before this provider can ship`,
        );
      }
      assert(
        /^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg.trimStart()),
        `${asset.path}: file must begin with an SVG root`,
      );
      assert(
        !/<(?:foreignObject|image|script|text)\b/i.test(svg),
        `${asset.path}: logos must use vector paths, without images, scripts, foreign objects, or font-dependent text`,
      );
      assert(
        !/(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(svg),
        `${asset.path}: logos must not load external resources`,
      );
      assert(
        !/data:image\//i.test(svg),
        `${asset.path}: logos must not embed image data`,
      );

      const ratio = svgAspectRatio(svg, asset.path);
      if (kind !== "wordmark") {
        assert(
          ratio >= 0.75 && ratio <= 1.34,
          `${asset.path}: compact mark or silhouette must be approximately square (ratio ${ratio})`,
        );
      } else {
        assert(
          ratio >= 2,
          `${asset.path}: wordmark must be horizontal (ratio ${ratio})`,
        );
      }
    }
  }

  const assetDir = join(
    REPO,
    "site",
    "pages",
    PROVIDER_BRAND_ASSET_ROOT.slice(1),
  );
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(assetDir)) {
    if (entry.isFile && entry.name.endsWith(".svg")) {
      onDisk.push(`${PROVIDER_BRAND_ASSET_ROOT}/${entry.name}`);
    }
  }
  assertEquals(
    onDisk.sort(),
    registered.sort(),
    "the integrations asset directory and provider registry must contain the same SVGs",
  );
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
        skillsDirs.includes(p.skillsDir.path),
        `allSkillsDirs() is missing ${name}'s ${p.skillsDir.path}`,
      );
    }
  }
  // The posture aggregator and the registry agree on the artifact set (no third
  // encoding) — one entry per kind, straight from the per-kind aggregators.
  const posture = agentArtifactPosture();
  assert(
    posture.guidanceFiles.length === guidanceFiles.length &&
      posture.materializedDirs.length === skillsDirs.length &&
      posture.localStateFiles.length === allLocalStateFiles().length,
    "agentArtifactPosture() must be the union of the per-kind aggregators",
  );
});

Deno.test("every provider's guidance path derives from the catalogue's declaration", () => {
  // The catalogue owns the compiled-guidance path beside the native name and
  // label; a provider entry that reverts to a literal path could drift from
  // the vocabulary the logbook's guidance-parity findings name.
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);
    assertEquals(
      p.guidanceFile.path,
      guidancePathForNative(name),
      `${name}: guidanceFile.path must come from guidancePathForNative`,
    );
  }
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

Deno.test("the seed .gitignore fragment TRACKS every known agent's compiled guidance file", () => {
  // Tracked-by-default: the compiled guidance files are committed so a bare
  // clone (a cloud agent's only view) carries the same page a local session
  // reads. An ignore rule for one is the regression this guards against.
  for (const path of allGuidanceFilePaths()) {
    assert(
      !fragmentIgnoresFile(path),
      `templates/.gitignore.fragment ignores the compiled guidance file ${path}. ` +
        `Guidance files are tracked by default — remove the rule; the managed block ` +
        `enumerates only materialized dirs and machine-local state.`,
    );
  }
});

Deno.test("the seed .gitignore fragment ignores EVERY known agent's materialized skills dir", () => {
  for (const dir of allSkillsDirs()) {
    assert(
      fragmentIgnoresDir(dir),
      `templates/.gitignore.fragment does not ignore the materialized skills dir ${dir}. ` +
        `Add "/${dir}/" to the fragment.`,
    );
  }
});

Deno.test("the seed .gitignore fragment ignores EVERY known agent's machine-local state file", () => {
  for (const file of allLocalStateFiles()) {
    assert(
      fragmentIgnoresFile(file),
      `templates/.gitignore.fragment does not ignore the machine-local state file ${file}. ` +
        `Add "/${file}" to the fragment.`,
    );
  }
});

Deno.test("every rule in the canonical block maps to a registry-declared materialized/local path", () => {
  // Enumerated ownership: the managed block claims exactly what discern
  // materializes or keeps machine-local, and nothing more — so a user's own
  // file (a slash command under .claude/, a committed guidance file) can never
  // be swept up by an over-broad wildcard. Registry-driven: a new provider's
  // paths auto-enrol; a hand-added rule with no registry backing fails here.
  const posture = agentArtifactPosture();
  const rules = FRAGMENT_LINES.filter(
    (l) => l !== "" && !l.startsWith("#"),
  );
  for (const rule of rules) {
    assert(
      !rule.startsWith("!"),
      `the canonical block carries a negation (${rule}) — enumerated ownership needs none`,
    );
    const path = rule.replace(/^\//, "").replace(/\/$/, "");
    assert(
      posture.materializedDirs.includes(path) ||
        posture.localStateFiles.includes(path),
      `the canonical .gitignore block rule "${rule}" maps to no registry-declared ` +
        `materialized dir or local-state file — the block may claim only what the ` +
        `provider registry says discern materializes or keeps machine-local`,
    );
  }
});

Deno.test("the seed guidance scope neutralizes EVERY known agent's materialized skills dir", () => {
  const guidance = defaultGuidanceScopes(); // TOML-quoted, e.g. '".claude/skills/"'
  for (const dir of neutralAgentScopePaths()) {
    assert(
      guidance.includes(`"${dir}"`),
      `defaultGuidanceScopes() does not neutralize ${dir} — a materialized skill ` +
        `would wrongly fire the gate. It must derive from neutralAgentScopePaths().`,
    );
  }
  // Every known agent contributes a neutral region (none silently absent).
  for (const name of AGENT_NAMES) {
    const dir = providerFor(name)?.skillsDir?.path;
    if (dir === undefined) continue;
    const scopePath = `${dir.replace(/\/+$/, "")}/`;
    assert(
      neutralAgentScopePaths().includes(scopePath),
      `${name}'s materialized skills dir ${scopePath} is missing from neutralAgentScopePaths()`,
    );
  }
});

Deno.test("KEYSTONE: every known agent is covered by every cross-cutting satellite", () => {
  // One agent × every satellite. This is the single assertion a new agent must
  // satisfy: extend each named surface until it passes — never relax the check.
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);

    // 1. Compiled guidance file: TRACKED — never ignored by the seed fragment.
    // (A reuse-canonical provider's `path` is the canonical it reads, which the
    // canonical provider already covers — so this holds for emitting AND
    // reuse-canonical agents alike.)
    assert(
      !fragmentIgnoresFile(p.guidanceFile.path),
      `${name}: guidance file ${p.guidanceFile.path} is ignored by the seed fragment — compiled guidance is tracked by default`,
    );

    // 2. Materialized skills dir (when the agent has one): gitignored + neutral.
    if (p.skillsDir !== undefined) {
      assert(
        fragmentIgnoresDir(p.skillsDir.path),
        `${name}: skills dir ${p.skillsDir.path} not gitignored by the seed fragment`,
      );
      const scopePath = `${p.skillsDir.path.replace(/\/+$/, "")}/`;
      assert(
        defaultGuidanceScopes().includes(`"${scopePath}"`),
        `${name}: materialized skills dir ${scopePath} not in the seed guidance scope`,
      );
    }

    // 2b. Machine-local state (when the agent declares any): gitignored.
    for (const entry of p.localState ?? []) {
      const file = entry.path;
      assert(
        fragmentIgnoresFile(file),
        `${name}: machine-local state file ${file} not gitignored by the seed fragment`,
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

    // 7. Brand metadata: both required forms stay in the one registered asset root.
    assert(
      p.brand.mark.path.startsWith(`${PROVIDER_BRAND_ASSET_ROOT}/`) &&
        p.brand.wordmark.path.startsWith(`${PROVIDER_BRAND_ASSET_ROOT}/`),
      `${name}: compact mark and wordmark must live under ${PROVIDER_BRAND_ASSET_ROOT}`,
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
