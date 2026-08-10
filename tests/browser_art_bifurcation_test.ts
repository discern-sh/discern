/** Structural guards for the approved Bifurcation browser artwork. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  BIFURCATION_TERMINALS,
  BIFURCATION_TOPOLOGY,
} from "../art/browser/bifurcation.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const BIFURCATION_CSS = new URL(
  "../art/browser/bifurcation.css",
  import.meta.url,
);
const GALLERY_CSS = new URL(
  "../site/page-src/art-gallery.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

type CssSpecificity = readonly [number, number, number];

interface PathEndpoints {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
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

/** Approximate the standards cascade for the focused selectors in this sheet. */
function selectorSpecificity(selector: string): CssSpecificity {
  const ids = [...selector.matchAll(/#[\w-]+/g)].length;
  const classLike = [
    ...selector.matchAll(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g),
  ].length;
  const remainder = selector.replace(
    /#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g,
    " ",
  );
  const types =
    remainder.split(/[\s>+~]+/).filter((token) => /^[a-z][\w-]*$/i.test(token))
      .length;
  return [ids, classLike, types];
}

/** Later equal-specificity rules win, as do rules with a stronger tuple. */
function specificityWins(
  candidate: CssSpecificity,
  current: CssSpecificity | undefined,
): boolean {
  if (current === undefined) return true;
  for (let index = 0; index < candidate.length; index += 1) {
    const candidatePart = candidate[index];
    const currentPart = current[index];
    if (candidatePart === undefined || currentPart === undefined) continue;
    if (candidatePart !== currentPart) return candidatePart > currentPart;
  }
  return true;
}

/** Resolve one authored property by matching selector specificity and order. */
function resolvedStyleValue(
  element: Element,
  css: string,
  property: string,
): string | undefined {
  let value: string | undefined;
  let specificity: CssSpecificity | undefined;
  for (const rule of cssRules(css)) {
    const candidateValue = rule.declarations.get(property);
    if (candidateValue === undefined) continue;
    for (const selector of rule.selectors) {
      try {
        if (!element.matches(selector)) continue;
      } catch {
        continue;
      }
      const candidateSpecificity = selectorSpecificity(selector);
      if (!specificityWins(candidateSpecificity, specificity)) continue;
      value = candidateValue;
      specificity = candidateSpecificity;
    }
  }
  return value;
}

/** Reject timing profiles that restart motion inside the shared sweep. */
function sweepEasingIssues(value: string): string[] {
  const stops = [...value.matchAll(
    /([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)%/g,
  )].map((match) => ({
    progress: Number(match[1]),
    percentage: Number(match[2]),
  }));
  const issues: string[] = [];
  const first = stops[0];
  const last = stops.at(-1);
  if (
    first?.progress !== 0 || first.percentage !== 0 ||
    last?.progress !== 1 || last.percentage !== 100
  ) {
    issues.push("does not span zero to one");
  }
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (previous === undefined || current === undefined) continue;
    if (
      current.percentage <= previous.percentage ||
      current.progress < previous.progress
    ) {
      issues.push("contains a discontinuous stop");
      break;
    }
  }
  const easeInEnd = stops.find((stop) => stop.percentage === 8);
  const easeOutStart = stops.find((stop) => stop.percentage === 92);
  if (
    easeInEnd === undefined || easeOutStart === undefined ||
    !(easeInEnd.progress > 0 && easeInEnd.progress < 0.1) ||
    !(easeOutStart.progress > 0.9 && easeOutStart.progress < 1)
  ) {
    issues.push("does not confine easing to its outer eight percent");
  }
  if (
    stops.some((stop) => stop.percentage > 8 && stop.percentage < 92)
  ) {
    issues.push("restarts easing inside the linear travel interval");
  }
  return issues;
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

/** Read the first and last authored coordinates from one SVG path. */
function pathEndpoints(path: Element): PathEndpoints | undefined {
  const shape = path.getAttribute("d");
  if (shape === null) return undefined;
  const values = [...shape.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0])
  );
  const startX = values[0];
  const startY = values[1];
  const endX = values.at(-2);
  const endY = values.at(-1);
  if (
    startX === undefined || startY === undefined ||
    endX === undefined || endY === undefined
  ) return undefined;
  return { startX, startY, endX, endY };
}

/** Read a static two-dimensional SVG translation. */
function translation(element: Element): { x: number; y: number } | undefined {
  const match = element.getAttribute("transform")?.match(
    /^translate\((-?[0-9.]+) (-?[0-9.]+)\)$/,
  );
  if (match === undefined || match === null) return undefined;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/** Find animation declarations that apply directly to one rendered member. */
function elementAnimationRules(element: Element, css: string): CssRule[] {
  return cssRules(css).filter((rule) =>
    rule.declarations.has("animation-name") &&
    rule.selectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    })
  );
}

