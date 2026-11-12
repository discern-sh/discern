/**
 * The wall's stylesheets as its tests read them. Every test that holds a
 * stylesheet to a rule reads it through the one parser here, so they agree
 * on what a rule is, on the at-rules around it, and on where a selector list
 * or a value divides.
 */
import { fromFileUrl, join } from "@std/path";
import { WALL_STYLESHEETS } from "../site/wall/assets.ts";

const SHEET_ROOT = fromFileUrl(new URL("../site/page-src/", import.meta.url));

/** Read one of the wall's stylesheets as authored. */
export function readWallSheet(sheet: string): Promise<string> {
  return Deno.readTextFile(join(SHEET_ROOT, sheet));
}

/** A stylesheet with its comments removed. */
export function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every wall stylesheet by name, in cascade order, with its comments removed. */
export function wallSheets(): Promise<
  { readonly sheet: string; readonly text: string }[]
> {
  return Promise.all(WALL_STYLESHEETS.map(async (sheet) => ({
    sheet,
    text: withoutComments(await readWallSheet(sheet)),
  })));
}

/** `text` on one line, with each run of white space as one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split `text` at each `separator` that sits outside every pair of round or
 * square brackets. Each part comes back on one line, and an empty part is
 * dropped. A selector list divides at its commas, a selector at the spaces
 * between the boxes it names, a block at its semicolons, and a list of
 * transitions at its commas, and none of them inside `:is()`, `calc()`, or
 * an attribute's value.
 */
export function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const character = text[at];
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(oneLine).filter((part) => part !== "");
}

/** One block of declarations, with what heads it and what stands around it. */
export interface StyleRule {
  /**
   * What heads the block, on one line: a selector list, a step of a
   * keyframe, or an at-rule that holds declarations itself, as `@property`
   * does.
   */
  readonly prelude: string;
  /** The prelude divided at its commas: one entry for each selector. */
  readonly selectors: readonly string[];
  /** The at-rules the block sits inside, outermost first. */
  readonly context: readonly string[];
  /** Each declaration in order: its property, and its value on one line. */
  readonly declarations: readonly (readonly [
    property: string,
    value: string,
  ])[];
}

/** The declarations a block's body makes. */
function declarationsIn(body: string): StyleRule["declarations"] {
  return splitOutside(body, ";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    return colon === -1 ? [] : [
      [
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      ] as const,
    ];
  });
}

/** The blocks of declarations in `text`, which sits inside `context`. */
function blocksIn(text: string, context: readonly string[]): StyleRule[] {
  const rules: StyleRule[] = [];
  let at = 0;
  for (
    let open = text.indexOf("{", at);
    open !== -1;
    open = text.indexOf("{", at)
  ) {
    // A statement that ends before the block is no part of what heads it.
    const prelude = oneLine(text.slice(at, open).split(";").at(-1) ?? "");
    let depth = 1;
    let close = open + 1;
    for (; close < text.length && depth > 0; close++) {
      if (text[close] === "{") depth++;
      else if (text[close] === "}") depth--;
    }
    if (depth > 0) throw new Error(`"${prelude}" opens a block it never ends`);
    const body = text.slice(open + 1, close - 1);
    if (body.includes("{")) {
      rules.push(...blocksIn(body, [...context, prelude]));
    } else {
      rules.push({
        prelude,
        selectors: splitOutside(prelude, ","),
        context,
        declarations: declarationsIn(body),
      });
    }
    at = close;
  }
  return rules;
}

/**
 * Every block of declarations in a stylesheet, each with the at-rules around
 * it, however deeply they nest it. Comments are no part of what it reads.
 *
 * A style rule is one such block. So is a step of a keyframe, headed by
 * `from` or a percentage inside its `@keyframes`, and so is an at-rule that
 * holds declarations itself, headed by its own name. A caller picks rules by
 * selector, and neither of those is headed by one a style rule could carry.
 * The wall's stylesheets nest style rules inside at-rules and never inside
 * each other, which is all this reads.
 */
export function styleRules(css: string): StyleRule[] {
  return blocksIn(withoutComments(css), []);
}

/**
 * The value a rule gives one property, when it sets it. A rule that sets a
 * property twice means the later value, as it does in the browser.
 */
export function declared(
  rule: StyleRule,
  property: string,
): string | undefined {
  return rule.declarations.findLast(([name]) => name === property)?.[1];
}

/** The last box a selector names, with its states: the box the rule styles. */
function subjectOf(selector: string): string {
  return splitOutside(selector, " ").at(-1) ?? "";
}

/**
 * What names a selector's subject: its type, classes, and pseudo-classes,
 * each as written. What a state looks at, inside `:has()` or an attribute's
 * brackets, is no part of the name, and a pseudo-element is a box of its own,
 * which has no name here.
 */
function subjectNames(selector: string): string[] {
  let subject = subjectOf(selector);
  if (subject.includes("::")) return [];
  let bare = "";
  while (bare !== subject) {
    bare = subject;
    subject = subject.replace(/\([^()]*\)|\[[^\][]*\]/g, "");
  }
  return subject.split(/(?=[.:#])/);
}

/**
 * Whether a selector's subject is a box of this class itself, in any state,
 * and neither a pseudo-element of it nor a box whose class only begins alike.
 */
export function selectsBox(selector: string, className: string): boolean {
  return subjectNames(selector).includes(`.${className}`);
}

/**
 * Whether a selector's subject is a card's own list item, of any kind and in
 * any state, and no box inside the card.
 */
export function selectsCardItem(selector: string): boolean {
  return subjectNames(selector).some((name) =>
    /^\.wall-card(?:--[\w-]+)?$/.test(name)
  );
}

/** One rule of a wall stylesheet, with the stylesheet it stands in. */
export interface SheetRule {
  readonly sheet: string;
  readonly rule: StyleRule;
}

/** Every rule of every wall stylesheet, in cascade order. */
export async function wallRules(): Promise<SheetRule[]> {
  return (await wallSheets()).flatMap(({ sheet, text }) =>
    styleRules(text).map((rule) => ({ sheet, rule }))
  );
}

/** The at-rules that decide when a rule applies: every one but its layer. */
export function conditionsOf(rule: StyleRule): readonly string[] {
  return rule.context.filter((query) => !query.startsWith("@layer"));
}

/**
 * A property that moves a box or gives a change its time: the transform and
 * each property that stands for one part of it, a motion path, the hint that
 * a box will move, and the transitions and animations that carry a change. A
 * wall stylesheet held to reduced motion sets one only for a reader who has
 * not asked for less.
 */
export const MOTION_PROPERTY =
  /^(?:transform|translate|rotate|scale|offset(?:-.+)?|will-change|transition(?:-.+)?|animation(?:-.+)?)$/;

/** Whether a rule applies only to a reader who has not asked for reduced motion. */
export function movesByChoice(rule: StyleRule): boolean {
  return rule.context.some((query) =>
    query.includes("prefers-reduced-motion: no-preference")
  );
}
