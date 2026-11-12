/**
 * The wall's cards are the boxes of one multi-column list. Safari's engine
 * misdraws a box of such a list once the box paints through a layer of its
 * own, and it gives every card a layer of its own when another layer lies
 * beside an open list. The list is therefore one stacking context, which the
 * browser lifts as one layer. That rule is read here from the stylesheets,
 * because the gate's browser is Chrome and Chrome draws the wall whole with
 * or without it. The last case reads the same rule from the built page in a
 * real browser, at four columns and at five.
 */
import { assertEquals } from "@std/assert";
import {
  openLiveWall,
  VIEWPORTS,
  WIDE_VIEWPORT,
  withBrowser,
} from "./site_wall_browser.ts";
import {
  conditionsOf,
  selectsBox,
  type StyleRule,
  styleRules,
  wallSheets,
} from "./wall_stylesheets.ts";

/** One rule of a wall stylesheet, with the stylesheet it stands in. */
interface SheetRule {
  readonly sheet: string;
  readonly rule: StyleRule;
}

/** Every rule of every wall stylesheet, in cascade order. */
async function wallRules(): Promise<SheetRule[]> {
  return (await wallSheets()).flatMap(({ sheet, text }) =>
    styleRules(text).map((rule) => ({ sheet, rule }))
  );
}

/**
 * Every declaration of a property `held` matches, on a box `chosen` picks
 * out, in any stylesheet and under any at-rule. Each reads as the stylesheet,
 * the conditions the rule applies under, its selector, and the declaration.
 */
function declarationsOn(
  rules: readonly SheetRule[],
  chosen: (selector: string) => boolean,
  held: RegExp,
): string[] {
  return rules.flatMap(({ sheet, rule }) =>
    rule.selectors.filter(chosen).flatMap((selector) =>
      rule.declarations.filter(([property]) => held.test(property)).map((
        [property, value],
      ) =>
        `${sheet}: ${
          [...conditionsOf(rule), selector].join(" ")
        } { ${property}: ${value} }`
      )
    )
  );
}

Deno.test("the list of cards is one stacking context, in every state of the wall", async () => {
  // A layer the browser composites beside the list then lifts the list as
  // one layer: the far view's horizon is such a layer, beneath the cards.
  // Left open, WebKit lifts each card over that layer into a layer of its
  // own. So the list isolates itself in its one base rule, and no rule for
  // any state or size of the wall says otherwise.
  assertEquals(
    declarationsOn(
      await wallRules(),
      (selector) => selectsBox(selector, "wall-list"),
      /^isolation$/,
    ),
    ["wall.css: .wall-list { isolation: isolate }"],
  );
});

const [, LAPTOP] = VIEWPORTS;

/** The sizes the list is read at, and the columns the wall has at each. */
const COLUMN_SIZES = [
  { ...LAPTOP, columns: 4 },
  { ...WIDE_VIEWPORT, columns: 5 },
] as const;

Deno.test("in a real browser the list of cards isolates itself, at four columns and at five", async () => {
  for (const size of COLUMN_SIZES) {
    await withBrowser(async (browser) => {
      const { page, faults } = await openLiveWall(
        await browser.newContext({
          viewport: { width: size.width, height: size.height },
          reducedMotion: "reduce",
        }),
      );
      const list = await page.locator(".wall-list").evaluate((list) => ({
        isolation: getComputedStyle(list).isolation,
        columns: new Set(
          [...list.children].map((item) =>
            item instanceof HTMLElement ? item.offsetLeft : NaN
          ),
        ).size,
      }));
      assertEquals(
        list,
        { isolation: "isolate", columns: size.columns },
        size.name,
      );
      assertEquals(faults, [], size.name);
    });
  }
});
