/**
 * The wall's pointer light costs the same however many cards the wall holds,
 * and it comes and goes without crossing the page.
 *
 * Three layers hold that. The light's own arithmetic is checked as plain
 * functions. The stylesheets are held to one rule about every value script
 * writes while the pointer moves: it is registered so that it does not
 * inherit, so a new value restyles the box that carries it and never the
 * subtree below. And a real browser counts what a frame of pointer travel
 * restyles, on the wall as built and on a wall twice the size.
 *
 * The same browser checks what stands in for the light where light means
 * nothing: forced colors, where the bar over the wall needs a solid backing,
 * and paper, where the room is a plain sheet. And it checks the one style
 * the browser works out for every element it restyles, selected text, which
 * the room must keep both readable and cheap.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import type {
  Browser,
  BrowserContextOptions,
  JSHandle,
  Page,
} from "playwright-core";
import { handler } from "../site/serve.ts";
import { WALL_STYLESHEETS } from "../site/wall/assets.ts";
import { CARD_LIGHT, POINTER_PROPERTIES } from "../site/wall/Card.tsx";
import {
  type Light,
  LIGHT_PROPERTIES,
  LIGHT_REACH,
  lightFrame,
  lightGap,
  type LightPace,
} from "../site/wall/use_light.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** How the light keeps pace in these checks: the shipped shape of it. */
const PACE: LightPace = { ease: 80, fade: 240, span: 520 };

/** One frame at sixty to the second, in milliseconds. */
const FRAME = 16;

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

