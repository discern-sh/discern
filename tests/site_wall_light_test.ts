/**
 * The wall's pointer light costs the same however many cards the wall holds,
 * and it comes and goes without crossing the page.
 *
 * Three layers hold that. The light's own arithmetic is checked as plain
 * functions. The stylesheets are held to one rule about every value script
 * writes while the pointer moves: it is registered so that it does not
 * inherit, so a new value restyles the box that carries it and never the
 * subtree below. And a real browser counts what a frame of pointer travel
 * restyles, on the wall as built and on a wall twice the size, and traces
 * that no handler or frame makes it lay the page out on the spot.
 *
 * The same browser moves the wall and its cards without resizing either, and
 * scrolls the page under a still pointer, and requires the light to stay
 * under the pointer through each.
 *
 * The same browser checks what stands in for the light where light means
 * nothing: forced colors, where the bar over the wall needs a solid backing,
 * and paper, where the room is a plain sheet. And it checks the one style
 * the browser works out for every element it restyles, selected text, which
 * the room must keep both readable and cheap.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import type {
  Browser,
  BrowserContextOptions,
  JSHandle,
  Page,
} from "playwright-core";
import { handler } from "../site/serve.ts";
import { CARD_LIGHT, POINTER_PROPERTIES } from "../site/wall/Card.tsx";
import { SCROLLBAR_ROOM } from "../site/wall/OpenCard.tsx";
import {
  wallKnobDefaults,
  type WallKnobName,
} from "../site/wall/tuning/knobs.ts";
import {
  type Light,
  LIGHT_PROPERTIES,
  LIGHT_REACH,
  lightFrame,
  lightGap,
  type LightPace,
  lightPace,
  type LightPoint,
  lightStep,
} from "../site/wall/use_light.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";
import {
  drawn,
  isAt,
  lightSettled,
  NEAR_WALL,
  placeOnWall,
} from "./site_wall_browser.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
import { type StyleRule, styleRules, wallSheets } from "./wall_stylesheets.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** A knob's shipped value. */
function shipped(name: WallKnobName): number {
  return wallKnobDefaults()[name];
}

/** How the light keeps pace as shipped, for a visitor who has asked nothing. */
const PACE: LightPace = lightPace(shipped, false);

/** One frame at sixty to the second, in milliseconds. */
const FRAME = 16;

Deno.test("the light closes on its target without overshoot and arrives exactly", () => {
  const from: LightPoint = { x: -400, y: 900 };
  const to: LightPoint = { x: 640, y: 120 };
  assertStrictEquals(lightStep(from, to, FRAME, 0), to, "no ease, no glide");
  assertEquals(lightStep(from, to, 0, PACE.ease), from, "no time, no travel");
  assertEquals(
    lightStep(from, to, -5, PACE.ease),
    from,
    "time never runs backward",
  );

  let at = from;
  let frames = 0;
  while (at !== to) {
    const next = lightStep(at, to, FRAME, PACE.ease);
    const before = Math.hypot(to.x - at.x, to.y - at.y);
    const after = Math.hypot(to.x - next.x, to.y - next.y);
    assert(after < before, "every frame is nearer the target");
    assert(
      Math.sign(to.x - next.x) !== -Math.sign(to.x - at.x) &&
        Math.sign(to.y - next.y) !== -Math.sign(to.y - at.y),
      "the light never passes its target",
    );
    at = next;
    frames += 1;
    assert(frames < 120, "the light arrives, so a still pointer costs nothing");
  }

  // The same distance takes the same time whatever the frame rate.
  const oneLongFrame = lightStep(from, to, 3 * FRAME, PACE.ease);
  let threeShort = from;
  for (let frame = 0; frame < 3; frame++) {
    threeShort = lightStep(threeShort, to, FRAME, PACE.ease);
  }
  assert(Math.abs(oneLongFrame.x - threeShort.x) < 1e-6);
  assert(Math.abs(oneLongFrame.y - threeShort.y) < 1e-6);
});

Deno.test("the light comes up where the pointer is and goes down where it stands", () => {
  const pointer = { x: 600, y: 400 };
  let light: Light = { at: { x: -40, y: 90 }, on: 0 };

  light = lightFrame(light, pointer, FRAME, PACE);
  assertStrictEquals(light.at, pointer, "a dark light comes up at the pointer");
  assert(light.on > 0 && light.on < 1, "it comes up over several frames");
  let frames = 1;
  while (light.on < 1) {
    const next = lightFrame(light, pointer, FRAME, PACE);
    assertStrictEquals(next.at, pointer, "it does not travel as it comes up");
    assert(next.on > light.on, "it only brightens");
    light = next;
    assert(++frames < 60, "it finishes coming up");
  }
  assertEquals(light.on, 1, "it stops exactly at full");
  assert(frames >= PACE.fade / FRAME, "it takes the whole fade to come up");
  assertEquals(
    lightFrame(light, pointer, FRAME, PACE),
    light,
    "a light at rest on a still pointer has nothing left to write",
  );

  const stood = light.at;
  while (light.on > 0) {
    const next = lightFrame(light, null, FRAME, PACE);
    assertStrictEquals(next.at, stood, "it goes down where it stands");
    assert(next.on < light.on, "it only dims");
    light = next;
  }
  assertEquals(light.on, 0, "it stops exactly at dark");
});

