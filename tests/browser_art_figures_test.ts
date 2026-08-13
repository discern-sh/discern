/** Series-wide metre laws for every figure-series browser artwork. */

import { assert, assertEquals } from "@std/assert";
import { FIGURE_SERIES_SLUGS } from "../art/browser/registry.ts";

/** One beat of the shared metre, in seconds. */
const BEAT_SECONDS = 1.2;
/** The permitted phrase range, in seconds. */
const PHRASE_RANGE = { min: 24, max: 48 } as const;

/** Properties a figure keyframe may declare. */
const ALLOWED_KEYFRAME_PROPERTIES = new Set([
  "transform",
  "opacity",
  "stroke-dashoffset",
  "stroke-dasharray",
  "offset-distance",
  "animation-timing-function",
]);

/** Color notations that would bypass the shared token palette. */
const RAW_COLOR_PATTERNS = [
  /#[0-9a-f]{3,8}\b/i,
  /\brgba?\(/i,
  /\bhsla?\(/i,
  /\boklch\(/i,
  /\boklab\(/i,
  /\bcolor\(/i,
];

/** Read one artwork source file beside the registry. */
async function artSource(name: string): Promise<string> {
  return await Deno.readTextFile(
    new URL(`../art/browser/${name}`, import.meta.url),
  );
}

/** Strip comments so structural scans see only effective CSS. */
function effectiveCss(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract each @keyframes rule as its name and balanced body. */
function keyframesRules(css: string): Array<{ name: string; body: string }> {
  const rules: Array<{ name: string; body: string }> = [];
  const opener = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let match = opener.exec(css); match; match = opener.exec(css)) {
    const name = match[1] ?? "";
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth > 0) {
      const character = css[index];
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      index += 1;
    }
    rules.push({ name, body: css.slice(opener.lastIndex, index - 1) });
    opener.lastIndex = index;
  }
  return rules;
}

/** Split one keyframes body into selector-list/declaration chunks. */
function keyframeChunks(
  body: string,
): Array<{ selectors: string[]; declarations: string }> {
  const chunks: Array<{ selectors: string[]; declarations: string }> = [];
  const chunk = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = chunk.exec(body); match; match = chunk.exec(body)) {
    chunks.push({
      selectors: (match[1] ?? "").split(",").map((selector) =>
        selector.trim().toLowerCase()
      ),
      declarations: match[2] ?? "",
    });
  }
  return chunks;
}

/** Reduce declaration text to a property→value map, later wins. */
function declarationMap(declarations: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const declaration of declarations.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).replace(/\s+/g, " ").trim();
    if (property.length > 0) map.set(property, value);
  }
  return map;
}

/**
 * Accumulate the effective visual state for one keyframe offset.
 * Timing functions shape the segment that follows an offset rather than
 * the state at it, so they stay out of the loop-closure comparison.
 */
function offsetState(
  body: string,
  offsets: readonly string[],
): Map<string, string> {
  const state = new Map<string, string>();
  for (const { selectors, declarations } of keyframeChunks(body)) {
    if (!selectors.some((selector) => offsets.includes(selector))) continue;
    for (const [property, value] of declarationMap(declarations)) {
      if (property === "animation-timing-function") continue;
      state.set(property, value);
    }
  }
  return state;
}

/**
 * Collect every duration mentioned by animation declarations, in seconds.
 * A duration may be a literal time or a beat-token multiple of the form
 * calc(var(--fig-beat) * N).
 */
function animationDurations(css: string): number[] {
  const durations: number[] = [];
  const declaration = /animation(?:-duration)?\s*:\s*([^;]+);/g;
  for (
    let match = declaration.exec(css);
    match;
    match = declaration.exec(css)
  ) {
    const value = (match[1] ?? "").replace(/\s+/g, " ");
    const beats = /calc\(var\(--fig-beat\) \* (\d+(?:\.\d+)?)\)/g;
    for (let found = beats.exec(value); found; found = beats.exec(value)) {
      durations.push(Number(found[1]) * BEAT_SECONDS);
    }
    const time = /(\d+(?:\.\d+)?)(m?s)\b/g;
    for (let found = time.exec(value); found; found = time.exec(value)) {
      const amount = Number(found[1]);
      durations.push(found[2] === "ms" ? amount / 1000 : amount);
    }
  }
  return durations;
}

/** One unit-normalised SVG stroke whose dash is barred from scaling. */
type UnitDashScalingConflict = {
  element: string;
  line: number;
};

/**
 * Find SVG geometry that asks pathLength to normalise its dash to one unit
 * while asking vector-effect to keep that dash out of the geometry's scale.
 */
function unitDashScalingConflicts(
  source: string,
): UnitDashScalingConflict[] {
  const conflicts: UnitDashScalingConflict[] = [];
  const geometry = /<(circle|ellipse|line|path|polygon|polyline|rect)\b[^>]*>/g;
  for (
    let match = geometry.exec(source);
    match;
    match = geometry.exec(source)
  ) {
    const tag = match[0];
    if (!/\bpathLength\s*=\s*\{\s*1\s*\}/.test(tag)) continue;
    if (!/\bvectorEffect\s*=\s*"non-scaling-stroke"/.test(tag)) continue;
    conflicts.push({
      element: match[1] ?? "geometry",
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return conflicts;
}

/** Read every authored browser-art TSX file, including future additions. */
async function browserArtworkSources(): Promise<
  Array<{ name: string; source: string }>
> {
  const directory = new URL("../art/browser/", import.meta.url);
  const names: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".tsx")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(
    names.map(async (name) => ({
      name,
      source: await Deno.readTextFile(new URL(name, directory)),
    })),
  );
}

Deno.test("unit-normalised SVG dashes scale with their geometry", async () => {
  const violations: string[] = [];
  for (const { name, source } of await browserArtworkSources()) {
    for (const conflict of unitDashScalingConflicts(source)) {
      violations.push(`${name}:${conflict.line} <${conflict.element}>`);
    }
  }
  assertEquals(
    violations,
    [],
    "pathLength={1} cannot share a geometry element with " +
      'vectorEffect="non-scaling-stroke"; a responsive SVG then scales the ' +
      "path but not its unit dash, so drawing animations miss their endpoints",
  );
});

Deno.test("unit-dash guard catches a fresh artwork sibling", () => {
  const futureArtwork = `
    export function FutureEtch() {
      return <line pathLength={1} vectorEffect="non-scaling-stroke" />;
    }
  `;
  assertEquals(unitDashScalingConflicts(futureArtwork), [
    { element: "line", line: 3 },
  ]);
});

for (const slug of FIGURE_SERIES_SLUGS) {
  Deno.test(`figure '${slug}' obeys the series metre`, async () => {
    const css = effectiveCss(await artSource(`${slug}.css`));
    const tsx = await artSource(`${slug}.tsx`);

    for (const pattern of RAW_COLOR_PATTERNS) {
      assert(
        !pattern.test(css) && !pattern.test(tsx),
        `${slug} must take every color from the shared tokens ` +
          `(${pattern.source} found)`,
      );
    }

    assert(!/@import\b/.test(css), `${slug} must not import stylesheets`);
    assert(!/<animate/i.test(tsx), `${slug} must animate with CSS, not SMIL`);
    assert(!/<text/i.test(tsx), `${slug} must stay free of text elements`);
    assert(
      tsx.includes('viewBox="0 0 760 540"'),
      `${slug} must keep the shared plate size`,
    );

    const rules = keyframesRules(css);
    assert(rules.length > 0, `${slug} must choreograph at least one keyframes`);
    for (const { name, body } of rules) {
      assert(
        name.startsWith(`fig-${slug}-`),
        `keyframes '${name}' must carry the fig-${slug}- namespace`,
      );
      for (const { declarations } of keyframeChunks(body)) {
        for (const property of declarationMap(declarations).keys()) {
          assert(
            ALLOWED_KEYFRAME_PROPERTIES.has(property),
            `keyframes '${name}' may not animate '${property}'`,
          );
        }
      }
      assertEquals(
        Object.fromEntries(offsetState(body, ["0%", "from"])),
        Object.fromEntries(offsetState(body, ["100%", "to"])),
        `keyframes '${name}' must close its loop where it opened`,
      );
    }

    const durations = animationDurations(css);
    assert(durations.length > 0, `${slug} must declare its phrase duration`);
    const distinct = [...new Set(durations)];
    assertEquals(
      distinct.length,
      1,
      `${slug} must run one shared phrase clock, found ${distinct.join(", ")}`,
    );
    const phrase = distinct[0] ?? 0;
    assert(
      phrase >= PHRASE_RANGE.min && phrase <= PHRASE_RANGE.max,
      `${slug} phrase must sit between ${PHRASE_RANGE.min}s and ` +
        `${PHRASE_RANGE.max}s, found ${phrase}s`,
    );
    const beats = phrase / BEAT_SECONDS;
    assert(
      Math.abs(beats - Math.round(beats)) < 1e-9,
      `${slug} phrase must be a whole multiple of the ${BEAT_SECONDS}s beat, ` +
        `found ${phrase}s`,
    );
  });
}
