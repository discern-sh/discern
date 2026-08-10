/** Contracts for the development-only bifurcation benefit-art study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  BIFURCATION_TERMINALS,
  BIFURCATION_TOPOLOGY,
} from "../site/page-src/benefit-art-bifurcation.tsx";
import { renderBifurcationSpecimen } from "../site/page-src/benefit-art-bifurcation-preview.tsx";
import {
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";

const BIFURCATION_CSS = new URL(
  "../site/page-src/benefit-art-bifurcation.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Return selectors whose declarations opt into the monospace token. */
function monoSelectors(css: string): string[] {
  const selectors: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    const declarations = match[2];
    if (
      selector === undefined || declarations === undefined ||
      !declarations.includes("var(--discern-font-mono)")
    ) continue;
    selectors.push(selector.trim().replace(/\s+/g, " "));
  }
  return selectors;
}

interface RegisteredBifurcationNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

interface RegisteredBifurcationTopology {
  readonly levels: readonly {
    readonly depth: number;
    readonly nodes: readonly RegisteredBifurcationNode[];
  }[];
}

interface CssRule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

/** Parse the flat declaration bodies used by this focused stylesheet. */
function declarations(source: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
    const property = match[1];
    const value = match[2];
    if (property !== undefined && value !== undefined) {
      result.set(property, value.trim());
    }
  }
  return result;
}

/** Enumerate ordinary rules and keyframe steps without naming their classes. */
function cssRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorList = match[1];
    const body = match[2];
    if (selectorList === undefined || body === undefined) continue;
    rules.push({
      selectors: selectorList.split(",").map((selector) =>
        selector.trim().replace(/\s+/g, " ")
      ),
      declarations: declarations(body),
    });
  }
  return rules;
}

/** Return one balanced CSS block, including nested keyframe steps. */
function cssBlock(source: string, header: string): string | undefined {
  const headerStart = source.indexOf(header);
  if (headerStart < 0) return undefined;
  const opening = source.indexOf("{", headerStart + header.length);
  if (opening < 0) return undefined;
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(opening + 1, index);
  }
  return undefined;
}

/** Read one declaration from the first exact selector that owns it. */
function styleValue(
  source: string,
  selector: string,
  property: string,
): string | undefined {
  return cssRules(source).find((rule) =>
    rule.selectors.includes(selector) && rule.declarations.has(property)
  )?.declarations.get(property);
}

/** Read one percentage step from a named animation. */
function keyframeStep(
  source: string,
  name: string,
  percentage: number,
): ReadonlyMap<string, string> | undefined {
  const body = cssBlock(source, `@keyframes ${name}`);
  if (body === undefined) return undefined;
  return cssRules(body).find((rule) =>
    rule.selectors.includes(`${percentage}%`)
  )?.declarations;
}

/** List every declaration step in one named animation. */
function keyframeRules(source: string, name: string): CssRule[] {
  const body = cssBlock(source, `@keyframes ${name}`);
  return body === undefined ? [] : cssRules(body);
}

/** Detect incomplete or canvas-occluded settled branches by registry member. */
function branchCulminationIssues(
  topology: RegisteredBifurcationTopology,
  root: ParentNode,
  css: string,
): string[] {
  const rules = cssRules(css);
  const canvasStrokeSelectors = rules.filter((rule) =>
    rule.declarations.get("stroke")?.includes("--discern-color-canvas") ??
      false
  ).flatMap((rule) => rule.selectors);
  const staticDash = styleValue(
    css,
    ".bifurcation-art__branch",
    "stroke-dasharray",
  );
  const issues: string[] = [];

  for (const level of topology.levels) {
    const levelSelector =
      `.bifurcation-art__level[data-bifurcation-level="${level.depth}"] .bifurcation-art__branch`;
    const animationName = styleValue(css, levelSelector, "animation-name");
    for (const node of level.nodes) {
      const reasons: string[] = [];
      const matches = root.querySelectorAll(
        `[data-bifurcation-branch="${node.id}"]`,
      );
      if (matches.length !== 1) {
        reasons.push(`renders ${matches.length} enrolled paths`);
      }
      const branch = matches.item(0);
      if (branch !== null) {
        if (branch.tagName.toLowerCase() !== "path") {
          reasons.push("is not path geometry");
        }
        if (branch.getAttribute("pathLength") !== "1") {
          reasons.push("does not normalize its draw path");
        }
        const shape = branch.getAttribute("d");
        if (shape === null) {
          reasons.push("has no path geometry");
        } else {
          const duplicates = [...root.querySelectorAll("path[d]")].filter(
            (candidate) =>
              candidate.closest("defs") === null &&
              candidate.getAttribute("d") === shape,
          );
          if (duplicates.length !== 1) {
            reasons.push(`has ${duplicates.length} copies of its geometry`);
          }
          if (
            duplicates.some((candidate) =>
              canvasStrokeSelectors.some((selector) =>
                candidate.matches(selector)
              )
            )
          ) {
            reasons.push("has a canvas-coloured stroke copy");
          }
        }
      }
      if (staticDash !== "none") {
        reasons.push(`rests with stroke-dasharray ${staticDash ?? "unset"}`);
      }
      if (animationName === undefined) {
        reasons.push("has no level animation");
      } else {
        for (const percentage of [75, 93]) {
          const step = keyframeStep(css, animationName, percentage);
          if (step === undefined) {
            reasons.push(`has no ${percentage}% culmination step`);
            continue;
          }
          if (step.get("stroke-dasharray") !== "none") {
            reasons.push(`${percentage}% is still dashed`);
          }
          if (step.get("stroke-dashoffset") !== "0") {
            reasons.push(`${percentage}% keeps a dash offset`);
          }
          const opacity = Number(step.get("opacity"));
          if (!(opacity > 0)) reasons.push(`${percentage}% is not visible`);
        }
      }
      if (reasons.length > 0) issues.push(`${node.id}: ${reasons.join("; ")}`);
    }
  }
  return issues;
}

