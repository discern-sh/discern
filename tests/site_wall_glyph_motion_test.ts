/**
 * A lit card's glyph moves without disturbing the wall around it.
 *
 * The glyph test holds the stylesheet to the rules that make that so. This
 * suite watches a real browser follow them. One hover on and off a card whose
 * glyph travels lays nothing out, and the glyph is at rest before its card's
 * face steps back down among the other cards. A glyph that eases while its
 * face is not raised, as when a sheet closes with the pointer elsewhere,
 * never becomes a layer of its own. And a reader who asks for reduced motion
 * sees the glyph stay where it is.
 */
import { assert, assertEquals } from "@std/assert";
import type { Browser, BrowserContextOptions, Page } from "playwright-core";
import { handler } from "../site/serve.ts";
import { GLYPH_GRID, type GlyphPoint } from "../site/wall/glyph_grammar.ts";
import { glyphDrawing } from "../site/wall/glyphs.ts";
import { OPENING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";
import {
  drawn,
  motionSettled,
  NEAR_WALL,
  traced,
} from "./site_wall_browser.ts";

const ORIGIN = "http://127.0.0.1:18904";
const VIEWPORT = { width: 1440, height: 900 };

/** A place in the viewport that is over no card. */
const OFF_WALL = { x: 2, y: VIEWPORT.height - 2 };

/** How near its mark a measured distance must come, in pixels. */
const CLOSE = 0.05;

/** A card in view whose glyph has a primitive that travels. */
interface Target {
  readonly id: string;
  /** The middle of the card, where a pointer tilts it neither way. */
  readonly x: number;
  readonly y: number;
  /** How far the glyph's travelling drawing lies from its place at rest when posed, in pixels. */
  readonly pose: GlyphPoint;
}

/** Where a card's travelling drawing is, and what the card around it is doing. */
interface Travel {
  /** How far the travelling drawing lies from its glyph's box, in pixels. */
  readonly dx: number;
  readonly dy: number;
  /** Transitions still running on the travelling drawing. */
  readonly easing: number;
  /** The stacking order of the face the glyph sits on. */
  readonly stack: string;
  /** Whether the travelling drawing is the same size as the drawing under it. */
  readonly fits: boolean;
}

/** Measure a card's travelling drawing against its glyph, and the face under it. */
function travel(page: Page, id: string): Promise<Travel> {
  return page.evaluate((id) => {
    const card = document.querySelector(`.wall-card[data-card="${id}"]`);
    const moving = card?.querySelector(".wall-glyph-move");
    const glyph = moving?.parentElement;
    const still = glyph?.firstElementChild;
    if (!card || !moving || !glyph || !still) {
      throw new Error(`card ${id} has no travelling drawing`);
    }
    const box = glyph.getBoundingClientRect();
    const moved = moving.getBoundingClientRect();
    const under = still.getBoundingClientRect();
    return {
      dx: moved.left - box.left,
      dy: moved.top - box.top,
      easing: moving.getAnimations().length,
      stack: getComputedStyle(glyph.parentElement ?? glyph).zIndex,
      fits: Math.abs(moved.width - under.width) < 0.01 &&
        Math.abs(moved.height - under.height) < 0.01 &&
        Math.abs(under.left - box.left) < 0.01 &&
        Math.abs(under.top - box.top) < 0.01,
    };
  }, id);
}

/**
 * Resolve once a card's travelling drawing has stopped easing `at` pixels
 * from its glyph's box, with its face raised above its `rest` place in the
 * stacking order, or back down at it.
 */
async function settled(
  page: Page,
  id: string,
  at: GlyphPoint,
  rest: string,
  raised: boolean,
): Promise<void> {
  await page.waitForFunction(
    ({ id, at, rest, raised, close }) => {
      const moving = document.querySelector(
        `.wall-card[data-card="${id}"] .wall-glyph-move`,
      );
      const glyph = moving?.parentElement;
      if (!moving || !glyph) return false;
      const box = glyph.getBoundingClientRect();
      const moved = moving.getBoundingClientRect();
      return moving.getAnimations().length === 0 &&
        Math.abs(moved.left - box.left - at[0]) < close &&
        Math.abs(moved.top - box.top - at[1]) < close &&
        (getComputedStyle(glyph.parentElement ?? glyph).zIndex !== rest) ===
          raised;
    },
    { id, at, rest, raised, close: CLOSE },
  );
}

/** Open the homepage in a laptop viewport, bring the wall near, and pick a card. */
async function onTheWall(
  options: BrowserContextOptions,
  check: (page: Page, target: Target, browser: Browser) => Promise<void>,
): Promise<void> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: "no-preference",
      ...options,
    });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    const faults: string[] = [];
    page.on("pageerror", (error) => faults.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") faults.push(message.text());
    });
    await serveThroughHandler(page, ORIGIN, handler);
    await page.goto(`${ORIGIN}/`);
    await page.locator(".wall-stage").evaluate((stage) =>
      stage.scrollIntoView({ block: "start", behavior: "instant" })
    );
    await page.locator(NEAR_WALL).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    // The wall fades in once as the page loads, and the end of that is a
    // change of its own. Everything the clock drives is over before a check
    // starts to count what a glyph costs.
    await motionSettled(page);
    await drawn(page, 3);

    // A card clear of the bar that stays over the wall's top, whole in view.
    const found = await page.evaluate((height) => {
      for (const card of document.querySelectorAll(".wall-card")) {
        const glyph = card.querySelector(".wall-glyph");
        if (
          glyph === null || glyph.querySelector(".wall-glyph-move") === null
        ) {
          continue;
        }
        const box = card.getBoundingClientRect();
        if (box.top < 140 || box.bottom > height - 20) continue;
        return {
          id: card.getAttribute("data-card") ?? "",
          glyph: glyph.getAttribute("data-glyph") ?? "",
          side: glyph.getBoundingClientRect().width,
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        };
      }
      return null;
    }, VIEWPORT.height);
    assert(found !== null, "a card whose glyph travels is in view");
    const shift = glyphDrawing(found.glyph).find((primitive) =>
      primitive.shift !== undefined
    )?.shift;
    assert(shift !== undefined, `${found.glyph} has a primitive that travels`);
    const scale = found.side / GLYPH_GRID;
    await check(page, {
      id: found.id,
      x: found.x,
      y: found.y,
      pose: [shift[0] * scale, shift[1] * scale],
    }, browser);
    assertEquals(faults, [], "the page raised no error");
  } finally {
    await browser.close();
  }
}

