/**
 * The design-system demo's permanent boundary: authored sources generate the
 * ignored static artifact deterministically, component additions auto-enrol,
 * and the browser-facing page remains local-asset-only with no React runtime.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join, relative, toFileUrl } from "@std/path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDesignSystemRuntime } from "../scripts/build.ts";
import { GENERATED_SITE_OUTPUTS } from "../../build.ts";
import { renderContentDesignDemo } from "../../page-src/content-design-demo.tsx";
import { renderDesignSystemDemo } from "../../page-src/design-system-demo.tsx";
import { formatGeneratedText } from "../../page-src/format-generated.ts";
import { designTokens, themeTokens } from "../src/tokens/tokens.ts";
import { Kicker } from "../src/components/display/kicker/kicker.tsx";
import { Terminal } from "../src/components/display/terminal/terminal.tsx";
import type { ComponentMeta } from "../src/types/component-meta.ts";
import { runtimeAssetReferences } from "./runtime_references.ts";

const ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const PUBLIC_ROOT = join(ROOT, "site", "pages", "assets", "design-system");
const AUTHORED_ASSET_ROOT = join(
  ROOT,
  "site",
  "design-system",
  "assets",
);
const COMPONENT_ROOT = join(ROOT, "site", "design-system", "src", "components");

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function sha256(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  return encodeHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function git(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function themeIncoherentBackgrounds(
  source: string,
  fixedColorNames: ReadonlySet<string>,
): string[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => {
      const declarations = match[2] ?? "";
      const background = declarations.match(/background(?:-color)?\s*:[^;]+;/s)
        ?.[0] ?? "";
      const references = [...background.matchAll(/var\((--ds-color-[^)]+)\)/g)]
        .map((reference) => reference[1] ?? "");
      return /--ds-color-(?:canvas|surface(?:-sunken)?)/.test(background) &&
        references.some((reference) => fixedColorNames.has(reference));
    })
    .map((match) => (match[1] ?? "").trim());
}

interface RampToken {
  readonly name: string;
  readonly value?: string;
  readonly light?: string;
  readonly dark?: string;
}

function roleRampViolations(
  fixed: readonly RampToken[],
  themed: readonly RampToken[],
): string[] {
  const pattern = /^--ds-color-(.+)-(\d+)$/;
  const groups = new Map<string, RampToken[]>();
  for (const token of [...fixed, ...themed]) {
    const match = token.name.match(pattern);
    if (match === null) continue;
    const group = match[1] ?? "";
    groups.set(group, [...(groups.get(group) ?? []), token]);
  }

  const violations: string[] = [];
  const fixedNames = new Set(fixed.map((token) => token.name));
  for (const [group, tokens] of groups) {
    if (tokens.length < 2) continue;
    if (tokens.some((token) => fixedNames.has(token.name))) {
      violations.push(`${group}: ramp members must be theme tokens`);
      continue;
    }

    const ordered = tokens.toSorted((a, b) => {
      const aStep = Number(a.name.match(pattern)?.[2] ?? 0);
      const bStep = Number(b.name.match(pattern)?.[2] ?? 0);
      return aStep - bStep;
    });
    const lightness = (value: string | undefined): number =>
      Number(value?.match(/oklch\(([\d.]+)%/)?.[1] ?? Number.NaN);
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined) continue;
      if (
        lightness(previous.light) <= lightness(current.light) ||
        lightness(previous.dark) >= lightness(current.dark)
      ) {
        violations.push(`${group}: light and dark roles must invert`);
        break;
      }
    }
  }
  return violations;
}

function selectorClassNames(source: string): Set<string> {
  const classNames = new Set<string>();
  for (const rule of source.matchAll(/([^{}]+)\{/g)) {
    const prelude = rule[1] ?? "";
    for (const match of prelude.matchAll(/\.([_a-zA-Z0-9-]+)/g)) {
      classNames.add(match[1] ?? "");
    }
  }
  return classNames;
}

function implementationClassNames(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/(?<!-)\b(ds-[a-z0-9]+(?:[-_][a-z0-9]+)*)/g)]
      .map((match) => match[1] ?? ""),
  );
}

function componentOwnedSelectors(
  source: string,
  componentClassNames: ReadonlySet<string>,
): string[] {
  const selectors = new Set<string>();
  for (const rule of source.matchAll(/([^{}]+)\{/g)) {
    const prelude = (rule[1] ?? "").trim();
    for (const match of prelude.matchAll(/\.([_a-zA-Z0-9-]+)/g)) {
      const className = match[1] ?? "";
      if (componentClassNames.has(className)) {
        selectors.add(prelude);
      }
    }
  }
  return [...selectors].sort();
}

function leafDeclarationBlocks(source: string): string[] {
  const starts: number[] = [];
  const blocks: string[] = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "{") starts.push(index + 1);
    if (character !== "}") continue;
    const start = starts.pop();
    if (start === undefined) continue;
    const declarations = source.slice(start, index);
    if (!declarations.includes("{")) blocks.push(declarations);
  }
  return blocks;
}

function dataAttributeCounts(
  source: string,
  attribute: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const pattern = new RegExp(`\\b${attribute}="([^"]+)"`, "g");
  for (const match of source.matchAll(pattern)) {
    const value = match[1] ?? "";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function demoLayoutMarkupViolations(source: string): string[] {
  const violations: string[] = [];
  for (
    const [attribute, requiredClass] of [
      ["data-demo-inset", "demo-visual-inset"],
      ["data-demo-contained-stack", "demo-contained-stack"],
    ] as const
  ) {
    const pattern = new RegExp(
      `<[^>]+\\b${attribute}="([^"]+)"[^>]*>`,
      "g",
    );
    for (const match of source.matchAll(pattern)) {
      const contract = match[1] ?? "";
      const tag = match[0];
      const classes = tag.match(/\bclass="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
      if (!classes.includes(requiredClass)) {
        violations.push(`${contract} must use ${requiredClass}`);
      }
    }
  }

  const arms = dataAttributeCounts(source, "data-demo-fanout-arm");
  const targets = dataAttributeCounts(source, "data-demo-fanout-target");
  for (const contract of new Set([...arms.keys(), ...targets.keys()])) {
    const armCount = arms.get(contract) ?? 0;
    const targetCount = targets.get(contract) ?? 0;
    if (armCount !== targetCount || targetCount === 0) {
      violations.push(
        `${contract} has ${armCount} fanout arms for ${targetCount} targets`,
      );
    }
  }
  return violations;
}

Deno.test("generated public site outputs are ignored and absent from Git", async () => {
  const repoPaths = GENERATED_SITE_OUTPUTS.map((output) =>
    join("site", output)
  );
  const tracked = await git(["ls-files", "--", ...repoPaths]);
  assertEquals(tracked.code, 0);
  assertEquals(
    new TextDecoder().decode(tracked.stdout).trim(),
    "",
    "generated public site outputs must not be tracked",
  );

  for (const path of repoPaths) {
    const ignored = await git(["check-ignore", "--quiet", "--no-index", path]);
    assertEquals(ignored.code, 0, `${path} must be ignored`);
  }
});

Deno.test("design-system sources deterministically reproduce every generated runtime asset", async () => {
  const temp = await Deno.makeTempDir();
  try {
    const summary = await buildDesignSystemRuntime(toFileUrl(`${temp}/`));
    const authoredAssets = (await walk(AUTHORED_ASSET_ROOT)).map((path) =>
      relative(AUTHORED_ASSET_ROOT, path)
    );
    for (
      const relative of ["discern.css", "manifest.json", ...authoredAssets]
    ) {
      assertEquals(
        await sha256(join(temp, relative)),
        await sha256(join(PUBLIC_ROOT, relative)),
        relative,
      );
    }

    const generatedPage = await Deno.readTextFile(
      join(ROOT, "site", "pages", "design-system-demo.html"),
    );
    assertEquals(
      generatedPage,
      await formatGeneratedText(renderDesignSystemDemo(summary), "html"),
    );
    const generatedContentPage = await Deno.readTextFile(
      join(ROOT, "site", "pages", "content-design-demo.html"),
    );
    assertEquals(
      generatedContentPage,
      await formatGeneratedText(renderContentDesignDemo(summary), "html"),
    );
  } finally {
    await Deno.remove(temp, { recursive: true });
  }

  for (
    const [source, output] of [
      ["design-system-demo.css", "demo.css"],
      ["content-design-demo.css", "content-demo.css"],
      ["design-system-demo.js", "demo.js"],
    ] as const
  ) {
    const authored = await Deno.readTextFile(
      join(ROOT, "site", "page-src", source),
    );
    const generated = await Deno.readTextFile(join(PUBLIC_ROOT, output));
    assertEquals(
      generated,
      `/* Generated by site/build.ts from site/page-src/${source}. Do not edit. */\n${authored}`,
      output,
    );
  }
});

Deno.test("every design-system component auto-enrols its implementation surfaces", async () => {
  const files = await walk(COMPONENT_ROOT);
  const fileSet = new Set(files);
  const metaFiles = files.filter((path) => path.endsWith(".meta.ts"));
  assert(metaFiles.length > 0);

  const publicModule = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "src", "mod.ts"),
  );
  const identities = new Set<string>();
  const positions = new Set<string>();
  for (const meta of metaFiles) {
    const stem = meta.slice(0, -".meta.ts".length);
    const directory = stem.slice(0, stem.lastIndexOf("/"));
    const folder = directory.slice(directory.lastIndexOf("/") + 1);
    const metadata = (await import(toFileUrl(meta).href)) as {
      default: ComponentMeta;
    };
    assertEquals(metadata.default.slug, folder, meta);
    assert(metadata.default.name.trim().length > 0, `${meta} has no name`);
    assert(
      metadata.default.description.trim().length > 0,
      `${meta} has no description`,
    );
    assert(
      metadata.default.accessibility?.every((note) => note.trim().length > 0) ??
        true,
      `${meta} has an empty accessibility note`,
    );
    assert(
      !identities.has(metadata.default.slug),
      `${meta} duplicates slug ${metadata.default.slug}`,
    );
    identities.add(metadata.default.slug);
    const position = `${metadata.default.group}:${metadata.default.order}`;
    assert(!positions.has(position), `${meta} duplicates position ${position}`);
    positions.add(position);

    for (
      const sibling of [`${stem}.tsx`, `${stem}.css`, `${stem}.examples.tsx`]
    ) {
      assert(fileSet.has(sibling), `${meta} is missing ${sibling}`);
    }
    assert(fileSet.has(join(directory, "mod.ts")), `${meta} is missing mod.ts`);

    const componentRelative = directory.slice(COMPONENT_ROOT.length + 1);
    assertStringIncludes(
      publicModule,
      `./components/${componentRelative}/mod.ts`,
      `${componentRelative} is missing from src/mod.ts`,
    );
  }

  for (const path of files.filter((file) => /\.(?:css|tsx?|js)$/.test(file))) {
    const source = await Deno.readTextFile(path);
    assert(!/https?:\/\//.test(source), `${path} contains a remote asset URL`);
  }
});

Deno.test("every marketing block is represented in the demo", async () => {
  const metaFiles = (await walk(COMPONENT_ROOT)).filter((path) =>
    path.endsWith(".meta.ts")
  );
  const marketing: ComponentMeta[] = [];
  for (const path of metaFiles) {
    const module = (await import(toFileUrl(path).href)) as {
      default: ComponentMeta;
    };
    if (module.default.group === "Marketing") marketing.push(module.default);
  }

  assert(
    marketing.length >= 12,
    `expected a comprehensive marketing library, found ${marketing.length} blocks`,
  );
  const html = renderDesignSystemDemo({
    components: metaFiles.length,
    tokens: designTokens.length + themeTokens.length,
  });
  for (const meta of marketing) {
    assertMatch(
      html,
      new RegExp(`class="[^"]*\\bds-${meta.slug}\\b`),
      `${meta.name} is not represented in the demo`,
    );
    assert(
      (meta.accessibility?.length ?? 0) > 0,
      `${meta.name} has no accessibility contract`,
    );
  }

  assertEquals([...html.matchAll(/<h1(?:\s|>)/g)].length, 1);
  assertStringIncludes(html, "<table");
  assertStringIncludes(html, "<details");

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)]
    .map((match) => match[1] ?? "");
  assertEquals(new Set(ids).size, ids.length, "demo ids must be unique");
  for (
    const fragment of [...html.matchAll(/href="(#[^"]+)"/g)]
      .map((match) => (match[1] ?? "").slice(1))
  ) {
    assert(
      ids.includes(fragment),
      `demo fragment #${fragment} has no matching id`,
    );
  }
});

