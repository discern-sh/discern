/** Consumer checks for Discern's selected published design-system runtime. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";
import { packageManifest, type RuntimeManifest } from "discern-design-system";
import {
  COPIED_PAGE_ASSETS,
  GENERATED_SITE_OUTPUTS,
  RETIRED_SITE_OUTPUTS,
} from "../site/build.ts";
import {
  DESIGN_SYSTEM_BUNDLES,
  designSystemAssetPath,
  type DesignSystemBundleName,
} from "../site/design_system.ts";
import { renderDiscernBrand } from "../site/page-src/branding.tsx";
import { formatGeneratedText } from "../site/page-src/format-generated.ts";
import {
  COPY_PROMPT_TEXT,
  INSTALL_COMMAND,
  renderLanding,
} from "../site/page-src/landing.tsx";
import { handler } from "../site/serve.ts";
import { providerBrandSilhouette, PROVIDERS } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { runtimeAssetReferences } from "./runtime_asset_references.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SITE_ROOT = join(ROOT, "site");
const DESIGN_SYSTEM_SPECIFIER = "jsr:@discern-sh/design-system@0.12.0";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

interface DenoConfig {
  readonly workspace?: readonly string[];
  readonly imports: Readonly<Record<string, string>>;
  readonly minimumDependencyAge?: {
    readonly age: string;
    readonly exclude: readonly string[];
  };
}

interface DenoLock {
  readonly specifiers: Readonly<Record<string, string>>;
  readonly jsr: Readonly<Record<string, unknown>>;
}

interface DenoInfo {
  readonly modules?: readonly { readonly specifier?: string }[];
}

/** Select runtime React dependencies while excluding type-only package declarations. */
function reactRuntimeModules(specifiers: readonly string[]): string[] {
  return specifiers.filter((specifier) =>
    !specifier.startsWith("npm:/@types/") &&
    /(?:^|[/@-])react(?:-dom)?(?:[/.@-]|$)/i.test(specifier)
  );
}

/** Read Deno's resolved module graph for one site entrypoint. */
async function moduleSpecifiers(entrypoint: string): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  const info = JSON.parse(new TextDecoder().decode(output.stdout)) as DenoInfo;
  return (info.modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
  );
}

/** Run a repository-scoped Git probe with captured output for design-system provenance checks. */
async function git(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

/** Recursively enumerate every generated bundle file for tracked-output and provenance checks. */
async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

/** Resolve one declared design-system bundle's generated output directory. */
function bundleRoot(name: DesignSystemBundleName): string {
  return join(ROOT, "site", DESIGN_SYSTEM_BUNDLES[name].output);
}

/** Extract a required selector's declarations and fail on a missing or unterminated rule. */
function cssRuleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert(start >= 0, `missing CSS rule for ${selector}`);
  const bodyStart = css.indexOf("{", start) + 1;
  const end = css.indexOf("}", bodyStart);
  assert(end > bodyStart, `unterminated CSS rule for ${selector}`);
  return css.slice(bodyStart, end);
}

interface PageCssRule {
  readonly body: string;
  readonly selector: string;
}

/** Parse flat page-owned rules, including rules nested inside media queries. */
function pageCssRules(css: string): PageCssRule[] {
  const rules: PageCssRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = match[1];
    const body = match[2];
    if (selectorText === undefined || body === undefined) continue;
    for (const selector of selectorText.split(",")) {
      const normalized = selector.trim().replace(/\s+/g, " ");
      if (normalized === "" || normalized.startsWith("@")) continue;
      rules.push({ selector: normalized, body });
    }
  }
  return rules;
}

/** Find responsive grids that reuse a viewport-scaled shorthand gap on both axes. */
function fluidGridShorthandSelectors(css: string): string[] {
  return pageCssRules(css).flatMap(({ selector, body }) =>
    body.includes("grid-template-columns") &&
      /(?:^|;)\s*gap\s*:[^;]*vw/.test(body)
      ? [selector]
      : []
  );
}

/** Find counters that indent a lone heading away from the content below it. */
function offsetDecoratedHeadingSelectors(
  css: string,
  root: ParentNode,
): string[] {
  const declarations = new Map<string, string>();
  for (const { selector, body } of pageCssRules(css)) {
    declarations.set(selector, `${declarations.get(selector) ?? ""}\n${body}`);
  }

  const decorated = new Set<string>();
  for (const [selector, body] of declarations) {
    for (const suffix of ["::before", "::after"] as const) {
      if (selector.endsWith(suffix) && body.includes("content:")) {
        decorated.add(selector.slice(0, -suffix.length));
      }
    }
  }

  return [...decorated].filter((selector) => {
    const body = declarations.get(selector) ?? "";
    if (
      !body.includes("display: grid") ||
      !body.includes("grid-template-columns")
    ) return false;
    return [...root.querySelectorAll(selector)].some((element) =>
      element.children.length === 1 && element.nextElementSibling !== null
    );
  });
}

const INVERSE_HEADING_SELECTOR =
  ".landing-section--inverse :where(h1, h2, h3, h4, h5, h6)";