Deno.test("the light follows the pointer only as far as its own size", () => {
  const home = { x: 100, y: 100 };
  const reachable = { x: home.x + PACE.span, y: home.y };
  const followed = lightFrame({ at: home, on: 1 }, reachable, FRAME, PACE);
  assert(
    followed.at.x > home.x && followed.at.x < reachable.x,
    "a pointer within its size draws the light toward it",
  );
  assertEquals(followed.on, 1, "and the light stays up on the way");

  // A pointer suddenly farther off than that is not followed. The light goes
  // down at home and comes up at the pointer, and is never seen in between.
  const far = { x: reachable.x + 1, y: home.y };
  let light: Light = { at: home, on: 1 };
  const places = new Set<number>();
  let wentDark = false;
  for (let frames = 0; frames < 120 && light.at !== far; frames++) {
    light = lightFrame(light, far, FRAME, PACE);
    if (light.on > 0) places.add(light.at.x);
    wentDark ||= light.on === 0;
  }
  assertStrictEquals(light.at, far, "the light reaches a far pointer");
  assert(wentDark, "it goes dark before it changes place");
  assertEquals([...places], [home.x, far.x], "it is seen in two places only");

  // A pointer that comes back within its size while it dims is followed
  // again, and the light comes back up from where it had got to.
  const dimming = lightFrame({ at: home, on: 1 }, far, FRAME, PACE);
  const back = lightFrame(dimming, reachable, FRAME, PACE);
  assert(back.on > dimming.on && back.at.x > home.x);
});

Deno.test("a card is as far from the light as its nearest edge", () => {
  const box = { left: 100, top: 50, right: 300, bottom: 150 };
  assertEquals(lightGap({ x: 200, y: 100 }, box), 0, "inside it");
  assertEquals(lightGap({ x: 100, y: 150 }, box), 0, "on its corner");
  assertEquals(lightGap({ x: 60, y: 100 }, box), 40, "off its left edge");
  assertEquals(lightGap({ x: 200, y: 170 }, box), 20, "below it");
  assertEquals(lightGap({ x: 303, y: 46 }, box), 5, "off a corner");
});

/**
 * Every custom property script writes while the pointer moves, from the
 * modules that write them.
 */
const FRAME_PROPERTIES: readonly string[] = [
  ...LIGHT_PROPERTIES.room,
  ...LIGHT_PROPERTIES.card,
  ...POINTER_PROPERTIES,
];

/**
 * Every custom property script sets on a box of the live page, by the module
 * that sets it. The light and the card write theirs on every frame of
 * pointer travel. The opened card writes its one on the page's root as a
 * sheet opens, and removes it as the sheet closes.
 */
const SCRIPT_WRITTEN: Readonly<Record<string, readonly string[]>> = {
  "site/wall/use_light.ts": [
    ...LIGHT_PROPERTIES.room,
    ...LIGHT_PROPERTIES.card,
  ],
  "site/wall/Card.tsx": POINTER_PROPERTIES,
  "site/wall/OpenCard.tsx": [SCROLLBAR_ROOM],
};

/** One block of declarations in a wall stylesheet, with the sheet it is in. */
interface StyleBlock extends StyleRule {
  readonly sheet: string;
}

/**
 * Every block of declarations in every wall stylesheet: each style rule, and
 * each `@property` that registers a custom property.
 */
async function wallBlocks(): Promise<StyleBlock[]> {
  const blocks = (await wallSheets()).flatMap(({ sheet, text }) =>
    styleRules(text).map((rule) => ({ sheet, ...rule }))
  );
  assert(blocks.length > 0, "the wall stylesheets hold rules");
  return blocks;
}

/** Whether each registered custom property inherits, by its name. */
function registrations(blocks: readonly StyleBlock[]): Map<string, boolean> {
  const inherits = new Map<string, boolean>();
  for (const block of blocks) {
    const name = /^@property (--[\w-]+)$/.exec(block.prelude)?.[1];
    if (name === undefined) continue;
    const declared = block.declarations.find(([property]) =>
      property === "inherits"
    )?.[1];
    assert(
      declared === "true" || declared === "false",
      `${block.sheet}: ${name} says whether it inherits`,
    );
    inherits.set(name, declared === "true");
  }
  return inherits;
}