Deno.test("every editorial block is represented in the content demo", async () => {
  const metaFiles = (await walk(COMPONENT_ROOT)).filter((path) =>
    path.endsWith(".meta.ts")
  );
  const editorial: ComponentMeta[] = [];
  for (const path of metaFiles) {
    const module = (await import(toFileUrl(path).href)) as {
      default: ComponentMeta;
    };
    if (module.default.group === "Editorial") editorial.push(module.default);
  }

  assertEquals(
    editorial.length,
    12,
    "the editorial set should stay comprehensive",
  );
  const html = renderContentDesignDemo({
    components: metaFiles.length,
    tokens: designTokens.length + themeTokens.length,
  });
  for (const meta of editorial) {
    assertMatch(
      html,
      new RegExp(`class="[^"]*\\bds-${meta.slug}\\b`),
      `${meta.name} is not represented in the content demo`,
    );
    assert(
      (meta.accessibility?.length ?? 0) > 0,
      `${meta.name} has no accessibility contract`,
    );
  }

  assertEquals([...html.matchAll(/<h1(?:\s|>)/g)].length, 1);
  for (
    const semantic of [
      "<article",
      "<nav",
      "<figure",
      "<blockquote",
      "<pre",
      "<ol",
    ]
  ) {
    assertStringIncludes(html, semantic);
  }

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)]
    .map((match) => match[1] ?? "");
  assertEquals(
    new Set(ids).size,
    ids.length,
    "content demo ids must be unique",
  );
  for (
    const fragment of [...html.matchAll(/href="(#[^"]+)"/g)]
      .map((match) => (match[1] ?? "").slice(1))
  ) {
    assert(
      ids.includes(fragment),
      `content demo fragment #${fragment} has no matching id`,
    );
  }
});