Deno.test("a visitor who asks for less motion gets the light at once", () => {
  const cut: LightPace = { ...PACE, fade: 0 };
  const pointer = { x: 600, y: 400 };
  assertEquals(
    lightFrame({ at: { x: 0, y: 0 }, on: 0 }, pointer, FRAME, cut),
    { at: pointer, on: 1 },
  );
  assertEquals(lightFrame({ at: pointer, on: 1 }, null, FRAME, cut).on, 0);
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

/** One innermost block of a stylesheet: what introduces it, and its body. */
interface StyleBlock {
  readonly sheet: string;
  /** A selector list, or the at-rule that names a registered property. */
  readonly prelude: string;
  /** Each declaration as its property and its value. */
  readonly declarations: readonly (readonly [string, string])[];
}

/** Every innermost block of every wall stylesheet, comments removed. */
async function wallBlocks(): Promise<StyleBlock[]> {
  const blocks: StyleBlock[] = [];
  for (const sheet of WALL_STYLESHEETS) {
    const text = (await Deno.readTextFile(join(ROOT, "site/page-src", sheet)))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (
      const [, prelude = "", body = ""] of text.matchAll(
        /([^{}]+)\{([^{}]*)\}/g,
      )
    ) {
      blocks.push({
        sheet,
        prelude: prelude.replace(/\s+/g, " ").trim(),
        declarations: body.split(";").flatMap((declaration) => {
          const colon = declaration.indexOf(":");
          return colon === -1 ? [] : [
            [
              declaration.slice(0, colon).trim(),
              declaration.slice(colon + 1).replace(/\s+/g, " ").trim(),
            ] as const,
          ];
        }),
      });
    }
  }
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

/** The box each selector of a block styles: its last compound selector. */
function subjects(block: StyleBlock): string[] {
  return block.prelude.split(",").map((selector) =>
    selector.trim().split(/\s*[>+~]\s*|\s+/).at(-1) ?? ""
  );
}

Deno.test("every value script writes while the pointer moves is registered so that it does not inherit", async () => {
  const blocks = await wallBlocks();
  const inherits = registrations(blocks);
  assert(FRAME_PROPERTIES.length > 0);
  for (const name of FRAME_PROPERTIES) {
    assertEquals(
      inherits.get(name),
      false,
      `${name} is written every frame, so an inheriting ${name} restyles everything under the box it is written on, every frame`,
    );
  }
  // How far the light reaches is the stylesheet's to say, and script reads
  // it as a length only because it is registered as one.
  assert(inherits.has(LIGHT_REACH), `${LIGHT_REACH} is registered`);
});

Deno.test("no state of the wall root changes a value that everything inherits", async () => {
  const blocks = await wallBlocks();
  const inherits = registrations(blocks);
  // The root gains and loses these attributes as the page is used: the wall
  // arrives, a lens is chosen, the island comes alive. A custom property set
  // by one of those states changes with it, and one that inherits takes the
  // whole wall with it, in the very frame the state changes.
  const state =
    /^\.wall(?:\[data-wall-[\w-]+(?:=[^\]]*)?\]|:not\(\[data-wall-[\w-]+\]\))+$/;
  const stated = blocks.filter((block) =>
    block.prelude.split(",").some((selector) => state.test(selector.trim()))
  );
  assert(
    stated.some((block) =>
      block.declarations.some(([property]) => property === LIGHT_REACH)
    ),
    "the wall's arrival sets how far the light reaches",
  );
  assertEquals(
    stated.flatMap((block) =>
      block.declarations.filter(([property]) =>
        property.startsWith("--") && inherits.get(property) !== false
      ).map(([property]) => `${block.sheet}: ${block.prelude} { ${property} }`)
    ),
    [],
  );
});

Deno.test("only a box that reads a value written every frame takes it, and nothing passes one on", async () => {
  const blocks = await wallBlocks();
  const inherits = registrations(blocks);
  const reads = (block: StyleBlock, name: string): boolean =>
    block.declarations.some(([, value]) => value.includes(`var(${name})`));
  const violations: string[] = [];
  let asked = 0;
  for (const name of FRAME_PROPERTIES) {
    for (const block of blocks) {
      // Asking for the value by name restyles the asker every frame, so the
      // asker must be a box that draws with it.
      if (
        block.declarations.some(([property, value]) =>
          property === name && value === "inherit"
        )
      ) {
        asked++;
        for (const subject of subjects(block)) {
          const drawsWith = blocks.some((other) =>
            subjects(other).includes(subject) && reads(other, name)
          );
          if (!drawsWith) {
            violations.push(
              `${block.sheet}: ${subject} takes ${name} and never reads it`,
            );
          }
        }
      }
      // A custom property built from the value changes as often as it does.
      // Unless it is itself registered not to inherit, it carries the value
      // to every descendant after all.
      for (const [property, value] of block.declarations) {
        if (
          property.startsWith("--") && value.includes(`var(${name})`) &&
          inherits.get(property) !== false
        ) {
          violations.push(
            `${block.sheet}: ${block.prelude} builds the inheriting ${property} from ${name}`,
          );
        }
      }
    }
  }
  assertEquals(violations, []);
  assert(
    asked > 0,
    "the room's light and a card's face take their values by name",
  );
});

/** The pseudo-elements that style a highlight laid over text. */
const HIGHLIGHT =
  /::(?:selection|target-text|search-text|spelling-error|grammar-error|highlight\()/;

Deno.test("the room names its own selection colors, and no highlight in it reads a site token", async () => {
  const blocks = await wallBlocks();
  const highlights = blocks.filter((block) => HIGHLIGHT.test(block.prelude));

  // The browser works out an element's selection style every time it
  // restyles that element. One that reads a site token is slow to work out,
  // and the site's own rule reads two, so the room overrides both of them
  // for itself and for everything inside it.
  const room = highlights.find((block) => {
    const covered = block.prelude.split(",").map((selector) => selector.trim());
    return covered.includes(".wall::selection") &&
      covered.includes(".wall ::selection");
  });
  assert(room !== undefined, "the room styles its own selected text");
  const named = new Map(room.declarations);
  assertEquals(
    named.get("color"),
    "currentcolor",
    "selected words keep the color they have",
  );
  assert(named.has("background"), "selected words stand on the room's wash");

  assertEquals(
    highlights.flatMap((block) =>
      block.declarations.filter(([, value]) => value.includes("var(--discern-"))
        .map(([property]) => `${block.sheet}: ${block.prelude} { ${property} }`)
    ),
    [],
    "a highlight that reads a site token makes every restyle in the room dearer",
  );
});

const ORIGIN = "http://127.0.0.1:18903";
const VIEWPORT = { width: 1440, height: 900 };

/** A viewport point in the page's margin, off the wall. */
const OFF_WALL = { x: 2, y: VIEWPORT.height - 2 };

/** The live wall with its plane flat: the state the pointer light is for. */
const NEAR_WALL = ".wall[data-wall-live][data-wall-near]";

/**
 * The most elements one style recalculation may touch while the pointer
 * crosses the flat wall. The light restyles the room's root and one box in
 * each card near the pointer; the card under the pointer restyles its face;
 * and a card the pointer enters or leaves restyles once, whole. The browser
 * counts each element's highlight styles too. None of that grows with the
 * wall, which holds some fifteen hundred elements by the same count.
 */
const RESTYLE_BUDGET = 96;

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

/** How many times the page has written one of the light's properties so far. */
function lightCalls(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const tally: unknown = Reflect.get(globalThis, key);
    return typeof tally === "object" && tally !== null && "calls" in tally &&
        typeof tally.calls === "number"
      ? tally.calls
      : Number.NaN;
  }, LIGHT_CALLS);
}

/** Resolve once the page has drawn `frames` more frames. */
function drawn(page: Page, frames: number): Promise<void> {
  return page.evaluate((frames) =>
    new Promise<void>((resolve) => {
      const next = (left: number): void => {
        if (left === 0) resolve();
        else requestAnimationFrame(() => next(left - 1));
      };
      next(frames);
    }), frames);
}

/**
 * Resolve once the light is fully up and has stopped writing: what it wrote
 * on the wall root has stayed the same over several frames.
 */
function lightSettled(page: Page): Promise<void> {
  return page.locator(".wall").evaluate(
    (root, names) =>
      new Promise<void>((resolve) => {
        let last = "";
        let still = 0;
        const look = (): void => {
          const now = names.map((name) => root.style.getPropertyValue(name))
            .join(" ");
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 3 && now.endsWith(" 1.000")) resolve();
          else requestAnimationFrame(look);
        };
        look();
      }),
    [...LIGHT_PROPERTIES.room],
  );
}