Deno.test("every value script writes on the live page is registered so that it does not inherit", async () => {
  const blocks = await wallBlocks();
  const inherits = registrations(blocks);
  const written = Object.values(SCRIPT_WRITTEN).flat();
  assert(FRAME_PROPERTIES.every((name) => written.includes(name)));
  for (const name of written) {
    assertEquals(
      inherits.get(name),
      false,
      `script writes ${name}, so an inheriting ${name} restyles everything under the box it is written on at every write`,
    );
  }

  // A module that sets a property on a box of the page names what it sets
  // above, so a new one cannot write an inheriting value unseen.
  const sources = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_light_test.ts#inline-property-writers",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only the site's own modules run in a visitor's browser, where a style written by script restyles the page.",
        include: (path) => path.startsWith("site/"),
      },
    }),
  );
  const writers = sources.filter(({ source }) =>
    source.includes(".style.setProperty(")
  );
  assertEquals(
    writers.map(({ path }) => path).toSorted(),
    Object.keys(SCRIPT_WRITTEN).toSorted(),
    "each module that sets a property on a box of the page enrols the names it sets",
  );
  for (const { path, source } of writers) {
    for (const name of SCRIPT_WRITTEN[path] ?? []) {
      assert(source.includes(`"${name}"`), `${path} names ${name}`);
    }
  }

  // The opened card writes its value on the page's root, and a value that
  // does not inherit reaches no other box. A rule that read it anywhere else
  // would read the registered length of nothing.
  const readers = blocks.filter((block) =>
    block.declarations.some(([, value]) =>
      value.includes(`var(${SCROLLBAR_ROOM})`)
    )
  );
  assert(readers.length > 0, `${SCROLLBAR_ROOM} pads the page`);
  assertEquals(
    readers.flatMap((block) =>
      block.selectors.filter((selector) =>
        !/^:root(?![\w-])\S*$/.test(selector)
      )
        .map((selector) =>
          `${block.sheet}: ${selector} reads ${SCROLLBAR_ROOM} off the root`
        )
    ),
    [],
  );
  // How far the light reaches is the stylesheet's to say, and script reads
  // it as a length only because it is registered as one.
  assert(inherits.has(LIGHT_REACH), `${LIGHT_REACH} is registered`);
});

const ORIGIN = "http://127.0.0.1:18903";
const VIEWPORT = { width: 1440, height: 900 };

/** A viewport point in the page's margin, off the wall. */
const OFF_WALL = { x: 2, y: VIEWPORT.height - 2 };

/** Open the homepage in a laptop viewport and bring the wall near. */
async function onTheWall(
  options: BrowserContextOptions,
  check: (page: Page, browser: Browser) => Promise<void>,
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
    await tallyLightCalls(page);
    await serveThroughHandler(page, ORIGIN, handler);
    await page.goto(`${ORIGIN}/`);
    await page.locator(".wall-stage").evaluate((stage) =>
      stage.scrollIntoView({ block: "start", behavior: "instant" })
    );
    await page.locator(NEAR_WALL).waitFor();
    await drawn(page, 3);
    await check(page, browser);
  } finally {
    await browser.close();
  }
}

/** Where the page keeps its tally of the light's writes, for these checks. */
const LIGHT_CALLS = "wallLightCalls";

/**
 * Count every call the page's script makes to set or remove one of the
 * light's properties, from before that script runs. A call that writes the
 * value already there counts too, so a light that kept working on a still
 * pointer would show here though nothing on the page changed.
 */
async function tallyLightCalls(page: Page): Promise<void> {
  const names: readonly string[] = [
    ...LIGHT_PROPERTIES.room,
    ...LIGHT_PROPERTIES.card,
  ];
  await page.addInitScript(({ names, key }) => {
    const tally = { calls: 0 };
    Reflect.set(globalThis, key, tally);
    const counted = <Call extends (name: string, ...rest: string[]) => unknown>(
      call: Call,
    ): Call =>
      new Proxy(call, {
        apply(target, style, args): unknown {
          if (names.includes(String(args[0]))) tally.calls++;
          return Reflect.apply(target, style, args);
        },
      });
    const styles = CSSStyleDeclaration.prototype;
    styles.setProperty = counted(styles.setProperty);
    styles.removeProperty = counted(styles.removeProperty);
  }, { names, key: LIGHT_CALLS });
}

/**
 * Record what the light writes on the wall root from now on: its place and
 * how far it is up, once per change. An empty value is a removed property.
 */
function watchLight(page: Page): Promise<JSHandle<string[][]>> {
  return page.locator(".wall").evaluateHandle((root, names) => {
    const seen: string[][] = [];
    if (!(root instanceof HTMLElement)) return seen;
    new MutationObserver(() => {
      seen.push(names.map((name) => root.style.getPropertyValue(name)));
    }).observe(root, { attributes: true, attributeFilter: ["style"] });
    return seen;
  }, [...LIGHT_PROPERTIES.room]);
}