/** Detect terminal motion that can alter a registry endpoint. */
function terminalMotionIssues(
  topology: RegisteredBifurcationTopology,
  root: ParentNode,
  css: string,
): string[] {
  const terminalLevel = topology.levels.at(-1);
  assert(terminalLevel !== undefined);
  const animationName = styleValue(
    css,
    ".bifurcation-art__terminal-cap",
    "animation-name",
  );
  const transformOrigin = styleValue(
    css,
    ".bifurcation-art__terminal-cap",
    "transform-origin",
  );
  const transformBox = styleValue(
    css,
    ".bifurcation-art__terminal-cap",
    "transform-box",
  );
  const motionRules = animationName === undefined
    ? []
    : keyframeRules(css, animationName);
  const issues: string[] = [];

  for (const terminal of terminalLevel.nodes) {
    const reasons: string[] = [];
    const anchors = root.querySelectorAll(
      `[data-bifurcation-terminal="${terminal.id}"]`,
    );
    if (anchors.length !== 1) {
      reasons.push(`renders ${anchors.length} endpoint anchors`);
    }
    const anchor = anchors.item(0);
    if (anchor !== null) {
      if (
        anchor.getAttribute("transform") !==
          `translate(${terminal.x} ${terminal.y})`
      ) {
        reasons.push("is not statically translated to its registry endpoint");
      }
      if (anchor.hasAttribute("data-bifurcation-motion")) {
        reasons.push("animates its endpoint anchor");
      }
      const motions = anchor.querySelectorAll("[data-bifurcation-cap-motion]");
      if (motions.length !== 1) {
        reasons.push(`renders ${motions.length} local motion groups`);
      }
      const motion = motions.item(0);
      if (motion !== null) {
        if (!motion.hasAttribute("data-bifurcation-motion")) {
          reasons.push("does not enrol its local motion group");
        }
        const use = motion.querySelector("use");
        const x = Number(use?.getAttribute("x"));
        const y = Number(use?.getAttribute("y"));
        const width = Number(use?.getAttribute("width"));
        const height = Number(use?.getAttribute("height"));
        if (
          use === null || x + width / 2 !== 0 || y + height / 2 !== 0
        ) {
          reasons.push("does not bound its glyph around local origin 0 0");
        }
      }
    }
    if (animationName === undefined || motionRules.length === 0) {
      reasons.push("has no cap animation");
    } else {
      for (const rule of motionRules) {
        for (const property of rule.declarations.keys()) {
          if (property !== "opacity" && property !== "transform") {
            reasons.push(`animates ${property}`);
          }
        }
        const transform = rule.declarations.get("transform");
        if (transform !== undefined && !/^scale\([0-9.]+\)$/.test(transform)) {
          reasons.push(`moves with ${transform}`);
        }
      }
      for (const percentage of [78, 93]) {
        const step = keyframeStep(css, animationName, percentage);
        if (
          step?.get("transform") !== "scale(1)" ||
          !(Number(step.get("opacity")) > 0)
        ) {
          reasons.push(`${percentage}% is not a complete local cap`);
        }
      }
    }
    if (transformOrigin !== "0 0" || transformBox !== "view-box") {
      reasons.push("does not scale around its endpoint-local origin");
    }
    if (reasons.length > 0) {
      issues.push(`${terminal.id}: ${[...new Set(reasons)].join("; ")}`);
    }
  }
  return issues;
}