Deno.test("demo artwork geometry contracts auto-enrol every annotated visual", async () => {
  const componentCount =
    (await walk(COMPONENT_ROOT)).filter((path) => path.endsWith(".meta.ts"))
      .length;
  const html = renderDesignSystemDemo({
    components: componentCount,
    tokens: designTokens.length + themeTokens.length,
  });
  const css = await Deno.readTextFile(
    join(ROOT, "site", "page-src", "design-system-demo.css"),
  );

  const cssViolations = [
    [
      "uniform insets",
      /\.demo-visual-inset\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*min\([^}]*margin:\s*var\(--ds-space-4\) auto;/s,
    ],
    [
      "contained stacks",
      /\.demo-contained-stack\s*>\s*\*\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0 0 auto;[^}]*translate:\s*0 var\(--demo-stack-offset/s,
    ],
    [
      "fanout grids",
      /\.demo-guidance__line,\s*\.demo-guidance__agents\s*\{[^}]*grid-template-columns:\s*var\(--demo-fanout-grid\);[^}]*gap:\s*var\(--demo-fanout-gap\);/s,
    ],
  ].filter(([, pattern]) => !(pattern as RegExp).test(css)).map(([label]) =>
    String(label)
  );
  assertEquals(
    [...demoLayoutMarkupViolations(html), ...cssViolations],
    [],
  );

  assertEquals(
    demoLayoutMarkupViolations(`
      <div data-demo-inset="fresh-art"></div>
      <div data-demo-contained-stack="unrelated-stack"></div>
      <i data-demo-fanout-arm="new-tree"></i>
      <i data-demo-fanout-target="new-tree"></i>
      <i data-demo-fanout-target="new-tree"></i>
    `),
    [
      "fresh-art must use demo-visual-inset",
      "unrelated-stack must use demo-contained-stack",
      "new-tree has 1 fanout arms for 2 targets",
    ],
  );
});