/** Resolve once no animation or transition on the page is still running. */
async function motionDone(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) =>
      animation.playState !== "running"
    )
  );
}

/** Whether a parsed trace value is an object with named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * How many elements each style recalculation touched while `act` ran, as the
 * browser's own trace reports it.
 */
async function restyled(
  browser: Browser,
  page: Page,
  act: () => Promise<void>,
): Promise<number[]> {
  await browser.startTracing(page, {
    categories: ["devtools.timeline", "blink"],
  });
  let trace: Uint8Array;
  try {
    await act();
    await drawn(page, 2);
  } finally {
    trace = await browser.stopTracing();
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(trace));
  const events = isRecord(parsed) ? parsed["traceEvents"] : parsed;
  assert(Array.isArray(events), "the browser returned a trace");
  const counts: number[] = [];
  for (const event of events) {
    if (!isRecord(event) || event["name"] !== "UpdateLayoutTree") continue;
    const args = event["args"];
    const count = isRecord(args) ? args["elementCount"] : undefined;
    if (typeof count === "number" && count > 0) counts.push(count);
  }
  return counts;
}

/** Cross the visible wall three times, over cards and the gaps between them. */
async function sweep(page: Page): Promise<void> {
  for (const y of [190, 400, 610]) {
    await page.mouse.move(40, y);
    await page.mouse.move(VIEWPORT.width - 40, y + 80, { steps: 40 });
  }
}

Deno.test("the wall arrives and leaves without restyling its cards", async () => {
  await onTheWall({}, async (page, browser) => {
    const far = ".wall[data-wall-live]:not([data-wall-near])";
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.locator(far).waitFor();
    await drawn(page, 3);
    // The pointer rests where the wall will be, so the light is at work too.
    await page.mouse.move(700, 430);
    await lightSettled(page);

    const arriving = await restyled(browser, page, async () => {
      await page.locator(".wall-stage").evaluate((stage) =>
        stage.scrollIntoView({ block: "start", behavior: "instant" })
      );
      await page.locator(NEAR_WALL).waitFor();
    });
    assert(arriving.length > 0, "arriving restyled something");
    // The pointer has not moved, and the cards now under it catch the light.
    await lightSettled(page);
    assert(
      await page.locator(`.${CARD_LIGHT}`).evaluateAll((boxes) =>
        boxes.filter((box) =>
          box instanceof HTMLElement && box.style.length > 0
        ).length
      ) > 0,
      "a wall that arrives under a still pointer takes its light",
    );
    assert(
      Math.max(...arriving) <= RESTYLE_BUDGET,
      `as the wall arrived one style recalculation touched ${
        Math.max(...arriving)
      } elements`,
    );

    const leaving = await restyled(browser, page, async () => {
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.locator(far).waitFor();
    });
    assert(
      Math.max(...leaving) <= RESTYLE_BUDGET,
      `as the wall left one style recalculation touched ${
        Math.max(...leaving)
      } elements`,
    );
  });
});