/** Assert that every parent in one level has exactly two children in the next. */
function assertBinaryTopology(): void {
  let parentIds = new Set<string>([BIFURCATION_TOPOLOGY.root.id]);
  for (const level of BIFURCATION_TOPOLOGY.levels) {
    const childCounts = new Map<string, number>(
      [...parentIds].map((id) => [id, 0]),
    );
    for (const node of level.nodes) {
      assert(
        parentIds.has(node.parent),
        `${node.id} must branch from the preceding level`,
      );
      childCounts.set(node.parent, (childCounts.get(node.parent) ?? 0) + 1);
    }
    assertEquals(
      [...childCounts.values()],
      [...parentIds].map(() => 2),
      `every parent before level ${level.depth} must bifurcate`,
    );
    parentIds = new Set<string>(level.nodes.map((node) => node.id));
  }
}

Deno.test("the benefit-art study remains outside the public route registry", async () => {
  assertEquals(Object.hasOwn(PAGES, "/specimens"), false);
  const publicResponse = await handler(
    new Request("https://discern.sh/specimens"),
  );
  assertEquals(publicResponse.status, 404);
  await publicResponse.body?.cancel();

  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  assertEquals(
    config.tasks?.["site:specimens"],
    "deno run --allow-read --allow-run --allow-net=127.0.0.1 --allow-env=NODE_ENV,PORT,DISCERN_PROJECT_SLUG,DISCERN_WORKTREE_BRANCH_PREFIX,DISCERN_WORKTREE_ID,GIT_BIN site/specimens.ts",
  );
});

Deno.test("the development handler serves the focused study and live CSS", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  assertEquals(root.status, 200);
  assertStringIncludes(root.headers.get("content-type") ?? "", "text/html");
  assertEquals(root.headers.get("cache-control"), "no-store");
  assertEquals(root.headers.get("x-robots-tag"), "noindex, nofollow");
  assertStringIncludes(await root.text(), "Multiply your output.");

  const stylesheet = await specimenHandler(
    new Request(`http://localhost${SPECIMEN_STYLESHEET_PATH}`),
  );
  assertEquals(stylesheet.status, 200);
  assertStringIncludes(
    stylesheet.headers.get("content-type") ?? "",
    "text/css",
  );
  assertEquals(stylesheet.headers.get("cache-control"), "no-store");
  assertStringIncludes(await stylesheet.text(), ".bifurcation-art");

  for (const path of ["/", SPECIMEN_STYLESHEET_PATH]) {
    const rejected = await specimenHandler(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    assertEquals(rejected.status, 405, path);
    assertEquals(rejected.headers.get("allow"), "GET, HEAD", path);
    await rejected.body?.cancel();
  }
});

Deno.test("the topology doubles through three declared levels", () => {
  assertEquals(
    BIFURCATION_TOPOLOGY.levels.map((level) => level.nodes.length),
    [2, 4, 8],
  );
  assertBinaryTopology();
  const lastLevel = BIFURCATION_TOPOLOGY.levels.at(-1);
  assert(lastLevel !== undefined);
  assertEquals(BIFURCATION_TERMINALS, lastLevel.nodes);
});

Deno.test("every registered branch culminates as one complete unoccluded stroke", async () => {
  const dom = new JSDOM(renderBifurcationSpecimen());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  for (
    const theme of dom.window.document.querySelectorAll(
      ".benefit-art-preview__theme",
    )
  ) {
    const issues = branchCulminationIssues(
      BIFURCATION_TOPOLOGY,
      theme,
      css,
    );
    assertEquals(issues, [], issues.join("\n"));
  }
  dom.window.close();
});

Deno.test("every registered terminal scales only inside its static endpoint anchor", async () => {
  const dom = new JSDOM(renderBifurcationSpecimen());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  for (
    const theme of dom.window.document.querySelectorAll(
      ".benefit-art-preview__theme",
    )
  ) {
    const issues = terminalMotionIssues(
      BIFURCATION_TOPOLOGY,
      theme,
      css,
    );
    assertEquals(issues, [], issues.join("\n"));
  }
  dom.window.close();
});