/** How many times the browser laid the page out while `act` ran, by its own trace. */
async function layouts(
  browser: Browser,
  page: Page,
  act: () => Promise<void>,
): Promise<number> {
  const events = await traced(browser, page, ["devtools.timeline"], act);
  assert(
    events.some((event) => event["name"] === "UpdateLayoutTree"),
    "the trace recorded the page's work",
  );
  return events.filter((event) =>
    event["name"] === "Layout" && (event["ph"] === "X" || event["ph"] === "B")
  ).length;
}

/** Where the page keeps its count of frames, for the check that reads it. */
const FRAME_TALLY = "wallGlyphFrames";

/**
 * From now until a card is back at rest, count the frames the page draws and
 * the ones in which the glyph is still easing though its face has already
 * stepped back to `rest` in the stacking order.
 */
async function watchTheWayBack(
  page: Page,
  id: string,
  rest: string,
): Promise<void> {
  await page.evaluate(({ id, rest, key }) => {
    const moving = document.querySelector(
      `.wall-card[data-card="${id}"] .wall-glyph-move`,
    );
    const face = moving?.parentElement?.parentElement;
    if (!moving || !face) throw new Error(`card ${id} has no glyph to watch`);
    const tally = { frames: 0, late: 0, raised: false, done: false };
    Reflect.set(globalThis, key, tally);
    const look = (): void => {
      const easing = moving.getAnimations().length > 0;
      const down = getComputedStyle(face).zIndex === rest;
      tally.frames++;
      tally.raised ||= !down;
      if (easing && down) tally.late++;
      if (tally.raised && down && !easing) tally.done = true;
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, { id, rest, key: FRAME_TALLY });
}

/** The frames counted since `watchTheWayBack`, once the card is at rest. */
async function wayBack(
  page: Page,
): Promise<{ readonly frames: number; readonly late: number }> {
  const read = (key: string): { frames: number; late: number } | null => {
    const tally: unknown = Reflect.get(globalThis, key);
    return typeof tally === "object" && tally !== null && "done" in tally &&
        tally.done === true && "frames" in tally &&
        typeof tally.frames === "number" && "late" in tally &&
        typeof tally.late === "number"
      ? { frames: tally.frames, late: tally.late }
      : null;
  };
  await page.waitForFunction(read, FRAME_TALLY);
  const counted = await page.evaluate(read, FRAME_TALLY);
  assert(counted !== null, "the card came back to rest");
  return counted;
}

Deno.test("one hover on and off a card whose glyph travels lays nothing out, and the glyph is at rest before its face steps back", async () => {
  await onTheWall({}, async (page, target, browser) => {
    const rest = await travel(page, target.id);
    assert(rest.fits, "the travelling drawing lies exactly over the still one");
    assertEquals(
      [rest.dx, rest.dy, rest.easing],
      [0, 0, 0],
      "it starts at rest",
    );
    assert(
      Math.hypot(...target.pose) > 1,
      "the pose is far enough from rest to be seen to move",
    );

    const laidOut = await layouts(browser, page, async () => {
      await page.mouse.move(target.x, target.y);
      await settled(page, target.id, target.pose, rest.stack, true);
      await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
      await settled(page, target.id, [0, 0], rest.stack, false);
    });
    assertEquals(
      laidOut,
      0,
      "the glyph reached its pose and came back, and the browser laid the " +
        "page out along the way",
    );

    // The same hover again, watched frame by frame on the way back.
    await page.mouse.move(target.x, target.y);
    await settled(page, target.id, target.pose, rest.stack, true);
    await watchTheWayBack(page, target.id, rest.stack);
    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    const back = await wayBack(page);
    assert(back.frames > 5, `the way back took ${back.frames} frames`);
    assertEquals(
      back.late,
      0,
      "the glyph was still moving in frames where its face had stepped back",
    );
  });
});

Deno.test("a glyph that eases on a face that is not raised never becomes a layer of its own", async () => {
  await onTheWall({}, async (page, target) => {
    const rest = await travel(page, target.id);
    const session = await page.context().newCDPSession(page);
    let layers = 0;
    let most = 0;
    session.on("LayerTree.layerTreeDidChange", (event) => {
      layers = event.layers?.length ?? 0;
      most = Math.max(most, layers);
    });
    await session.send("LayerTree.enable");
    await drawn(page, 3);
    const atRest = layers;
    assert(atRest > 0, "the browser reported the page's layers");

    // Mark the card as a sheet's source, in neither of the states that change
    // how the card itself is drawn. Its glyph takes the pose with no pointer
    // on the card and no focus in it, so its face stays down among the rest.
    // A marked card holds still, so the glyph is in its pose at once. It
    // eases back to rest when the mark goes, as it does once a sheet has
    // closed with the pointer elsewhere. The mark answers with what the glyph
    // and its face do the moment it changes: reading the transitions has the
    // browser apply the change.
    const mark = async (on: boolean): Promise<Travel> => {
      await page.evaluate(({ id, on, name }) => {
        document.querySelector(`.wall-card[data-card="${id}"]`)
          ?.toggleAttribute(name, on);
      }, { id: target.id, on, name: OPENING_ATTRIBUTE });
      return await travel(page, target.id);
    };

    most = 0;
    const posed = await mark(true);
    assertEquals(posed.easing, 0, "a marked card's glyph is posed at once");
    assertEquals(posed.stack, rest.stack, "and its face is not raised");
    await settled(page, target.id, target.pose, rest.stack, false);
    const freed = await mark(false);
    assert(freed.easing > 0, "the glyph eases back once the mark has gone");
    assertEquals(freed.stack, rest.stack, "and its face is not raised");
    await settled(page, target.id, [0, 0], rest.stack, false);
    await drawn(page, 2);
    assertEquals(
      Math.max(most, layers),
      atRest,
      "the browser made more layers while the glyph eased: a layer in the " +
        "middle of the wall has every card after it redrawn",
    );
  });
});

Deno.test("a reader who asks for reduced motion sees a lit card's glyph stay where it is", async () => {
  await onTheWall({ reducedMotion: "reduce" }, async (page, target) => {
    await page.mouse.move(target.x, target.y);
    await page.locator(`.wall-card[data-card="${target.id}"]:hover`).waitFor();
    await drawn(page, 3);
    const lit = await travel(page, target.id);
    assertEquals([lit.dx, lit.dy, lit.easing], [0, 0, 0]);
  });
});