Deno.test("authored design-system runtime sources are local-only", async () => {
  const designSystemRoot = join(ROOT, "site", "design-system");
  for (
    const path of (await walk(designSystemRoot)).filter((candidate) => {
      const repoPath = relative(designSystemRoot, candidate);
      return /\.(?:css|html|tsx?|js)$/.test(candidate) &&
        !repoPath.startsWith("dist/") &&
        !repoPath.startsWith("styleguide/generated/");
    })
  ) {
    assert(
      !/https?:\/\//.test(await Deno.readTextFile(path)),
      `${relative(ROOT, path)} contains a remote runtime URL`,
    );
  }
});

Deno.test("consumer styles never redefine component-owned selectors", async () => {
  const futureComponentCss = ".ds-future-widget__label { color: inherit; }";
  const futureComponentTsx = '<div className="ds-future-widget" />';
  const futureComponentClasses = new Set([
    ...selectorClassNames(futureComponentCss),
    ...implementationClassNames(futureComponentTsx),
  ]);
  assertEquals(
    componentOwnedSelectors(
      ".ds-future-widget, .ds-future-widget__label { color: red; }",
      futureComponentClasses,
    ),
    [".ds-future-widget, .ds-future-widget__label"],
  );

  const componentClassNames = new Set<string>();
  for (
    const path of (await walk(COMPONENT_ROOT)).filter((candidate) =>
      candidate.endsWith(".css")
    )
  ) {
    for (const className of selectorClassNames(await Deno.readTextFile(path))) {
      componentClassNames.add(className);
    }
  }
  for (
    const path of (await walk(COMPONENT_ROOT)).filter((candidate) =>
      candidate.endsWith(".tsx") && !candidate.endsWith(".examples.tsx")
    )
  ) {
    for (
      const className of implementationClassNames(await Deno.readTextFile(path))
    ) {
      componentClassNames.add(className);
    }
  }

  const violations: string[] = [];
  for (
    const path of (await walk(join(ROOT, "site"))).filter((candidate) => {
      const repoPath = relative(ROOT, candidate);
      return candidate.endsWith(".css") &&
        !repoPath.startsWith("site/design-system/src/") &&
        !repoPath.startsWith("site/design-system/dist/") &&
        !repoPath.startsWith("site/design-system/styleguide/generated/") &&
        !repoPath.startsWith("site/pages/");
    })
  ) {
    for (
      const selector of componentOwnedSelectors(
        await Deno.readTextFile(path),
        componentClassNames,
      )
    ) {
      violations.push(`${relative(ROOT, path)}: ${selector}`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("theme-aware design-system surfaces never mix semantic and fixed palette backgrounds", async () => {
  const futureSibling = `.unrelated-aurora {
    background: linear-gradient(
      var(--ds-color-static-glow),
      var(--ds-color-surface-sunken)
    );
  }`;
  assertEquals(
    themeIncoherentBackgrounds(
      futureSibling,
      new Set(["--ds-color-static-glow"]),
    ),
    [".unrelated-aurora"],
  );

  const violations: string[] = [];
  const fixedColorNames = new Set(
    designTokens.filter((token) => token.category === "Color")
      .map((token) => token.name),
  );
  for (
    const path of (await walk(join(ROOT, "site", "design-system", "src")))
      .filter((file) => file.endsWith(".css"))
  ) {
    for (
      const selector of themeIncoherentBackgrounds(
        await Deno.readTextFile(path),
        fixedColorNames,
      )
    ) {
      violations.push(`${path.slice(ROOT.length)}: ${selector}`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("numbered colour ramps preserve their roles across themes", () => {
  assertEquals(
    roleRampViolations(
      [
        { name: "--ds-color-orbit-100", value: "oklch(90% 0.1 250)" },
        { name: "--ds-color-orbit-200", value: "oklch(70% 0.1 250)" },
      ],
      [],
    ),
    ["orbit: ramp members must be theme tokens"],
  );
  assertEquals(roleRampViolations(designTokens, themeTokens), []);
});

Deno.test("typography roles use the selected families and UI buttons", async () => {
  const tokens = new Map(
    designTokens.map((token) => [token.name, token.value]),
  );
  const interStack = '"Inter", "Helvetica Neue", system-ui, sans-serif';
  assertEquals(
    tokens.get("--ds-font-display"),
    '"Crimson Pro", "Iowan Old Style", Georgia, serif',
  );
  assertEquals(tokens.get("--ds-font-body"), interStack);
  assertEquals(tokens.get("--ds-font-ui"), interStack);
  assertEquals(
    tokens.get("--ds-font-features-ui"),
    "'liga' 1, 'calt' 1, 'dlig' 1, 'tnum' 1, 'zero' 1, 'ss03' 1, 'salt' 1",
  );
  assertEquals(tokens.get("--ds-font-size-xs"), "0.85rem");
  assertEquals(tokens.get("--ds-font-size-sm"), "0.95rem");
  assertEquals(tokens.get("--ds-font-size-md"), "1.05rem");
  assertEquals(tokens.get("--ds-leading-tight"), "1.08");
  assertEquals(tokens.get("--ds-leading-snug"), "1.3");
  assertEquals(tokens.get("--ds-leading-body"), "1.58");
  assertEquals(
    tokens.get("--ds-font-mono"),
    '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  );
  assertEquals(
    tokens.get("--ds-font-size-card-title"),
    "var(--ds-font-size-lg)",
  );

  const buttonCss = await Deno.readTextFile(
    join(COMPONENT_ROOT, "core", "button", "button.css"),
  );
  assertStringIncludes(buttonCss, "font-family: var(--ds-font-ui)");
  assert(!buttonCss.includes("font-family: var(--ds-font-display)"));
  assertStringIncludes(
    buttonCss,
    "--ds-button-fill: var(--ds-color-accent-100)",
  );
  assertStringIncludes(
    buttonCss,
    "box-shadow: 2px 2px 0 var(--ds-button-shadow)",
  );

  const foundationCss = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "src", "styles", "foundation.css"),
  );
  assertMatch(
    foundationCss,
    /:where\(\[data-ds-root\] h1,[^}]+text-wrap:\s*pretty;/s,
  );
  const headingCss = await Deno.readTextFile(
    join(COMPONENT_ROOT, "display", "heading", "heading.css"),
  );
  assert(!headingCss.includes("text-wrap"));
});

Deno.test("display chrome uses its intended typography and rule treatment", async () => {
  const windowCss = await Deno.readTextFile(
    join(COMPONENT_ROOT, "display", "window", "window.css"),
  );
  const titleRule = windowCss.match(/\.ds-window__title\s*\{[^}]+\}/s)?.[0] ??
    "";
  assertStringIncludes(titleRule, "font-family: var(--ds-font-ui)");
  assertStringIncludes(
    titleRule,
    "font-feature-settings: var(--ds-font-features-ui)",
  );
  assert(!titleRule.includes("var(--ds-font-mono)"));

  const dividerCss = await Deno.readTextFile(
    join(COMPONENT_ROOT, "display", "divider", "divider.css"),
  );
  assert(!dividerCss.includes("repeating-linear-gradient"));
  assertMatch(dividerCss, /\.ds-divider::before,[^}]+\.ds-divider::after/s);
  assertMatch(
    dividerCss,
    /\.ds-divider__label::before\s*\{[^}]+transform:\s*rotate\(45deg\);/s,
  );
});

Deno.test("the light sunken surface stays pale and low-chroma", () => {
  const sunken = themeTokens.find((token) =>
    token.name === "--ds-color-surface-sunken"
  );
  assertEquals(
    sunken?.light,
    "oklch(96.5% 0.004 var(--ds-canvas-hue))",
  );
});

Deno.test("terminal renders semantic, scrollable monospace output", async () => {
  const html = renderToStaticMarkup(
    createElement(Terminal, {
      title: "verify",
      children: "$ deno task verify",
    }),
  );
  assertStringIncludes(html, '<figure class="ds-terminal">');
  assertStringIncludes(html, '<span class="ds-terminal__title">verify</span>');
  assertStringIncludes(
    html,
    '<pre class="ds-terminal__body"><code>$ deno task verify</code></pre>',
  );

  const css = await Deno.readTextFile(
    join(COMPONENT_ROOT, "display", "terminal", "terminal.css"),
  );
  const bodyRule = css.match(/\.ds-terminal__body\s*\{[^}]+\}/s)?.[0] ?? "";
  assertStringIncludes(bodyRule, "overflow: auto");
  assertStringIncludes(bodyRule, "font-family: var(--ds-font-mono)");
  assertStringIncludes(bodyRule, "white-space: pre");
});

Deno.test("kicker isolates its monospace index from UI text", async () => {
  const html = renderToStaticMarkup(
    createElement(Kicker, { index: 0, children: "Lorem ipsum" }),
  );
  assertStringIncludes(
    html,
    '<span class="ds-kicker__index">0</span><span class="ds-kicker__text">Lorem ipsum</span>',
  );

  const css = await Deno.readTextFile(
    join(COMPONENT_ROOT, "display", "kicker", "kicker.css"),
  );
  const rootRule = css.match(/\.ds-kicker\s*\{[^}]+\}/s)?.[0] ?? "";
  assertStringIncludes(rootRule, "font-size: 0.625rem");
  assert(!rootRule.includes("var(--ds-font-mono)"));
  assertMatch(
    css,
    /\.ds-kicker__index\s*\{[^}]+font-family:\s*var\(--ds-font-mono\);/s,
  );
  assertMatch(
    css,
    /\.ds-kicker__text\s*\{[^}]+font-family:\s*var\(--ds-font-ui\);[^}]+font-feature-settings:\s*var\(--ds-font-features-ui\);/s,
  );
});

Deno.test("every authored UI font rule enables the shared Inter features", async () => {
  const tracked = await git(["ls-files", "--", "site"]);
  assertEquals(tracked.code, 0);
  const cssFiles = new TextDecoder().decode(tracked.stdout).trim().split("\n")
    .filter((path) => path.endsWith(".css"));
  const violations: string[] = [];
  for (const path of cssFiles) {
    const source = await Deno.readTextFile(join(ROOT, path));
    for (const declarations of leafDeclarationBlocks(source)) {
      if (
        declarations.includes("var(--ds-font-ui)") &&
        !declarations.includes(
          "font-feature-settings: var(--ds-font-features-ui);",
        )
      ) {
        violations.push(path);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("component labels and compact UI use the UI font", async () => {
  for (
    const component of [
      ["display", "badge", "badge.css"],
      ["display", "tag", "tag.css"],
      ["display", "divider", "divider.css"],
      ["forms", "field", "field.css"],
      ["feedback", "tooltip", "tooltip.css"],
    ]
  ) {
    const css = await Deno.readTextFile(join(COMPONENT_ROOT, ...component));
    assertStringIncludes(css, "var(--ds-font-ui)", component.join("/"));
    assertStringIncludes(css, "var(--ds-font-size-xs)", component.join("/"));
    assert(!css.includes("var(--ds-font-mono)"), component.join("/"));
    assert(!css.includes("letter-spacing"), component.join("/"));
    assert(!css.includes("text-transform: uppercase"), component.join("/"));
  }
});

Deno.test("card titles and marketing figures use the UI font", async () => {
  const cardCss = await Deno.readTextFile(
    join(COMPONENT_ROOT, "display", "card", "card.css"),
  );
  assertMatch(
    cardCss,
    /\.ds-card :where\([^}]+font-family:\s*var\(--ds-font-ui\);/s,
  );
  assertMatch(
    cardCss,
    /\.ds-card :where\([^}]+font-size:\s*var\(--ds-font-size-card-title\);[^}]+font-weight:\s*600;/s,
  );

  const bentoCss = await Deno.readTextFile(
    join(
      COMPONENT_ROOT,
      "marketing",
      "feature-bento",
      "feature-bento.css",
    ),
  );
  assertMatch(
    bentoCss,
    /\.ds-feature-bento__item h3\s*\{[^}]+font-family:\s*var\(--ds-font-ui\);/s,
  );

  const metricsCss = await Deno.readTextFile(
    join(
      COMPONENT_ROOT,
      "marketing",
      "metrics-band",
      "metrics-band.css",
    ),
  );
  assertMatch(
    metricsCss,
    /\.ds-metrics-band__list dd\s*\{[^}]+font-family:\s*var\(--ds-font-ui\);/s,
  );

  const styleguideCss = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "styleguide", "styleguide.css"),
  );
  assertStringIncludes(styleguideCss, ".sg-component > header h4");
  assert(!styleguideCss.includes(".sg-component h4"));
});

Deno.test("long styleguide token values stay inside their cards", async () => {
  const css = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "styleguide", "styleguide.css"),
  );
  assertMatch(css, /\.sg-token > div\s*\{[^}]*min-width:\s*0;/s);
  assertMatch(css, /\.sg-token small\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
});

Deno.test("the one grain wash retains the reference motif", async () => {
  const css = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "src", "styles", "utilities.css"),
  );
  assertStringIncludes(css, "radial-gradient(110% 72% at 50% -8%");
  assertStringIncludes(css, "var(--ds-color-accent-300) 85%, transparent");
  assertStringIncludes(css, "var(--ds-color-accent-200) 90%");
  assertStringIncludes(css, "var(--ds-color-canvas) 82%");
  assertMatch(css, /background-size:\s*200px 200px/);
  assertMatch(css, /mix-blend-mode:\s*overlay/);
  assertMatch(css, /opacity:\s*0\.38/);
});

Deno.test("runtime assets exclude navigation and auto-enrol new asset tags", () => {
  const remoteOrigin = ["https:", "", "example.invalid"].join("/");
  const html = `
    <a href="${remoteOrigin}/elsewhere">Elsewhere</a>
    <link rel="canonical" href="${remoteOrigin}/canonical">
    <video poster="/poster.webp" src="/film.webm"></video>
    <source srcset="/small.webp 1x, /large.webp 2x">
    <object data="/diagram.svg"></object>
    <link href="/theme.css" rel="preload stylesheet">
  `;

  assertEquals(runtimeAssetReferences(html), [
    "/poster.webp",
    "/film.webm",
    "/small.webp",
    "/large.webp",
    "/diagram.svg",
    "/theme.css",
  ]);
});

Deno.test("the public demos ship static HTML and local runtime assets only", async () => {
  for (
    const [page, marker] of [
      [
        "design-system-demo.html",
        "typed React at build time · static HTML at runtime",
      ],
      ["content-design-demo.html", "editorial engineering · static by design"],
    ] as const
  ) {
    const html = await Deno.readTextFile(join(ROOT, "site", "pages", page));
    assertStringIncludes(html, "data-ds-root");
    assertStringIncludes(html, marker);

    const runtimeRefs = runtimeAssetReferences(html);
    assert(
      runtimeRefs.every((value) => value.startsWith("/")),
      `${page} remote runtime references: ${runtimeRefs.join(", ")}`,
    );
    assertEquals(
      runtimeRefs.filter((value) => value.endsWith(".js")),
      ["/assets/design-system/demo.js"],
    );
  }

  for (
    const asset of ["discern.css", "demo.css", "content-demo.css", "fonts.css"]
  ) {
    const css = await Deno.readTextFile(join(PUBLIC_ROOT, asset));
    assert(!/https?:\/\//.test(css), `${asset} contains a remote URL`);
  }

  const manifest = JSON.parse(
    await Deno.readTextFile(join(PUBLIC_ROOT, "manifest.json")),
  ) as Record<string, unknown>;
  assertEquals("generatedAt" in manifest, false);
});

Deno.test("self-hosted font binaries carry their open-font licences", async () => {
  for (const source of await walk(AUTHORED_ASSET_ROOT)) {
    const asset = relative(AUTHORED_ASSET_ROOT, source);
    assertEquals(
      await sha256(source),
      await sha256(join(PUBLIC_ROOT, asset)),
      `${asset} must be copied from the authored asset tree`,
    );
  }

  const fontRoot = join(PUBLIC_ROOT, "fonts");
  const fonts = await walk(fontRoot);
  assertEquals(
    fonts.map((font) => relative(fontRoot, font)).toSorted(),
    [
      "crimson-pro-italic.woff2",
      "crimson-pro-roman.woff2",
      "inter.woff2",
      "jetbrains-mono.woff2",
    ],
  );
  for (const font of fonts) {
    const bytes = await Deno.readFile(font);
    assertEquals(new TextDecoder().decode(bytes.slice(0, 4)), "wOF2", font);
  }

  const licenceRoot = join(PUBLIC_ROOT, "licenses");
  const licences = await walk(licenceRoot);
  assertEquals(
    licences.map((licence) => relative(licenceRoot, licence)).toSorted(),
    [
      "Crimson-Pro-OFL.txt",
      "Inter-OFL.txt",
      "JetBrains-Mono-OFL.txt",
    ],
  );
  for (const licence of licences) {
    assertStringIncludes(
      await Deno.readTextFile(licence),
      "SIL OPEN FONT LICENSE",
    );
  }

  const provider = await Deno.readTextFile(
    join(AUTHORED_ASSET_ROOT, "fonts.css"),
  );
  assert(!/https?:\/\//.test(provider));
  assert(!provider.includes("IBM Plex Sans"));
  const styleguide = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "styleguide", "index.html"),
  );
  assertStringIncludes(styleguide, 'href="assets/fonts.css"');
  assert(!styleguide.includes("font-provider.css"));
});