Deno.test("a frame of pointer travel restyles a few boxes, however many cards the wall holds", async () => {
  await onTheWall({}, async (page, browser) => {
    const wall = await page.locator(".wall *").count();
    assert(
      wall > RESTYLE_BUDGET * 4,
      "the budget is a small share of the wall, so a restyle of the wall cannot pass",
    );

    // Record every inline custom property the sweep changes anywhere in the
    // wall, so a value some module starts writing per frame cannot go
    // unnoticed by the stylesheet rule above.
    const written = await page.evaluateHandle(() => {
      const names = new Set<string>();
      const pairs = (style: string | null): Map<string, string> =>
        new Map(
          (style ?? "").split(";").flatMap((pair) => {
            const colon = pair.indexOf(":");
            const name = pair.slice(0, Math.max(colon, 0)).trim();
            return name.startsWith("--")
              ? [[name, pair.slice(colon + 1).trim()] as const]
              : [];
          }),
        );
      const wall = document.querySelector(".wall");
      if (wall === null) return names;
      new MutationObserver((records) => {
        for (const record of records) {
          if (!(record.target instanceof Element)) continue;
          const before = pairs(record.oldValue);
          const after = pairs(record.target.getAttribute("style"));
          for (const name of new Set([...before.keys(), ...after.keys()])) {
            if (before.get(name) !== after.get(name)) names.add(name);
          }
        }
      }).observe(wall, {
        attributes: true,
        attributeFilter: ["style"],
        attributeOldValue: true,
        subtree: true,
      });
      return names;
    });

    const asBuilt = await restyled(browser, page, () => sweep(page));
    assert(asBuilt.length > 40, "the sweep restyled the page many times");
    assert(
      Math.max(...asBuilt) <= RESTYLE_BUDGET,
      `one style recalculation touched ${Math.max(...asBuilt)} elements`,
    );
    assertEquals(
      (await written.evaluate((names) => [...names])).toSorted(),
      FRAME_PROPERTIES.toSorted(),
      "script wrote exactly the values the hooks declare as written per frame",
    );

    // Where the sweep ended, the light is on the cards near the pointer and
    // on no other: the border of a card across the wall is left alone.
    const end = { x: 700, y: 430 };
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await lightSettled(page);
    const lit = await page.evaluate(
      ({ end, light, reach, card: [x, y, on] }) => {
        const root = document.querySelector<HTMLElement>(".wall");
        const span = root === null
          ? 0
          : parseFloat(getComputedStyle(root).getPropertyValue(reach));
        return [...document.querySelectorAll<HTMLElement>(`.${light}`)].map(
          (box) => {
            const rect = box.getBoundingClientRect();
            const gap = Math.hypot(
              Math.max(rect.left - end.x, 0, end.x - rect.right),
              Math.max(rect.top - end.y, 0, end.y - rect.bottom),
            );
            return {
              gap,
              span,
              on: box.style.getPropertyValue(on ?? ""),
              off: [
                parseFloat(box.style.getPropertyValue(x ?? "")) -
                (end.x - rect.left),
                parseFloat(box.style.getPropertyValue(y ?? "")) -
                (end.y - rect.top),
              ],
            };
          },
        );
      },
      {
        end,
        light: CARD_LIGHT,
        reach: LIGHT_REACH,
        card: [...LIGHT_PROPERTIES.card],
      },
    );
    const near = lit.filter((card) => card.gap < card.span - 2);
    const beyond = lit.filter((card) => card.gap > card.span + 2);
    assert(near.length >= 4, "the pointer sits among several cards");
    assert(beyond.length > near.length * 4, "most of the wall is out of reach");
    for (const card of near) {
      assertEquals(card.on, "1.000", "a card in reach catches the light");
      // The light is placed on the face as laid out. The face under the
      // pointer is drawn lifted and tilted a pixel or three from there.
      assert(
        Math.max(...card.off.map(Math.abs)) <= 4,
        `the light sits ${card.off} from the pointer on a card's border`,
      );
    }
    assertEquals(
      beyond.filter((card) => card.on !== "").length,
      0,
      "a card out of reach is not written to",
    );

    // Twice the cards, and the same fixed budget: a cost that grew with the
    // wall would be twice over it.
    await page.mouse.move(OFF_WALL.x, OFF_WALL.y);
    await page.locator(".wall-list").evaluate((list) => {
      for (const card of [...list.children]) list.append(card.cloneNode(true));
    });
    assertEquals(await page.locator(".wall *").count() > wall * 1.8, true);
    await drawn(page, 3);
    const doubled = await restyled(browser, page, () => sweep(page));
    assert(
      Math.max(...doubled) <= RESTYLE_BUDGET,
      `with twice the cards one style recalculation touched ${
        Math.max(...doubled)
      } elements`,
    );
  });
});