/** Find top-level inverse sections that can regress to theme-token heading ink. */
function inverseSectionHeadingViolations(
  css: string,
  root: ParentNode,
): string[] {
  const rules = pageCssRules(css);
  const sharedStart = css.indexOf(`${INVERSE_HEADING_SELECTOR} {`);
  const sharedBodyStart = sharedStart < 0
    ? -1
    : css.indexOf("{", sharedStart) + 1;
  const sharedEnd = sharedBodyStart < 0
    ? -1
    : css.indexOf("}", sharedBodyStart);
  const sharedHeadingRule = sharedBodyStart > 0 &&
    sharedEnd > sharedBodyStart &&
    /(?:^|;)\s*color\s*:\s*inherit\s*;?/.test(
      css.slice(sharedBodyStart, sharedEnd),
    );
  const lightForeground =
    /(?:^|;)\s*color\s*:\s*(?:white|#fff(?:fff)?|oklch\(\s*(?:9\d(?:\.\d+)?|100)%|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i;
  const declarations = new Map<Element, string>();

  for (const { selector, body } of rules) {
    const querySelector = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (querySelector === "") continue;
    let matches: NodeListOf<Element>;
    try {
      matches = root.querySelectorAll(querySelector);
    } catch {
      continue;
    }
    for (const element of matches) {
      if (
        element.classList.contains("landing-section") &&
        element.parentElement?.matches("main")
      ) {
        declarations.set(
          element,
          `${declarations.get(element) ?? ""}\n${body}`,
        );
      }
    }
  }

  return [...declarations].flatMap(([element, body]) => {
    const inverse = /(?:^|;)\s*background(?:-color)?\s*:/.test(body) &&
      lightForeground.test(body);
    return inverse &&
        !(sharedHeadingRule &&
          element.classList.contains("landing-section--inverse"))
      ? [element.id === "" ? element.className : `#${element.id}`]
      : [];
  }).toSorted();
}

/** Find authored sticky content without a boundary that ends before later content. */
function unboundedStickySelectors(css: string, root: ParentNode): string[] {
  const violations = new Set<string>();
  for (const { selector, body } of pageCssRules(css)) {
    if (!/(?:^|;)\s*position\s*:\s*sticky\s*;?/.test(body)) continue;
    const querySelector = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (querySelector === "") continue;
    let matches: NodeListOf<Element>;
    try {
      matches = root.querySelectorAll(querySelector);
    } catch {
      continue;
    }
    for (const element of matches) {
      // Persistent page chrome intentionally uses the viewport as its boundary.
      if (element.matches(".landing-masthead")) continue;
      if (element.closest(".landing-sticky-boundary") === null) {
        violations.add(selector);
      }
    }
  }
  return [...violations].toSorted();
}

/** Find homepage navigation actions whose idle state has no visible boundary. */
function transparentNavigationActions(root: ParentNode): string[] {
  return [...root.querySelectorAll("a.discern-button--ghost")].map((action) =>
    action.textContent?.trim() ?? ""
  );
}

/** Decode the runtime manifest emitted beside a selected design-system bundle. */
async function bundleManifest(
  name: DesignSystemBundleName,
): Promise<RuntimeManifest> {
  return JSON.parse(
    await Deno.readTextFile(join(bundleRoot(name), "manifest.json")),
  ) as RuntimeManifest;
}

/** Expand configured component groups and transitive dependencies in canonical manifest order. */
function resolvedSelection(name: DesignSystemBundleName): string[] {
  const selection = DESIGN_SYSTEM_BUNDLES[name];
  const seeds = new Set<string>(selection.components);
  const selectedGroups = new Set<string>(selection.groups);
  for (const component of packageManifest.components) {
    if (selectedGroups.has(component.group)) seeds.add(component.id);
  }
  const canonicalIds = (ids: Iterable<string>): string[] => {
    const selected = new Set(ids);
    return packageManifest.components
      .filter((component) => selected.has(component.id))
      .map((component) => component.id);
  };
  const resolved: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const component = packageManifest.components.find((entry) =>
      entry.id === id
    );
    assert(component !== undefined, `${name} selects unknown component ${id}`);
    for (const dependency of canonicalIds(component.dependencies)) {
      visit(dependency);
    }
    visited.add(id);
    resolved.push(id);
  };
  for (const id of canonicalIds(seeds)) visit(id);
  return resolved;
}