Deno.test("culmination detectors automatically reject renamed future registry members", () => {
  const futureTopology = {
    levels: [{
      depth: 9,
      nodes: [{ id: "later-limb", x: 650, y: 120 }],
    }],
  } as const;
  const dom = new JSDOM(`
    <article class="benefit-art-preview__theme">
      <svg>
        <g class="bifurcation-art__level" data-bifurcation-level="9">
          <path class="bifurcation-art__branch"
            data-bifurcation-branch="later-limb" pathLength="1"
            d="M 0 0 L 10 0"></path>
          <path class="later-wash" d="M 0 0 L 10 0"></path>
        </g>
        <g data-bifurcation-terminal="later-limb"
          transform="translate(650 120)">
          <g class="bifurcation-art__terminal-cap"
            data-bifurcation-cap-motion data-bifurcation-motion>
            <use x="640" y="110" width="20" height="20"></use>
          </g>
        </g>
      </svg>
    </article>
  `);
  const unsafeCss = `
    .bifurcation-art__branch { stroke-dasharray: none; }
    .bifurcation-art__level[data-bifurcation-level="9"]
      .bifurcation-art__branch { animation-name: later-branch; }
    .later-wash { stroke: var(--discern-color-canvas); }
    .bifurcation-art__terminal-cap {
      animation-name: later-cap;
      transform-box: view-box;
      transform-origin: 0 0;
    }
    @keyframes later-branch {
      75%, 93% {
        opacity: 1;
        stroke-dasharray: 1;
        stroke-dashoffset: 0;
      }
    }
    @keyframes later-cap {
      0% { opacity: 0; transform: translateX(-4px) scale(0.7); }
      78%, 93% { opacity: 1; transform: scale(1); }
    }
  `;
  const root = dom.window.document.querySelector(
    ".benefit-art-preview__theme",
  );
  assert(root !== null);

  const branchIssues = branchCulminationIssues(
    futureTopology,
    root,
    unsafeCss,
  );
  assertEquals(branchIssues.length, 1);
  assertStringIncludes(branchIssues[0] ?? "", "later-limb");
  assertStringIncludes(branchIssues[0] ?? "", "canvas-coloured stroke copy");
  assertStringIncludes(branchIssues[0] ?? "", "still dashed");

  const capIssues = terminalMotionIssues(futureTopology, root, unsafeCss);
  assertEquals(capIssues.length, 1);
  assertStringIncludes(capIssues[0] ?? "", "later-limb");
  assertStringIncludes(capIssues[0] ?? "", "local origin 0 0");
  assertStringIncludes(capIssues[0] ?? "", "translateX(-4px)");
  dom.window.close();
});