/** Where a viewport point lies from the wall root's corner, as the light writes it. */
function placeOnWall(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  return page.locator(".wall").evaluate((root, point) => {
    const rect = root.getBoundingClientRect();
    return {
      x: point.x - rect.left - root.clientLeft,
      y: point.y - rect.top - root.clientTop,
    };
  }, point);
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

/** Whether a recorded place is `place`, to within the light's own rounding. */
function isAt(
  [x = "", y = ""]: readonly string[],
  place: { readonly x: number; readonly y: number },
): boolean {
  return Math.abs(parseFloat(x) - place.x) <= 0.6 &&
    Math.abs(parseFloat(y) - place.y) <= 0.6;
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

Deno.test("the light writes nothing while the pointer rests or is over an opened card", async () => {
  await onTheWall({}, async (page) => {
    await page.mouse.move(520, 400, { steps: 3 });
    await lightSettled(page);
    const moved = await lightCalls(page);
    assert(moved > 0, "the light followed the pointer onto the wall");
    await drawn(page, 12);
    assertEquals(await lightCalls(page), moved, "a still pointer");

    await page.mouse.click(520, 400);
    await page.locator("dialog.wall-open:modal").waitFor();
    await motionDone(page);
    await drawn(page, 2);
    const opened = await lightCalls(page);
    await page.mouse.move(760, 470, { steps: 8 });
    await drawn(page, 4);
    assertEquals(
      await lightCalls(page),
      opened,
      "a pointer over the opened card",
    );
  });
});

Deno.test("a finger never moves the light", async () => {
  await onTheWall({ hasTouch: true }, async (page) => {
    const moves = await page.locator(".wall").evaluateHandle((root) => {
      const seen = { fingers: 0 };
      root.addEventListener("pointermove", (event) => {
        if (event instanceof PointerEvent && event.pointerType === "touch") {
          seen.fingers++;
        }
      });
      return seen;
    });
    // A finger set down on the wall and drawn across it.
    const touch = await page.context().newCDPSession(page);
    const at = (x: number): Promise<unknown> =>
      touch.send("Input.dispatchTouchEvent", {
        type: x === 300 ? "touchStart" : "touchMove",
        touchPoints: [{ x, y: 420 }],
      });
    for (const x of [300, 330, 360, 390, 420, 450]) await at(x);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await drawn(page, 6);
    assert((await moves.jsonValue()).fingers > 0, "the wall felt the finger");
    assertEquals(await lightCalls(page), 0);
  });
});

Deno.test("in forced colors every bar that stays over the wall has a solid backing", async () => {
  await onTheWall({ forcedColors: "active" }, async (page) => {
    const bars = await page.evaluate(() => {
      const ink = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      const clear = (color: string): boolean => {
        if (ink === null) return true;
        ink.clearRect(0, 0, 1, 1);
        ink.fillStyle = color;
        ink.fillRect(0, 0, 1, 1);
        return (ink.getImageData(0, 0, 1, 1).data[3] ?? 0) < 255;
      };
      const stays = (element: Element): boolean =>
        getComputedStyle(element).position === "sticky";
      const backed = (element: Element): boolean =>
        [undefined, "::before"].some((pseudo) => {
          const style = getComputedStyle(element, pseudo);
          return (pseudo === undefined || style.content !== "none") &&
            !clear(style.backgroundColor);
        });
      return [...document.querySelectorAll(".wall *")].filter((element) =>
        stays(element) && element.getClientRects().length > 0
      ).map((bar) => {
        // A bar inside another bar stands on that bar's backing.
        let backing: Element | null = bar;
        while (backing !== null && !(stays(backing) && backed(backing))) {
          backing = backing.parentElement?.closest(".wall *") ?? null;
        }
        return { bar: bar.className, backed: backing !== null };
      });
    });
    assert(bars.length > 0, "the lens bar stays over the wall");
    assertEquals(
      bars.filter((bar) => !bar.backed).map((bar) => bar.bar),
      [],
      "cards would show through these as they pass under",
    );
  });
});

Deno.test("on paper the room is a plain sheet with nothing left over the cards", async () => {
  await onTheWall({ colorScheme: "dark" }, async (page) => {
    await page.emulateMedia({ media: "print" });
    await motionDone(page);
    const marks = await page.evaluate(() => {
      // Paper is light: a surface is plain when it is clear or near white.
      // A canvas reads any color the browser can compute as plain numbers.
      const ink = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      const plain = (color: string): boolean => {
        if (ink === null) return false;
        ink.clearRect(0, 0, 1, 1);
        ink.fillStyle = color;
        ink.fillRect(0, 0, 1, 1);
        const [red = 0, green = 0, blue = 0, alpha = 0] =
          ink.getImageData(0, 0, 1, 1).data;
        return alpha === 0 || Math.min(red, green, blue) >= 240;
      };
      const found: string[] = [];
      const room = [
        document.documentElement,
        document.body,
        ...document.querySelectorAll("main, main *"),
      ];
      for (const element of room) {
        if (element.getClientRects().length === 0) continue;
        const name = `${element.tagName.toLowerCase()}.${element.classList}`;
        const position = getComputedStyle(element).position;
        if (position === "sticky" || position === "fixed") {
          found.push(`${name} stays put down the pages`);
        }
        for (const pseudo of [undefined, "::before", "::after"]) {
          const style = getComputedStyle(element, pseudo);
          if (pseudo !== undefined && style.content === "none") continue;
          if (style.display === "none") continue;
          const part = `${name}${pseudo ?? ""}`;
          if (style.backgroundImage !== "none") {
            found.push(`${part} paints ${style.backgroundImage.slice(0, 40)}`);
          }
          if (!plain(style.backgroundColor)) {
            found.push(`${part} is ${style.backgroundColor}`);
          }
        }
      }
      return found;
    });
    assertEquals(marks, []);

    // The cards are still all there, flat, in the page's own flow.
    assertEquals(
      await page.locator(".wall-plane").evaluate((plane) =>
        getComputedStyle(plane).transform
      ),
      "none",
    );
    const cards = await page.locator(".wall-list > .wall-card").evaluateAll((
      all,
    ) => all.filter((card) => card.getClientRects().length > 0).length);
    assert(cards > 0);
    assertEquals(cards, await page.locator(".wall-list > .wall-card").count());
  });
});

Deno.test("selected words stay readable in the room, whichever theme the site wears", async () => {
  for (const colorScheme of ["light", "dark"] as const) {
    await onTheWall({ colorScheme }, async (page) => {
      const lost = await page.evaluate(() => {
        // Every element in the room that holds words of its own.
        const worded = [...document.querySelectorAll(".wall, .wall *")].filter(
          (element) =>
            element.getClientRects().length > 0 &&
            [...element.childNodes].some((node) =>
              node.nodeType === Node.TEXT_NODE &&
              (node.textContent ?? "").trim() !== ""
            ),
        );
        const ink = document.createElement("canvas").getContext("2d", {
          willReadFrequently: true,
        });
        const rgba = (color: string): string => {
          if (ink === null) return color;
          ink.clearRect(0, 0, 1, 1);
          ink.fillStyle = color;
          ink.fillRect(0, 0, 1, 1);
          return ink.getImageData(0, 0, 1, 1).data.join(",");
        };
        return {
          worded: worded.length,
          changed: worded.filter((element) =>
            rgba(getComputedStyle(element, "::selection").color) !==
              rgba(getComputedStyle(element).color)
          ).map((element) => `${element.tagName}.${element.classList}`),
          bare: worded.filter((element) =>
            rgba(getComputedStyle(element, "::selection").backgroundColor)
              .endsWith(",0")
          ).length,
        };
      });
      assert(lost.worded > 100, `${colorScheme}: the room is full of words`);
      assertEquals(
        lost.changed,
        [],
        `${colorScheme}: selecting these words changes their color, on a surface that does not change with it`,
      );
      assertEquals(lost.bare, 0, `${colorScheme}: a selection shows`);
    });
  }
});