/** Collect CSS rule preludes that mention classes owned by selected components. */
function componentOwnedSelectors(
  source: string,
  ownedClasses: ReadonlySet<string>,
): string[] {
  const selectors = new Set<string>();
  for (const rule of source.matchAll(/([^{}]+)\{/g)) {
    const prelude = (rule[1] ?? "").trim();
    for (const match of prelude.matchAll(/\.([_a-zA-Z0-9-]+)/g)) {
      if (ownedClasses.has(match[1] ?? "")) selectors.add(prelude);
    }
  }
  return [...selectors].toSorted();
}

Deno.test("Discern pins one exact public design-system dependency", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as DenoConfig;
  assertEquals(config.workspace, undefined);
  assertEquals(
    Object.entries(config.imports).filter(([key, value]) =>
      key.includes("design-system") || value.includes("design-system")
    ),
    [["discern-design-system", DESIGN_SYSTEM_SPECIFIER]],
  );
  assertEquals(config.minimumDependencyAge, {
    age: "P1D",
    exclude: ["jsr:@discern-sh/design-system"],
  });

  const lock = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  ) as DenoLock;
  assertEquals(lock.specifiers[DESIGN_SYSTEM_SPECIFIER], "0.12.0");
  assert("@discern-sh/design-system@0.12.0" in lock.jsr);

  const sourceFiles = (await walk(SITE_ROOT)).filter((path) =>
    /\.[cm]?[jt]sx?$/.test(path)
  );
  const forbidden = [
    "site/design-system",
    "jsr:@discern-sh/design-system",
    "jsr.io/@discern-sh/design-system",
    "/.deno/",
    "/design-system/dist/",
  ];
  const violations: string[] = [];
  for (const path of sourceFiles) {
    const source = await Deno.readTextFile(path);
    for (const pattern of forbidden) {
      if (source.includes(pattern)) {
        violations.push(`${relative(ROOT, path)}: ${pattern}`);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("the production site import graph remains React-free", async () => {
  const newSibling = "https://example.test/vendor/react-dom@99/server";
  assertEquals(
    reactRuntimeModules([
      "https://example.test/new-server.ts",
      newSibling,
    ]),
    [newSibling],
  );
  assertEquals(
    reactRuntimeModules(
      await moduleSpecifiers(join(ROOT, "site/main.ts")),
    ),
    [],
  );
});

Deno.test("each emitted bundle is the dependency closure of the site selection", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const expected = DESIGN_SYSTEM_BUNDLES[name];
    const runtime = await bundleManifest(name);
    const resolved = resolvedSelection(name);
    assertEquals(runtime.package, packageManifest.package);
    assertEquals(runtime.groups, packageManifest.groups);
    assertEquals(
      runtime.components,
      resolved.map((id) => {
        const component = packageManifest.components.find((entry) =>
          entry.id === id
        );
        assert(
          component !== undefined,
          `${name} resolved unknown component ${id}`,
        );
        return component;
      }),
    );
    assertEquals(runtime.publicTokenNames, packageManifest.publicTokenNames);
    assertEquals(runtime.selection.all, false);
    assertEquals(runtime.selection.requestedComponents, expected.components);
    assertEquals(runtime.selection.requestedGroups, expected.groups);
    assertEquals(runtime.selection.resolvedComponents, resolved);
    assertEquals(runtime.selection.assets, expected.assets);
    assertEquals(runtime.selection.theme, expected.theme);
  }
});

Deno.test("the docs bundle excludes unrelated compositions and optional grain", async () => {
  const runtime = await bundleManifest("docs");
  const selected = new Set(runtime.selection.resolvedComponents);
  // The docs chrome legitimately selects the Editorial table of contents;
  // every OTHER Marketing/Editorial composition must stay out of the bundle.
  const requested = new Set(resolvedSelection("docs"));
  const unrelated = packageManifest.components.filter((component) =>
    (component.group === "Marketing" || component.group === "Editorial") &&
    !requested.has(component.id)
  );
  assert(unrelated.length > 0, "the exclusion set must stay non-empty");
  assert(unrelated.every((component) => !selected.has(component.id)));
  const css = await Deno.readTextFile(join(bundleRoot("docs"), "discern.css"));
  for (const component of unrelated) {
    for (const ownedClass of component.ownedClasses) {
      assert(
        !css.includes(`.${ownedClass}`),
        `docs CSS contains ${ownedClass}`,
      );
    }
  }
  assertEquals(runtime.selection.assets, ["fonts"]);
  assertEquals(
    await Array.fromAsync(Deno.readDir(bundleRoot("docs"))).then((entries) =>
      entries.some((entry) => entry.name === "grain.css")
    ),
    false,
  );
});

Deno.test("the docs bundle emits the glossary term and its hover-card dependency", async () => {
  const runtime = await bundleManifest("docs");
  assert(runtime.selection.resolvedComponents.includes("glossary-term"));
  assert(runtime.selection.resolvedComponents.includes("hover-card"));
  assertEquals(runtime.outputs.scripts, ["discern.js"]);
  const css = await Deno.readTextFile(join(bundleRoot("docs"), "discern.css"));
  assertStringIncludes(css, ".discern-glossary-term");
  assertStringIncludes(css, ".discern-hover-card");
  assertStringIncludes(css, ".discern-dotted-underline");
});

Deno.test("generated output is ignored and reproducible from its selections", async () => {
  const repoPaths = GENERATED_SITE_OUTPUTS.map((output) =>
    join("site", output)
  );
  const tracked = await git(["ls-files", "--", ...repoPaths]);
  assertEquals(tracked.code, 0);
  assertEquals(new TextDecoder().decode(tracked.stdout).trim(), "");
  for (const path of repoPaths) {
    const ignored = await git(["check-ignore", "--quiet", "--no-index", path]);
    assertEquals(ignored.code, 0, `${path} must be ignored`);
  }

  assertEquals(
    await Deno.readTextFile(join(ROOT, "site/pages/index.html")),
    await formatGeneratedText(renderLanding(), "html"),
  );
  assertEquals(
    await Deno.readTextFile(join(ROOT, "site/pages/fragments/brand.html")),
    renderDiscernBrand(),
  );

  for (const asset of COPIED_PAGE_ASSETS) {
    assertEquals(
      await Deno.readTextFile(join(bundleRoot("compositions"), asset)),
      `/* Generated by site/build.ts from site/page-src/${asset}. Do not edit. */\n${await Deno
        .readTextFile(join(ROOT, "site/page-src", asset))}`,
    );
  }

  for (const output of RETIRED_SITE_OUTPUTS) {
    await assertRejects(
      () => Deno.stat(join(ROOT, "site", output)),
      Deno.errors.NotFound,
      output,
    );
  }
});

Deno.test("the public homepage presents the complete signed-off launch sequence", async () => {
  assert(DESIGN_SYSTEM_BUNDLES.compositions.routes.includes("/"));
  const response = await handler(
    new Request("https://discern.sh/", { headers: BROWSER }),
  );
  assertEquals(response.status, 200);
  const html = await response.text();
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const text = body.textContent ?? "";

  // The first screen carries the ambition, category, actions, and direct prompt.
  assertEquals(body.querySelectorAll("h1").length, 1);
  assertEquals(
    body.querySelector("h1")?.textContent?.trim(),
    "A bolder way to build.",
  );
  assertEquals(body.querySelector("h1 em")?.textContent, "bolder");
  assertStringIncludes(text, "For people who take their software seriously");
  assertEquals(
    (body.querySelector(".landing-hero")?.textContent ?? "").includes(
      "An engineering practice for agent-built software",
    ),
    true,
  );
  assert(
    body.querySelector(
      ".landing-hero [data-copy-prompt].discern-button--primary",
    ) !== null,
  );
  assert(
    body.querySelector(
      '.landing-hero a[href="#project-preview"].discern-button--primary',
    ) !== null,
  );
  assert(
    body.querySelector(
      '.landing-hero a[href="#commissioning"].discern-button--secondary',
    ) !== null,
  );
  assertStringIncludes(text, COPY_PROMPT_TEXT);

  // The transcript-led argument is one hero followed by nine sections.
  assertEquals(body.querySelectorAll("main#main").length, 1);
  assert(body.querySelector(".discern-skip-link") !== null);
  assertEquals(body.querySelector(".discern-article-layout"), null);
  assertEquals(body.querySelectorAll("main > .landing-section").length, 9);
  assertEquals(
    [...body.querySelectorAll("main > .landing-section h2")].map((heading) =>
      heading.textContent?.trim()
    ),
    [
      "More capability should widen your ambition.",
      "Turn a backlog into organized work.",
      "One careful beginning. Every future agent starts ahead.",
      "Come back to work that is ready for a decision.",
      "Make an improvement part of the next starting point.",
      "Built for people who care what happens next.",
      "Change agents without starting the project over.",
      "Know what the evidence covers.",
      "Software worth putting your name to.",
    ],
  );
  for (const placeholder of ["Placeholder", "Lorem ipsum", "The ask"]) {
    assertEquals(text.includes(placeholder), false, placeholder);
  }
  for (
    const retired of [
      "Engineering discipline",
      "Runs offline",
      "proves their work is correct before it ships",
      "Discern makes AI coding agents",
    ]
  ) {
    assertEquals(text.includes(retired), false, retired);
  }

  // The masthead and the primary product specimen use published components.
  const masthead = body.querySelector(".landing-masthead");
  assert(masthead !== null);
  assert(masthead.classList.contains("discern-site-header"));
  assert(masthead.classList.contains("discern-site-header--campaign"));
  assert(masthead.classList.contains("discern-site-header--sticky"));
  const mastheadInner = masthead.querySelector(".discern-site-header__inner");
  assert(mastheadInner !== null && mastheadInner !== undefined);
  assert(
    mastheadInner.querySelector(".discern-site-header__brand--mono") !== null,
  );
  assert(
    mastheadInner.querySelector(".discern-theme-toggle--quiet") !== null,
  );
  assert(body.querySelectorAll(".landing-brand-name").length >= 2);
  const hero = body.querySelector(".landing-hero");
  assert(hero !== null);
  assert(hero.classList.contains("discern-hero-block--showcase"));
  assert(hero.classList.contains("discern-hero-block--atmospheric"));
  assertEquals(hero.classList.contains("discern-grain-wash"), false);
  assertEquals(
    DESIGN_SYSTEM_BUNDLES.compositions.assets.map(String).includes("grain"),
    false,
  );
  assertEquals(html.includes("grain.css"), false);

  const projectPreview = hero.querySelector("[data-project-preview]");
  assert(projectPreview !== null);
  const previewWindow = projectPreview.querySelector(
    ".landing-project-preview__window",
  );
  assert(previewWindow !== null);
  assert(previewWindow.classList.contains("discern-window--showcase"));
  assert(projectPreview.hasAttribute("data-site-prose-exclude"));
  assertEquals(projectPreview.getAttribute("data-preview-stage"), "decision");
  const previewControls = projectPreview.querySelector(
    "[data-preview-controls]",
  );
  assert(previewControls !== null);
  assert(previewControls.hasAttribute("hidden"));
  assertEquals(
    [...projectPreview.querySelectorAll("[data-preview-control]")].map(
      (control) => [
        control.textContent?.trim(),
        control.getAttribute("data-preview-control"),
      ],
    ),
    [
      ["Brief", "brief"],
      ["Work", "work"],
      ["Evidence", "proof"],
      ["Decision", "decision"],
    ],
  );
  assertEquals(
    [...projectPreview.querySelectorAll("[data-preview-item]")].map((item) =>
      item.getAttribute("data-preview-item")
    ),
    ["brief", "work", "proof", "decision"],
  );
  assertStringIncludes(
    projectPreview.textContent ?? "",
    "Proof · 41d9a8f · clean committed tree",
  );

  const integrations = hero.querySelector(".landing-integrations");
  assert(integrations !== null);
  assert(integrations.classList.contains("discern-logo-cloud--strip"));
  assert(body.querySelector("#agents .landing-integrations--compact") !== null);
  assertEquals(body.querySelectorAll(".landing-integrations").length, 2);

  const lifecycle = body.querySelector("#delegation .landing-lifecycle");
  assert(lifecycle !== null);
  assertEquals(lifecycle.querySelectorAll(":scope > li").length, 5);
  assertEquals(
    [...lifecycle.querySelectorAll(":scope > li > small")].map((label) =>
      label.textContent?.trim()
    ),
    ["Commission", "Shape", "Work", "Prove", "Decide"],
  );

  const commissioning = body.querySelector(
    "#commissioning .landing-commissioning-card",
  );
  assert(commissioning !== null);
  assert(commissioning.hasAttribute("data-site-prose-exclude"));
  assertEquals(commissioning.querySelectorAll("ol > li").length, 5);
  assertEquals(
    [...commissioning.querySelectorAll("ol strong")].map((label) =>
      label.textContent?.trim()
    ),
    ["Study", "Ask", "Establish", "Prove", "Inherit"],
  );

  const compactStandard = body.querySelector(".standard-trajectory--compact");
  assert(compactStandard !== null);
  assertEquals(
    compactStandard.querySelectorAll(".standard-trajectory__summary > div")
      .length,
    2,
  );
  assert(compactStandard.querySelector(".standard-chart") !== null);
  for (
    const selector of [
      ".standard-trajectory__status",
      ".standard-data",
      ".standard-annotations",
      ".standard-caveat",
    ]
  ) assertEquals(compactStandard.querySelector(selector), null, selector);

  const returnedChange = body.querySelector("#decision .landing-return");
  assert(returnedChange !== null);
  assert(returnedChange.hasAttribute("data-site-prose-exclude"));
  assertEquals(
    [...returnedChange.querySelectorAll(".landing-return__label")].map(
      (label) => label.textContent?.replace(/\s+/g, " ").trim(),
    ),
    [
      "01 Agent account",
      "02 Project checks",
      "03 Exact-tree evidence",
      "04 Human decision",
    ],
  );
  assertEquals(
    returnedChange.querySelectorAll(".landing-return__checks li").length,
    4,
  );
  assertEquals(
    body.querySelector("#decision .landing-section__action a")?.getAttribute(
      "href",
    ),
    "/docs/quality-gate/the-proof",
  );

  const compounding = body.querySelector("#compounding .landing-compounding");
  assert(compounding !== null);
  assert(compounding.hasAttribute("data-site-prose-exclude"));
  assertEquals(compounding.querySelectorAll(":scope > article").length, 2);
  assert(
    compounding.querySelector(
      ".landing-compounding__measure .standard-trajectory--compact",
    ) !== null,
  );
  assertEquals(
    compounding.querySelectorAll(".landing-memory__routes > li").length,
    3,
  );
  assert(compounding.querySelector(".landing-memory__next") !== null);
  assertEquals(
    [...body.querySelectorAll("#compounding .landing-section__action a")].map(
      (link) => link.getAttribute("href"),
    ),
    ["/docs/quality-gate/standards", "/docs/agent-guidance"],
  );

  const possibility = body.querySelector("#possibility");
  assert(possibility !== null);
  const possibilityStory = possibility.querySelector(
    ".landing-possibility__story",
  );
  assert(possibilityStory !== null);
  assertEquals(possibilityStory.querySelectorAll(":scope > p").length, 2);
  assertEquals(
    possibility.querySelectorAll(".landing-possibility__relationship > div")
      .length,
    3,
  );
  assertEquals(
    body.querySelector("#commissioning .landing-section__action a")
      ?.getAttribute("href"),
    "/docs/getting-started/walkthrough",
  );
  assertEquals(
    body.querySelector("#delegation .landing-section__action a")?.getAttribute(
      "href",
    ),
    "/docs/worktrees/team-workflow",
  );

  assertEquals(
    body.querySelectorAll("#audiences .landing-audiences__cards > article")
      .length,
    2,
  );
  assert(
    body.querySelector("#audiences .landing-audiences__threshold") !== null,
  );

  const agentResult = body.querySelector("#agents .landing-agent-result");
  assert(agentResult !== null);
  assert(agentResult.classList.contains("discern-terminal--showcase"));
  assertEquals(
    [...body.querySelectorAll("#agents .landing-agents__main a")].map((link) =>
      link.getAttribute("href")
    ),
    ["/docs/agent-integrations", "/llms.txt"],
  );
  assertStringIncludes(agentResult.textContent ?? "", '"behind_trunk"');

  assertEquals(
    body.querySelectorAll("#trust .landing-trust__facts > article").length,
    4,
  );
  assertEquals(
    body.querySelectorAll("#trust .landing-trust__lower > article").length,
    2,
  );

  assertEquals(body.querySelectorAll("[data-copy-prompt]").length, 2);
  assertEquals(
    [...body.querySelectorAll(".landing-copy-prompt__text")].map((prompt) =>
      prompt.textContent?.trim()
    ),
    [COPY_PROMPT_TEXT, COPY_PROMPT_TEXT],
  );
  assertEquals(
    body.querySelector(".landing-install code")?.textContent,
    INSTALL_COMMAND,
  );
  assertEquals(
    [...body.querySelectorAll(".landing-masthead nav a")].map((link) => [
      link.textContent?.trim(),
      link.getAttribute("href"),
    ]),
    [
      ["How it works", "#delegation"],
      ["What returns", "#decision"],
      ["Trust", "#trust"],
      ["GitHub ↗", "https://github.com/jackwh/discern"],
    ],
  );
  assertEquals(
    body.querySelector(".landing-masthead__action")?.getAttribute("href"),
    "#start",
  );

  // Provider labels and artwork remain derived from the canonical catalogue.
  const integrationItems = [...integrations.querySelectorAll("li")];
  const integrationImages = integrationItems.map((item) =>
    item.querySelector("img")
  );
  assertEquals(
    integrationItems.map((item) => item.lastElementChild?.textContent?.trim()),
    AGENT_NAMES.map((name) => PROVIDERS[name].label),
  );
  assertEquals(
    integrationImages.map((image) => image?.getAttribute("src")),
    AGENT_NAMES.map((name) => PROVIDERS[name].brand.mark.path),
  );
  assertEquals(
    integrationImages.map((image) => image?.getAttribute("alt")),
    AGENT_NAMES.map(() => ""),
  );
  assertEquals(
    integrationImages.map((image) => image?.getAttribute("class")),
    AGENT_NAMES.map(() => "landing-provider-logo"),
  );
  assertEquals(
    integrationItems.map((item) =>
      item.querySelector(".discern-logo-cloud__mark--masked")?.getAttribute(
        "style",
      )
    ),
    AGENT_NAMES.map((name) =>
      `--discern-logo-cloud-mark-mask:url("${
        providerBrandSilhouette(PROVIDERS[name].brand).path
      }")`
    ),
  );
  assertEquals(
    body.querySelector(".landing-integrations")?.getAttribute("aria-label"),
    `${AGENT_NAMES.length} supported coding agent providers`,
  );
  assertEquals(transparentNavigationActions(body), []);
  const workstreamAction = [...body.querySelectorAll("a.discern-button")].find(
    (action) => action.textContent?.trim() === "See the real workstream plan",
  );
  assertEquals(
    workstreamAction?.closest(".landing-section")?.id,
    "delegation",
  );

  // Page-owned behavior is one local script; the browser receives no React.
  assertStringIncludes(
    html,
    'src="/assets/design-system/compositions/landing.js"',
  );
  const footer = body.querySelector(".discern-site-footer");
  assert(footer !== null);
  assertEquals(
    footer.querySelector(".discern-site-footer__description")?.textContent
      ?.trim(),
    "An engineering practice for agent-built software.",
  );
  assertEquals(
    footer.querySelector(".discern-site-footer__base > span:last-child")
      ?.textContent?.trim(),
    "© 2026 Jack Webb-Heller.",
  );
  assertEquals(text.includes("Open source under Apache-2.0."), false);
  assertEquals(text.includes("Free and open source"), false);

  const landingCss = await Deno.readTextFile(
    join(ROOT, "site/page-src/landing.css"),
  );
  const componentCss = await Deno.readTextFile(
    join(bundleRoot("compositions"), "discern.css"),
  );
  assertEquals(inverseSectionHeadingViolations(landingCss, body), []);
  assertEquals(unboundedStickySelectors(landingCss, body), []);
  const stickyBoundary = body.querySelector(
    "#possibility .landing-sticky-boundary",
  );
  assert(stickyBoundary !== null);
  assert(
    stickyBoundary.contains(
      body.querySelector("#possibility .landing-section-heading"),
    ),
  );
  assertEquals(
    stickyBoundary.contains(
      body.querySelector("#possibility .landing-possibility__relationship"),
    ),
    false,
  );
  const mastheadRule = cssRuleBody(
    componentCss,
    ".discern-site-header--campaign",
  );
  assertStringIncludes(mastheadRule, "z-index: 50;");
  assertStringIncludes(mastheadRule, "backdrop-filter: blur(20px)");
  const mastheadInnerRule = cssRuleBody(
    componentCss,
    ".discern-site-header--campaign .discern-site-header__inner",
  );
  assertStringIncludes(
    mastheadInnerRule,
    "width: min(100% - 2 * var(--discern-space-6), 86rem);",
  );
  assertEquals(
    cssRuleBody(landingCss, ".landing-brand-name").includes(
      "inset-block-start",
    ),
    false,
  );
  const integrationsRule = cssRuleBody(
    componentCss,
    ".discern-logo-cloud--strip",
  );
  assertStringIncludes(
    integrationsRule,
    "width: min(100% - 2 * var(--discern-space-6), 86rem);",
  );
  assertStringIncludes(
    integrationsRule,
    "padding-block: var(--discern-space-20);",
  );
  const heroInnerRule = cssRuleBody(
    componentCss,
    ".discern-hero-block--showcase .discern-hero-block__inner",
  );
  assertStringIncludes(
    heroInnerRule,
    "width: min(100% - 2 * var(--discern-space-6), 86rem);",
  );
  assertStringIncludes(
    heroInnerRule,
    "padding-block: clamp(5rem, 9vw, 8.75rem)",
  );
  assertStringIncludes(
    cssRuleBody(
      componentCss,
      ".discern-hero-block--showcase .discern-hero-block__inner",
    ),
    "text-align: center;",
  );
  assertStringIncludes(
    cssRuleBody(
      componentCss,
      ".discern-hero-block--showcase .discern-hero-block__title",
    ),
    "font-size: clamp(4.6rem, 9vw, 8.7rem);",
  );
  assertStringIncludes(
    cssRuleBody(componentCss, ".discern-window--showcase"),
    "border-radius: clamp(1.25rem, 2.8vw, 2rem);",
  );
  assertStringIncludes(
    cssRuleBody(componentCss, ".discern-terminal--showcase"),
    "--discern-terminal-surface: var(--discern-color-inverse-surface);",
  );
  assertStringIncludes(
    cssRuleBody(landingCss, ".landing-project-preview__body"),
    "grid-template-columns: minmax(0, 1.25fr) minmax(19rem, 0.75fr);",
  );
  assertStringIncludes(
    cssRuleBody(landingCss, ".landing-lifecycle"),
    "grid-template-columns: repeat(5, minmax(0, 1fr));",
  );
  assertStringIncludes(landingCss, "[data-preview-enhanced]");
  assertStringIncludes(landingCss, "@media (max-width: 700px)");
  assertStringIncludes(landingCss, "@media (prefers-reduced-motion: reduce)");
  assertEquals(fluidGridShorthandSelectors(landingCss), []);
  const checksRule = cssRuleBody(landingCss, ".landing-return__checks");
  assertStringIncludes(checksRule, "display: grid;");
  assertStringIncludes(checksRule, "align-content: center;");
  assertEquals(offsetDecoratedHeadingSelectors(landingCss, body), []);
  const heroGlowRule = cssRuleBody(
    componentCss,
    ".discern-hero-block--atmospheric::before",
  );
  assertStringIncludes(heroGlowRule, "linear-gradient(112deg,");
  assertStringIncludes(
    heroGlowRule,
    "clip-path: polygon(29% 0, 71% 0, 94% 100%, 6% 100%);",
  );
  assertEquals(heroGlowRule.includes("border-radius:"), false);
  assertEquals(heroGlowRule.includes("filter:"), false);
  assertEquals(heroGlowRule.includes("opacity:"), false);
  for (
    const retiredPageRule of [
      ".landing-masthead {",
      ".landing-hero::before {",
      ".landing-project-preview__window {",
      ".landing-agent-result {",
      ".landing-provider-logo-frame",
    ]
  ) assertEquals(landingCss.includes(retiredPageRule), false, retiredPageRule);
  assertStringIncludes(
    landingCss,
    ".landing-hero__halo {\n      display: none;",
  );
  assertStringIncludes(
    cssRuleBody(landingCss, ".landing-hero__halo"),
    "inset-inline-start: calc(50% + min(38rem, 38vw));",
  );
  assertEquals(landingCss.includes("textures/grain.png"), false);
  const darkSilhouetteRule = cssRuleBody(
    componentCss,
    ".discern-logo-cloud__mark--masked::after",
  );
  assertStringIncludes(
    darkSilhouetteRule,
    "background: light-dark(transparent, currentColor);",
  );
  assertStringIncludes(
    darkSilhouetteRule,
    "mask: var(--discern-logo-cloud-mark-mask)",
  );
  assertEquals(landingCss.includes(".landing-provider-logo--"), false);

  // Static output: local runtime assets only, and no React browser runtime.
  assert(
    runtimeAssetReferences(html).every((path) => path.startsWith("/")),
  );
  assertEquals(
    ["fonts.googleapis.com", "cdn.jsdelivr.net", "jsr.io", "react"].filter(
      (origin) => html.includes(origin),
    ),
    [],
  );
  dom.window.close();
});

Deno.test("the homepage CTA detector enrolls an unrelated future action", () => {
  const synthetic = new JSDOM(
    '<main><a class="discern-button discern-button--ghost" href="#fresh">Fresh action</a></main>',
  );
  assertEquals(transparentNavigationActions(synthetic.window.document), [
    "Fresh action",
  ]);
  synthetic.window.close();
});

Deno.test("homepage layout detectors enroll unrelated future structures", () => {
  assertEquals(
    fluidGridShorthandSelectors(`
      .fresh-split {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: clamp(2rem, 7vw, 7rem);
      }
    `),
    [".fresh-split"],
  );

  const synthetic = new JSDOM(`
    <section>
      <header class="fresh-numbered-heading"><h2>Fresh heading</h2></header>
      <p>Aligned content</p>
    </section>
  `);
  assertEquals(
    offsetDecoratedHeadingSelectors(
      `
      .fresh-numbered-heading {
        display: grid;
        grid-template-columns: 4rem minmax(0, 1fr);
      }
      .fresh-numbered-heading::before { content: "01"; }
    `,
      synthetic.window.document,
    ),
    [".fresh-numbered-heading"],
  );

  const inverseSynthetic = new JSDOM(`
    <main>
      <section id="fresh-depth" class="landing-section fresh-depth">
        <h2>Fresh inverse heading</h2>
      </section>
    </main>
  `);
  assertEquals(
    inverseSectionHeadingViolations(
      `.fresh-depth { background-color: #10131d; }
       .fresh-depth { color: white; }`,
      inverseSynthetic.window.document,
    ),
    ["#fresh-depth"],
  );
  inverseSynthetic.window.close();

  const stickySynthetic = new JSDOM(`
    <main><section><header class="fresh-pin">Fresh sticky story</header></section></main>
  `);
  assertEquals(
    unboundedStickySelectors(
      `.fresh-pin { position: sticky; inset-block-start: 4rem; }`,
      stickySynthetic.window.document,
    ),
    [".fresh-pin"],
  );
  stickySynthetic.window.close();
  synthetic.window.close();
});
Deno.test("consumer CSS never targets a package-manifest-owned class", async () => {
  const owned = new Set(
    packageManifest.components.flatMap((component) => component.ownedClasses),
  );
  assert(owned.size > 0);
  const violations: string[] = [];
  for (const path of await walk(SITE_ROOT)) {
    const repoPath = relative(ROOT, path);
    if (
      !path.endsWith(".css") ||
      repoPath.startsWith("site/pages/assets/design-system/")
    ) continue;
    for (
      const selector of componentOwnedSelectors(
        await Deno.readTextFile(path),
        owned,
      )
    ) {
      violations.push(`${repoPath}: ${selector}`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("bundle routes use local static assets and ship no React runtime", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    for (const route of DESIGN_SYSTEM_BUNDLES[name].routes) {
      const response = await handler(
        new Request(`https://discern.sh${route}`, { headers: BROWSER }),
      );
      assertEquals(response.status, 200, route);
      const html = await response.text();
      assertStringIncludes(html, "data-discern-root");
      const runtimeRefs = runtimeAssetReferences(html);
      assert(runtimeRefs.length > 0, `${route} has no runtime assets`);
      const runtime = await bundleManifest(name);
      for (const script of runtime.outputs.scripts) {
        const expected = designSystemAssetPath(name, script);
        assert(
          runtimeRefs.includes(expected),
          `${route} omits emitted package script ${expected}`,
        );
      }
      assert(
        runtimeRefs.every((value) => value.startsWith("/")),
        `${route} remote runtime references: ${runtimeRefs.join(", ")}`,
      );
      const bundlePrefix = designSystemAssetPath(name, "");
      assert(
        runtimeRefs.filter((value) => value.includes("/design-system/"))
          .every((value) => value.startsWith(bundlePrefix)),
        `${route} uses the wrong bundle: ${runtimeRefs.join(", ")}`,
      );
      assertEquals(
        runtimeRefs.filter((value) => /(?:react|jsx-runtime)/i.test(value)),
        [],
      );
    }
  }
});

Deno.test("every bundle selects the canonical brand lockup", () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    assert(
      DESIGN_SYSTEM_BUNDLES[name].components.includes("brand"),
      `${name} must select the brand component`,
    );
  }
});

Deno.test("every emitted package asset is local, licensed, and served by type", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const runtime = await bundleManifest(name);
    const integrity = new Map(
      runtime.integrity.files.map((file) => [file.path, file]),
    );
    for (const file of runtime.integrity.files) {
      const path = designSystemAssetPath(name, file.path);
      const response = await handler(
        new Request(`https://discern.sh${path}`, { headers: BROWSER }),
      );
      assertEquals(response.status, 200, path);
      assertStringIncludes(
        response.headers.get("content-type") ?? "",
        file.mediaType,
        path,
      );
      assertEquals((await response.arrayBuffer()).byteLength, file.bytes, path);
    }

    const fontOutputs = runtime.outputs.assets.filter((path) =>
      path.startsWith("fonts/") || path.startsWith("licenses/") ||
      path === "fonts.css"
    );
    const grainOutputs = runtime.outputs.assets.filter((path) =>
      path.startsWith("textures/") || path === "grain.css"
    );
    assertEquals(
      fontOutputs.length > 0,
      runtime.selection.assets.includes("fonts"),
    );
    assertEquals(
      grainOutputs.length > 0,
      runtime.selection.assets.includes("grain"),
    );
    for (const path of runtime.outputs.assets) {
      assert(integrity.has(path), `${name} asset lacks integrity: ${path}`);
    }
    for (
      const licence of fontOutputs.filter((path) =>
        path.startsWith("licenses/")
      )
    ) {
      const body = await Deno.readTextFile(join(bundleRoot(name), licence));
      assertStringIncludes(body, "SIL OPEN FONT LICENSE");
    }
  }
});