Deno.test("the light comes up under the pointer, goes down where it was, and never crosses the wall", async () => {
  await onTheWall({}, async (page) => {
    const [, , on] = LIGHT_PROPERTIES.room;
    const gone = (): Promise<unknown> =>
      page.waitForFunction(
        (on) =>
          document.querySelector<HTMLElement>(".wall")?.style
            .getPropertyValue(on) === "",
        on,
      );
    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    await drawn(page, 2);

    // Arriving: the pointer lands on the wall in one move.
    const first = { x: 300, y: 320 };
    const here = await placeOnWall(page, first);
    const arriving = await watchLight(page);
    await page.mouse.move(first.x, first.y);
    await lightSettled(page);
    const up = await arriving.jsonValue();
    assert(up.length >= 4, "the light comes up over several frames");
    for (const write of up) {
      assert(
        isAt(write, here),
        `the light was written at ${write}, off the pointer`,
      );
    }
    const rising = up.map(([, , level]) => Number(level));
    assert((rising[0] ?? 1) < 0.5, "it starts dim");
    assertEquals(rising, rising.toSorted((a, b) => a - b), "it only brightens");
    assertEquals(up.at(-1)?.[2], "1.000");

    // A jump across the wall, farther than the light's own size: it goes
    // down where it was and comes up at the pointer, and is nowhere between.
    const second = { x: 1240, y: 700 };
    const there = await placeOnWall(page, second);
    const jumping = await watchLight(page);
    await page.mouse.move(second.x, second.y);
    await page.waitForFunction(
      ({ on, x, there }) => {
        const style = document.querySelector<HTMLElement>(".wall")?.style;
        return style?.getPropertyValue(on) === "1.000" &&
          Math.abs(parseFloat(style.getPropertyValue(x)) - there) <= 0.6;
      },
      { on, x: LIGHT_PROPERTIES.room[0], there: there.x },
    );
    const jump = await jumping.jsonValue();
    const arrival = jump.findIndex((write) => isAt(write, there));
    assert(arrival > 1, "the light dims before it changes place");
    for (const [index, write] of jump.entries()) {
      assert(
        isAt(write, index < arrival ? here : there),
        `the light was written at ${write}, between the two places`,
      );
    }
    assertEquals(Number(jump[arrival - 1]?.[2]), 0, "it is dark when it moves");

    // Leaving: it goes down where it stood, then takes its properties away.
    const leaving = await watchLight(page);
    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    await gone();
    const down = await leaving.jsonValue();
    const dimming = down.filter(([, , level]) => level !== "");
    assert(dimming.length >= 4, "the light goes down over several frames");
    for (const write of dimming) {
      assert(isAt(write, there), `the light left by way of ${write}`);
    }
    const falling = dimming.map(([, , level]) => Number(level));
    assertEquals(falling, falling.toSorted((a, b) => b - a), "it only dims");
    assertEquals(down.at(-1), ["", "", ""], "it leaves nothing written");
    assertEquals(
      await page.locator(`.${CARD_LIGHT}`).evaluateAll((boxes) =>
        boxes.filter((box) =>
          box instanceof HTMLElement && box.style.length > 0
        ).length
      ),
      0,
      "no card keeps a light the wall has lost",
    );
  });
});

Deno.test("a visitor who asks for less motion sees the light appear and go, with no fade", async () => {
  await onTheWall({ reducedMotion: "reduce" }, async (page) => {
    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    await drawn(page, 2);
    const watching = await watchLight(page);
    await page.mouse.move(300, 320);
    await lightSettled(page);

    // One move of the pointer, well within the light's own size, and then
    // stillness: the light is written once, where the pointer went.
    const next = { x: 600, y: 360 };
    const there = await placeOnWall(page, next);
    const moving = await watchLight(page);
    await page.mouse.move(next.x, next.y);
    await lightSettled(page);
    await drawn(page, 6);
    const moves = await moving.jsonValue();
    assertEquals(moves.length, 1, `one move wrote the light at ${moves}`);
    assert(isAt(moves[0] ?? [], there), "and wrote it where the pointer is");

    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    await page.waitForFunction(
      (on) =>
        document.querySelector<HTMLElement>(".wall")?.style.getPropertyValue(
          on,
        ) === "",
      LIGHT_PROPERTIES.room[2],
    );
    const levels = (await watching.jsonValue()).map(([, , level]) => level);
    assert(levels.includes("1.000"), "the light appeared");
    assertEquals(
      levels.filter((level) => level !== "1.000" && level !== ""),
      [],
      "it was never part of the way up",
    );
  });
});