/** Detect independent segment timing or a discontinuous registry reveal. */
function sweepContinuityIssues(
  topology: RegisteredBifurcationTopology,
  root: ParentNode,
  css: string,
): string[] {
  const issues: string[] = [];
  const sweepGroups = root.querySelectorAll("[data-bifurcation-sweep-lines]");
  const sweepGroup = sweepGroups.item(0);
  const revealFronts = root.querySelectorAll(
    "[data-bifurcation-sweep-motion]",
  );
  if (sweepGroups.length !== 1) {
    issues.push(`sweep: renders ${sweepGroups.length} line groups`);
  }
  if (revealFronts.length !== 1) {
    issues.push(`sweep: renders ${revealFronts.length} reveal fronts`);
  }

  const members: { readonly id: string; readonly element: Element | null }[] = [
    {
      id: "seed",
      element: root.querySelector(".bifurcation-art__seed-line"),
    },
  ];
  for (const level of topology.levels) {
    for (const node of level.nodes) {
      members.push({
        id: node.id,
        element: root.querySelector(
          `[data-bifurcation-branch="${node.id}"]`,
        ),
      });
    }
  }

  const endpoints: PathEndpoints[] = [];
  for (const member of members) {
    const reasons: string[] = [];
    if (member.element === null) {
      reasons.push("does not render");
    } else {
      const endpoint = pathEndpoints(member.element);
      if (endpoint === undefined) {
        reasons.push("has no measurable authored endpoints");
      } else {
        endpoints.push(endpoint);
        if (endpoint.endX <= endpoint.startX) {
          reasons.push("is not monotonic in the sweep direction");
        }
      }
      if (
        member.element.closest("[data-bifurcation-sweep-lines]") !== sweepGroup
      ) {
        reasons.push("is outside the shared reveal");
      }
      if (member.element.hasAttribute("data-bifurcation-motion")) {
        reasons.push("owns segment motion");
      }
      if (elementAnimationRules(member.element, css).length > 0) {
        reasons.push("owns an animation instead of the shared front");
      }
    }
    if (reasons.length > 0) {
      issues.push(`${member.id}: ${reasons.join("; ")}`);
    }
  }

  const reveal = revealFronts.item(0);
  if (reveal !== null && endpoints.length > 0) {
    const clipPath = reveal.parentElement;
    const start = Number(reveal.getAttribute("x"));
    const width = Number(reveal.getAttribute("width"));
    const lineStart = Math.min(...endpoints.map((endpoint) => endpoint.startX));
    const lineEnd = Math.max(...endpoints.map((endpoint) => endpoint.endX));
    if (
      clipPath?.tagName.toLowerCase() !== "clippath" ||
      clipPath.getAttribute("clipPathUnits") !== "userSpaceOnUse" ||
      clipPath.hasAttribute("transform")
    ) {
      issues.push("sweep: reveal is nested inside transformed clip geometry");
    }
    if (
      !Number.isFinite(start) || !(width > 0) ||
      start > lineStart || start + width < lineEnd
    ) {
      issues.push("sweep: reveal bounds do not cover the authored line span");
    }
    const clipId = clipPath?.getAttribute("id");
    if (
      clipId === null || clipId === undefined ||
      sweepGroup?.getAttribute("clip-path") !== `url(#${clipId})`
    ) {
      issues.push("sweep: line group does not reference its direct reveal");
    }
    const transformOrigin = reveal.getAttribute("style")?.match(
      /transform-origin:\s*(-?[0-9.]+)px center/,
    );
    if (
      transformOrigin === null || transformOrigin === undefined ||
      Number(transformOrigin[1]) !== start
    ) {
      issues.push("sweep: transform origin is not its authored start bound");
    }
    if (!reveal.hasAttribute("data-bifurcation-motion")) {
      issues.push("sweep: reveal front is not motion-enrolled");
    }
  }

  const revealAnimation = reveal === null
    ? undefined
    : resolvedStyleValue(reveal, css, "animation-name");
  const revealEasing = styleValue(
    css,
    ".bifurcation-art__sweep-reveal",
    "--bifurcation-sweep-easing",
  );
  const revealTiming = reveal === null
    ? undefined
    : resolvedStyleValue(reveal, css, "animation-timing-function");
  if (revealAnimation === undefined) {
    issues.push("sweep: has no single reveal animation");
  } else {
    const opening = keyframeStep(css, revealAnimation, 3);
    const culmination = keyframeStep(css, revealAnimation, 74);
    if (opening?.get("transform") !== "scaleX(0)") {
      issues.push("sweep: does not begin from one closed front");
    }
    if (culmination?.get("transform") !== "scaleX(1)") {
      issues.push("sweep: does not reach the whole line span");
    }
    const transforms = keyframeRules(css, revealAnimation).flatMap((rule) =>
      rule.declarations.has("transform")
        ? [rule.declarations.get("transform")]
        : []
    );
    if (
      transforms.some((transform) =>
        transform !== "scaleX(0)" && transform !== "scaleX(1)"
      )
    ) {
      issues.push("sweep: contains an intermediate segment transform");
    }
  }
  if (revealEasing === undefined || !revealEasing.startsWith("linear(")) {
    issues.push("sweep: has no once-only linear-interior easing profile");
  } else {
    issues.push(
      ...sweepEasingIssues(revealEasing).map((issue) =>
        `sweep: easing ${issue}`
      ),
    );
  }
  if (revealTiming !== "var(--bifurcation-sweep-easing)") {
    issues.push("sweep: does not apply its easing to the reveal animation");
  }

  return issues;
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
  const reveal = root.querySelector("[data-bifurcation-sweep-motion]");
  const revealAnimation = reveal === null
    ? undefined
    : resolvedStyleValue(reveal, css, "animation-name");
  const issues: string[] = [];

  for (const level of topology.levels) {
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
        if (branch.hasAttribute("pathLength")) {
          reasons.push("retains a normalized per-path draw length");
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
      if (branch !== null && elementAnimationRules(branch, css).length > 0) {
        reasons.push("retains an individual branch animation");
      }
      if (revealAnimation === undefined) {
        reasons.push("has no shared reveal animation");
      } else {
        for (const percentage of [74, 98]) {
          const step = keyframeStep(css, revealAnimation, percentage);
          if (step === undefined) {
            reasons.push(`shared reveal has no ${percentage}% hold boundary`);
            continue;
          }
          if (step.get("transform") !== "scaleX(1)") {
            reasons.push(`${percentage}% does not expose the complete stroke`);
          }
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
  const issues: string[] = [];

  for (const terminal of terminalLevel.nodes) {
    const reasons: string[] = [];
    let animationName: string | undefined;
    let motionRules: CssRule[] = [];
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
          `translate(${terminal.x + 10} ${terminal.y})`
      ) {
        reasons.push("is not shifted ten authored units from its endpoint");
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
        animationName = resolvedStyleValue(
          motion,
          css,
          "animation-name",
        );
        motionRules = animationName === undefined
          ? []
          : keyframeRules(css, animationName);
        if (
          resolvedStyleValue(motion, css, "animation-timing-function") !==
            "var(--discern-ease-out)"
        ) {
          reasons.push("does not win the cascade with its local easing");
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
        if (width !== 14 || height !== 14) {
          reasons.push("does not use the shared fourteen-unit cap size");
        }
        const branch = root.querySelector(
          `[data-bifurcation-branch="${terminal.id}"]`,
        );
        const endpoint = branch === null ? undefined : pathEndpoints(branch);
        const anchorPoint = translation(anchor);
        if (
          endpoint === undefined || anchorPoint === undefined ||
          endpoint.endY !== anchorPoint.y ||
          Math.abs(endpoint.endX - (anchorPoint.x - width / 4)) > 0.001
        ) {
          reasons.push(
            "does not end at the transparent triangle's left boundary",
          );
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
      for (const percentage of [82, 93]) {
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
  const dom = new JSDOM(renderArtGallery());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  for (
    const theme of dom.window.document.querySelectorAll(
      '[data-browser-artwork="bifurcation"] .art-gallery__theme',
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

Deno.test("one continuous reveal front enrolls every registered line", async () => {
  const dom = new JSDOM(renderArtGallery());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  for (
    const theme of dom.window.document.querySelectorAll(
      '[data-browser-artwork="bifurcation"] .art-gallery__theme',
    )
  ) {
    const issues = sweepContinuityIssues(
      BIFURCATION_TOPOLOGY,
      theme,
      css,
    );
    assertEquals(issues, [], issues.join("\n"));
  }
  dom.window.close();
});

Deno.test("the shared front rejects transformed clip wrappers", async () => {
  const dom = new JSDOM(renderArtGallery());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  const theme = dom.window.document.querySelector(
    '[data-browser-artwork="bifurcation"] .art-gallery__theme',
  );
  assert(theme !== null);
  const reveal = theme.querySelector("[data-bifurcation-sweep-motion]");
  const clipPath = reveal?.parentElement;
  assert(reveal !== null);
  assert(clipPath !== null && clipPath !== undefined);
  const wrapper = dom.window.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  wrapper.setAttribute("transform", "translate(56 0)");
  clipPath.insertBefore(wrapper, reveal);
  wrapper.append(reveal);
  reveal.setAttribute("x", "0");

  const issues = sweepContinuityIssues(
    BIFURCATION_TOPOLOGY,
    theme,
    css,
  );
  assert(
    issues.includes(
      "sweep: reveal is nested inside transformed clip geometry",
    ),
    issues.join("\n"),
  );
  dom.window.close();
});

Deno.test("every registered terminal scales only inside its static endpoint anchor", async () => {
  const dom = new JSDOM(renderArtGallery());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  for (
    const theme of dom.window.document.querySelectorAll(
      '[data-browser-artwork="bifurcation"] .art-gallery__theme',
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

Deno.test("motion-role easing must win the authored cascade", async () => {
  const dom = new JSDOM(renderArtGallery());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  const shadowedCss = `${css}
    .bifurcation-art [data-bifurcation-sweep-motion],
    .bifurcation-art [data-bifurcation-cap-motion] {
      animation-timing-function: linear;
    }
  `;
  const theme = dom.window.document.querySelector(
    '[data-browser-artwork="bifurcation"] .art-gallery__theme',
  );
  assert(theme !== null);

  const sweepIssues = sweepContinuityIssues(
    BIFURCATION_TOPOLOGY,
    theme,
    shadowedCss,
  );
  assert(
    sweepIssues.includes(
      "sweep: does not apply its easing to the reveal animation",
    ),
    sweepIssues.join("\n"),
  );

  const capIssues = terminalMotionIssues(
    BIFURCATION_TOPOLOGY,
    theme,
    shadowedCss,
  );
  assertEquals(capIssues.length, BIFURCATION_TERMINALS.length);
  assert(
    capIssues.every((issue) =>
      issue.includes("does not win the cascade with its local easing")
    ),
    capIssues.join("\n"),
  );
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
    <article class="art-preview__theme">
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
    ".art-preview__theme",
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
  assertStringIncludes(branchIssues[0] ?? "", "individual branch animation");

  const sweepIssues = sweepContinuityIssues(
    futureTopology,
    root,
    unsafeCss,
  );
  assert(
    sweepIssues.some((issue) =>
      issue.startsWith("later-limb:") &&
      issue.includes("owns an animation")
    ),
    sweepIssues.join("\n"),
  );

  const capIssues = terminalMotionIssues(futureTopology, root, unsafeCss);
  assertEquals(capIssues.length, 1);
  assertStringIncludes(capIssues[0] ?? "", "later-limb");
  assertStringIncludes(capIssues[0] ?? "", "local origin 0 0");
  assertStringIncludes(capIssues[0] ?? "", "translateX(-4px)");
  dom.window.close();
});

Deno.test("one bifurcation study renders in both fixed themes", () => {
  const html = renderArtGallery();
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const study = document.querySelector(
    '[data-browser-artwork="bifurcation"]',
  );
  assert(study !== null);

  assertEquals(study.querySelectorAll(".art-gallery__theme").length, 2);
  assertEquals(
    study.querySelectorAll(
      '.art-gallery__theme[data-discern-theme="light"]',
    ).length,
    1,
  );
  assertEquals(
    study.querySelectorAll(
      '.art-gallery__theme[data-discern-theme="dark"]',
    ).length,
    1,
  );

  for (
    const theme of study.querySelectorAll(".art-gallery__theme")
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
        `translate(${terminal.x + 10} ${terminal.y})`,
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
      assertEquals(geometry.getAttribute("x"), "-7");
      assertEquals(geometry.getAttribute("y"), "-7");
      assertEquals(geometry.getAttribute("width"), "14");
      assertEquals(geometry.getAttribute("height"), "14");
    }

    for (const branch of theme.querySelectorAll("[data-bifurcation-branch]")) {
      assert(branch.hasAttribute("data-bifurcation-parent"));
      assert(!branch.hasAttribute("data-bifurcation-motion"));
    }
    assertEquals(
      theme.querySelectorAll("[data-bifurcation-motion]").length,
      2 + BIFURCATION_TERMINALS.length,
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

  const text = readableText(study.textContent);
  assertStringIncludes(text, "One uninterrupted sweep");
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
  const dom = new JSDOM(renderArtGallery());
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
  const dom = new JSDOM(renderArtGallery());
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  const galleryCss = await Deno.readTextFile(GALLERY_CSS);
  assertEquals(styleValue(css, ".bifurcation-art svg", "width"), "100%");
  assertEquals(styleValue(css, ".bifurcation-art svg", "height"), "auto");

  const stacked = cssBlock(galleryCss, "@media (max-width: 68rem)");
  assert(stacked !== undefined);
  assertEquals(
    styleValue(
      stacked,
      ".art-gallery__theme-pair",
      "grid-template-columns",
    ),
    "1fr",
  );
  const compact = cssBlock(galleryCss, "@media (max-width: 28rem)");
  assert(compact !== undefined);
  assertEquals(
    styleValue(compact, ".art-gallery__theme", "padding-inline"),
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
  assertStringIncludes(
    css,
    "animation-name: bifurcation-art-sweep-reveal;",
  );
  assertStringIncludes(css, "@keyframes bifurcation-art-sweep-reveal");
  assertStringIncludes(css, "@keyframes bifurcation-art-sweep-cycle");
  assert(!css.includes("bifurcation-art-level-"));
  assert(!css.includes("bifurcation-art-seed-line {"));
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