Deno.test("one bifurcation study renders in both fixed themes", () => {
  const html = renderBifurcationSpecimen();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(
    document.querySelectorAll(".benefit-art-preview__theme").length,
    2,
  );
  assertEquals(
    document.querySelectorAll(
      '.benefit-art-preview__theme[data-discern-theme="light"]',
    ).length,
    1,
  );
  assertEquals(
    document.querySelectorAll(
      '.benefit-art-preview__theme[data-discern-theme="dark"]',
    ).length,
    1,
  );

  for (
    const theme of document.querySelectorAll(".benefit-art-preview__theme")
  ) {
    assertEquals(theme.querySelectorAll(".bifurcation-art > svg").length, 1);
    const branchCount = BIFURCATION_TOPOLOGY.levels.reduce(
      (total, level) => total + level.nodes.length,
      0,
    );
    assertEquals(
      theme.querySelectorAll("[data-bifurcation-branch]").length,
      branchCount,
    );
    for (const level of BIFURCATION_TOPOLOGY.levels) {
      assertEquals(
        theme.querySelectorAll(
          `[data-bifurcation-level="${level.depth}"] [data-bifurcation-branch]`,
        ).length,
        level.nodes.length,
      );
    }

    const capSymbol = theme.querySelector<SVGSymbolElement>(
      "symbol[data-bifurcation-cap-symbol]",
    );
    assert(capSymbol !== null);
    const terminalCaps = [
      ...theme.querySelectorAll<SVGGElement>("[data-bifurcation-terminal]"),
    ];
    assertEquals(terminalCaps.length, BIFURCATION_TERMINALS.length);
    for (const cap of terminalCaps) {
      const terminal = BIFURCATION_TERMINALS.find((candidate) =>
        candidate.id === cap.getAttribute("data-bifurcation-terminal")
      );
      assert(terminal !== undefined);
      assertEquals(
        cap.getAttribute("transform"),
        `translate(${terminal.x} ${terminal.y})`,
      );
      assert(!cap.hasAttribute("data-bifurcation-motion"));
      const motion = cap.querySelector<SVGGElement>(
        "[data-bifurcation-cap-motion]",
      );
      assert(motion !== null);
      assert(motion.hasAttribute("data-bifurcation-motion"));
      const geometry = motion.querySelector<SVGUseElement>("use");
      assert(geometry !== null);
      assertEquals(geometry.getAttribute("href"), `#${capSymbol.id}`);
      assertEquals(geometry.getAttribute("x"), "-10");
      assertEquals(geometry.getAttribute("y"), "-10");
      assertEquals(geometry.getAttribute("width"), "20");
      assertEquals(geometry.getAttribute("height"), "20");
    }

    for (const branch of theme.querySelectorAll("[data-bifurcation-branch]")) {
      assert(branch.hasAttribute("data-bifurcation-parent"));
      assert(branch.hasAttribute("data-bifurcation-motion"));
    }
    assertEquals(
      theme.querySelectorAll("[data-bifurcation-motion]").length,
      1 + branchCount + BIFURCATION_TERMINALS.length,
    );
  }

  assert(
    !html.includes("bifurcation-art__resolution"),
    "the obsolete converging triangle must not return",
  );

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  const text = readableText(document.body.textContent);
  assertStringIncludes(text, "Multiply your output.");
  assertStringIncludes(
    text,
    "Isolation, delegation shapes, and fleet coordination raise how much work can be in flight at once.",
  );
  assert(!html.includes("_private"), "private source paths must not render");
  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static preview must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("each artwork has a local title and description", () => {
  const dom = new JSDOM(renderBifurcationSpecimen());
  const document = dom.window.document;

  for (const svg of document.querySelectorAll(".bifurcation-art svg")) {
    assertEquals(svg.getAttribute("role"), "img");
    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "").split(
      /\s+/,
    ).filter(Boolean);
    assertEquals(labelledBy.length, 2);

    const title = document.getElementById(labelledBy[0] ?? "");
    const description = document.getElementById(labelledBy[1] ?? "");
    assertEquals(title?.tagName.toLowerCase(), "title");
    assertEquals(description?.tagName.toLowerCase(), "desc");
    assert(readableText(title?.textContent ?? null).length > 0);
    assert(readableText(description?.textContent ?? null).length > 0);
  }
  dom.window.close();
});

Deno.test("the artwork remains fluid through the compact gallery breakpoints", async () => {
  const dom = new JSDOM(renderBifurcationSpecimen());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  assertEquals(styleValue(css, ".bifurcation-art svg", "width"), "100%");
  assertEquals(styleValue(css, ".bifurcation-art svg", "height"), "auto");

  const stacked = cssBlock(css, "@media (max-width: 68rem)");
  assert(stacked !== undefined);
  assertEquals(
    styleValue(
      stacked,
      ".benefit-art-preview__gallery",
      "grid-template-columns",
    ),
    "1fr",
  );
  const compact = cssBlock(css, "@media (max-width: 46rem)");
  assert(compact !== undefined);
  assertEquals(
    styleValue(compact, ".benefit-art-preview__theme", "padding-inline"),
    "var(--discern-space-2)",
  );

  for (
    const svg of dom.window.document.querySelectorAll(".bifurcation-art svg")
  ) {
    assertEquals(svg.getAttribute("viewBox"), "0 0 760 460");
    assertEquals(svg.hasAttribute("width"), false);
    assertEquals(svg.hasAttribute("height"), false);
  }
  dom.window.close();
});

Deno.test("the artwork keeps its culmination when motion is reduced", async () => {
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  assertStringIncludes(css, "animation-duration: 10.8s");
  for (const level of BIFURCATION_TOPOLOGY.levels) {
    assertStringIncludes(
      css,
      `data-bifurcation-level="${level.depth}"]`,
    );
    assertStringIncludes(
      css,
      `animation-name: bifurcation-art-level-${level.depth};`,
    );
    assertStringIncludes(
      css,
      `@keyframes bifurcation-art-level-${level.depth}`,
    );
  }
  assertStringIncludes(
    css,
    "animation-name: bifurcation-art-terminal-cap;",
  );
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(
    css,
    ".bifurcation-art [data-bifurcation-motion] {\n      animation: none;",
  );
  assertStringIncludes(css, "stroke-dashoffset: 0");
  assertStringIncludes(css, "transform: none");
  assert(!css.includes("bifurcation-art-resolution"));
});

Deno.test("the study reserves monospace for the product name", async () => {
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  assertEquals(monoSelectors(css), [".benefit-art-preview__brand"]);
});
