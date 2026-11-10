/**
 * The wall's interactions hold their contracts without a browser: what the
 * opened card's sheet says for each kind of card, how a lens decides which
 * cards recede, how a card is chosen to open, and where the pointer light
 * goes. The stylesheet is held to the same contracts: a receded card stays
 * legible, and nothing the lens or an opening card does can move a card.
 *
 * Focus, the modal dialog, and the view transition itself need a real browser
 * and are checked in `site_homepage_browser_test.ts`.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { oklchHex } from "../site/social/draw.tsx";
import { cardGlyph, cardHeading, cardNumeral } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { Lens, lensRecedes } from "../site/wall/Lens.tsx";
import { OpenCard } from "../site/wall/OpenCard.tsx";
import type { WallCard, WallLens } from "../site/wall/types.ts";
import {
  lightAway,
  type LightBox,
  type LightPoint,
  lightStep,
} from "../site/wall/use_light.ts";
import {
  drawnFlat,
  openChange,
  OPENING_ATTRIBUTE,
  OPENING_STATES,
} from "../site/wall/use_open_card.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Read one of the wall's stylesheets as authored. */
function stylesheet(name: string): Promise<string> {
  return Deno.readTextFile(join(ROOT, "site/page-src", name));
}

/** Cards that cover every kind, with and without the optional parts. */
const SPARE: Pick<WallCard, "cluster" | "source" | "cites"> = {
  cluster: "keep-control",
  source: "claim",
  cites: "a-claim",
};
const SAMPLE_CARDS: readonly WallCard[] = [
  { ...SPARE, kind: "benefit", id: "bare-benefit", title: "T", line: "L." },
  {
    ...SPARE,
    kind: "benefit",
    id: "full-benefit",
    title: "Full title",
    line: "A line.",
    glyph: "another-glyph",
    more: "More words.",
    href: "/docs/start",
  },
  { ...SPARE, kind: "statement", id: "bare-statement", text: "A statement." },
  {
    ...SPARE,
    kind: "statement",
    id: "full-statement",
    text: "Another statement.",
    more: "More words.",
    href: "/docs/start",
  },
  {
    ...SPARE,
    kind: "numeral",
    id: "bare-numeral",
    numeral: "7",
    title: "Things counted",
    line: "That is how many.",
  },
  {
    ...SPARE,
    kind: "numeral",
    id: "full-numeral",
    numeral: "36",
    title: "Limits on itself",
    line: "That is how many 36 would be.",
    more: "More words.",
    href: "/docs/start",
  },
];

/** Render the opened card on the server and hand back its one dialog. */
function sheetOf(card: WallCard): { readonly dialog: Element } {
  const markup = renderToStaticMarkup(
    createElement(OpenCard, { card, onClose: () => {} }),
  );
  const { document } = new JSDOM(markup).window;
  const dialogs = [...document.querySelectorAll("dialog")];
  assertEquals(dialogs.length, 1, `${card.id} opens as one dialog`);
  const [dialog] = dialogs;
  assert(dialog !== undefined);
  return { dialog };
}

/** The text of the element an ARIA id reference on `owner` points at. */
function referenced(owner: Element, attribute: string): string | undefined {
  const id = owner.getAttribute(attribute);
  if (id === null) return undefined;
  const target = owner.ownerDocument.getElementById(id);
  assert(target !== null, `${attribute}="${id}" points at an element`);
  return target.textContent ?? "";
}

/** The text of the one element matching `selector`, or nothing when there is none. */
function only(scope: Element, selector: string): string | undefined {
  const found = [...scope.querySelectorAll(selector)];
  assert(found.length <= 1, `at most one ${selector}`);
  return found[0]?.textContent ?? undefined;
}

Deno.test("no card open renders no dialog at all", () => {
  assertStrictEquals(
    renderToStaticMarkup(
      createElement(OpenCard, { card: null, onClose: () => {} }),
    ),
    "",
  );
});

Deno.test("the sheet says what its card says, for every kind of card", () => {
  for (const card of [...SAMPLE_CARDS, ...WALL_DECK]) {
    const { dialog } = sheetOf(card);
    assert(
      dialog.classList.contains("wall-open") &&
        dialog.classList.contains(`wall-open--${card.kind}`),
      `${card.id} carries its kind`,
    );
    assertEquals(
      dialog.hasAttribute("open"),
      false,
      "the dialog opens as a modal in the browser, never by markup",
    );

    // The heading names the dialog. A numeral leads it, so the dialog shares
    // the name of the card button that opened it.
    const numeral = cardNumeral(card);
    const heading = cardHeading(card);
    const name = numeral === undefined ? heading : `${numeral} ${heading}`;
    assertEquals(referenced(dialog, "aria-labelledby"), name, card.id);
    assertEquals(only(dialog, ".wall-open-title"), name, card.id);
    assertEquals(only(dialog, "h1, h2, h3, h4, h5, h6"), name, card.id);

    // A numeral is shown, and read exactly once.
    assertEquals(only(dialog, ".wall-open-numeral"), numeral, card.id);
    if (numeral !== undefined) {
      const shown = dialog.querySelector(".wall-open-numeral");
      assert(shown !== null);
      assertStrictEquals(
        shown.closest("[aria-hidden]"),
        null,
        `${card.id}: assistive technology can read the numeral`,
      );
      assert(
        dialog.querySelector(".wall-open-title")?.contains(shown),
        `${card.id}: the numeral is part of the heading`,
      );
      assertEquals(
        [...dialog.querySelectorAll("*")].filter((element) =>
          element.children.length === 0 &&
          (element.textContent ?? "").trim() === numeral
        ).length,
        1,
        `${card.id}: the numeral stands alone in one place only`,
      );
    }

    // A benefit card keeps its glyph, as decoration.
    const glyph = dialog.querySelector("svg.wall-open-glyph");
    assertEquals(glyph?.getAttribute("data-glyph"), cardGlyph(card), card.id);
    assertEquals(
      glyph?.getAttribute("aria-hidden"),
      glyph === null ? undefined : "true",
    );

    // A statement is its own heading and has no line. Every other card's line
    // is there, and describes the dialog.
    const line = card.kind === "statement" ? undefined : card.line;
    assertEquals(only(dialog, ".wall-open-line"), line, card.id);
    assertEquals(referenced(dialog, "aria-describedby"), line, card.id);

    assertEquals(only(dialog, ".wall-open-more"), card.more, card.id);

    // The docs link is there only when the card names a page.
    const links = [...dialog.querySelectorAll("a")];
    assertEquals(
      links.map((link) => link.getAttribute("href")),
      card.href === undefined ? [] : [card.href],
      card.id,
    );
    for (const link of links) {
      assert(link.classList.contains("wall-open-link"));
      assert((link.textContent ?? "").trim().length > 0, "the link has words");
    }

    // One close control, named, and first, so it takes focus as the sheet
    // opens and a held key can do no more than close the sheet.
    const controls = [...dialog.querySelectorAll("a[href], button")];
    const [first] = controls;
    assert(first !== undefined);
    assert(first.classList.contains("wall-open-close"), card.id);
    assertEquals(first.getAttribute("type"), "button");
    assertEquals(first.getAttribute("aria-label"), "Close");
    assertEquals(dialog.querySelectorAll(".wall-open-close").length, 1);
    assertEquals(
      controls.length,
      card.href === undefined ? 1 : 2,
      `${card.id}: the sheet holds its close control and at most one link`,
    );
  }
});

Deno.test("the deck opens to sheets of every kind, with and without a docs link", () => {
  for (const kind of ["benefit", "statement", "numeral"] as const) {
    assert(WALL_DECK.some((card) => card.kind === kind), kind);
  }
  assert(WALL_DECK.some((card) => card.href === undefined));
  assert(WALL_DECK.some((card) => card.href !== undefined));
});

Deno.test("a lens recedes exactly the cards outside its clusters", () => {
  for (const card of WALL_DECK) {
    assertEquals(lensRecedes(undefined, card), false, "no lens, no receding");
  }
  for (const lens of WALL_LENSES) {
    const forward = WALL_DECK.filter((card) => !lensRecedes(lens, card));
    const receded = WALL_DECK.filter((card) => lensRecedes(lens, card));
    assertEquals(
      forward.map((card) => card.id),
      WALL_DECK.filter((card) => lens.clusters.includes(card.cluster)).map((
        card,
      ) => card.id),
      lens.id,
    );
    assertEquals(forward.length + receded.length, WALL_DECK.length);
    assert(forward.length > 0, `${lens.id} brings some card forward`);
    assert(receded.length > 0, `${lens.id} lets some card recede`);
  }
  const empty: WallLens = { id: "none", label: "None", clusters: [] };
  assert(WALL_DECK.every((card) => lensRecedes(empty, card)));
});

Deno.test("the lens is one pressed chip among toggles, each keyed to its clusters' hues", () => {
  for (const active of [null, ...WALL_LENSES.map((lens) => lens.id)]) {
    const markup = renderToStaticMarkup(
      createElement(Lens, {
        lenses: WALL_LENSES,
        active,
        onSelect: () => {},
      }),
    );
    const { document } = new JSDOM(markup).window;
    const group = document.querySelector(".wall-lens");
    assert(group !== null);
    assertEquals(group.getAttribute("role"), "group");
    assert((group.getAttribute("aria-label") ?? "").length > 0);

    const chips = [...group.querySelectorAll("button.wall-chip")];
    assertEquals(chips.length, WALL_LENSES.length + 1);
    assertEquals(group.children.length, chips.length, "the group holds chips");
    assertEquals(
      chips.map((chip) => chip.getAttribute("data-lens")),
      [null, ...WALL_LENSES.map((lens) => lens.id)],
      "Everything comes first and names no lens",
    );
    assertEquals(
      chips.map((chip) => chip.getAttribute("aria-pressed")),
      [null, ...WALL_LENSES.map((lens) => lens.id)].map((id) =>
        String(id === active)
      ),
      `exactly the active chip is pressed (${active})`,
    );
    assertEquals(
      chips.map((chip) => (chip.textContent ?? "").trim()),
      ["Everything", ...WALL_LENSES.map((lens) => lens.label)],
    );
    for (const [index, chip] of chips.entries()) {
      assertEquals(chip.getAttribute("type"), "button");
      const lens = index === 0 ? undefined : WALL_LENSES[index - 1];
      const hues = [...chip.querySelectorAll(".wall-chip-hue")];
      assertEquals(hues.length, lens?.clusters.length ?? 0);
      for (const hue of hues) {
        assert(/--wall-hue:\s*\d+/.test(hue.getAttribute("style") ?? ""));
        assert(
          hue.closest("[aria-hidden='true']") !== null,
          "a hue dot is decoration",
        );
      }
    }
  }
});

Deno.test("a card morphs open only from a flat card, fades otherwise, and cuts when motion is off", () => {
  const settled = {
    transitions: true,
    reducedMotion: false,
    sourceFlat: true,
    swap: false,
  };
  assertEquals(openChange(settled), "morph");
  assertEquals(openChange({ ...settled, sourceFlat: false }), "fade");
  assertEquals(openChange({ ...settled, swap: true }), "fade");
  for (const sourceFlat of [true, false]) {
    for (const swap of [true, false]) {
      assertEquals(
        openChange({ ...settled, sourceFlat, swap, reducedMotion: true }),
        "cut",
        "reduced motion never runs a transition",
      );
      assertEquals(
        openChange({ ...settled, sourceFlat, swap, transitions: false }),
        "cut",
        "a browser without view transitions never tries one",
      );
    }
  }
});

Deno.test("a flat card counts as flat whatever fraction of a pixel its size ends on", () => {
  // A laid-out size is the drawn box snapped to whole pixels where it lies.
  const snapped = (start: number, size: number): number =>
    Math.round(start + size) - Math.round(start);
  for (const start of [0, 18.25, 31.5, 35.875]) {
    for (let size = 280; size <= 420; size += 0.125) {
      assert(
        drawnFlat({ width: size, height: size / 2 }, {
          width: snapped(start, size),
          height: snapped(start, size / 2),
        }),
        `a flat card ${size} pixels wide, ${start} pixels in, lies flat`,
      );
    }
  }
  // The far view scales and tilts the plane, and a nearly arrived plane still
  // has a little way to go.
  for (const scale of [0.46, 0.8, 0.95, 0.99]) {
    assertEquals(
      drawnFlat({ width: 372 * scale, height: 180 }, {
        width: 372,
        height: 180,
      }),
      false,
      `a card scaled to ${scale} is not flat`,
    );
    assertEquals(
      drawnFlat({ width: 372, height: 180 * scale }, {
        width: 372,
        height: 180,
      }),
      false,
      `a card tilted to ${scale} of its height is not flat`,
    );
  }
});

Deno.test("the light closes on its target without overshoot and arrives exactly", () => {
  const from: LightPoint = { x: -400, y: 900 };
  const to: LightPoint = { x: 640, y: 120 };
  assertStrictEquals(lightStep(from, to, 16, 0), to, "no ease, no glide");
  assertEquals(lightStep(from, to, 0, 80), from, "no time, no travel");
  assertEquals(lightStep(from, to, -5, 80), from, "time never runs backward");

  let at = from;
  let frames = 0;
  while (at !== to) {
    const next = lightStep(at, to, 16, 80);
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
  const oneLongFrame = lightStep(from, to, 48, 80);
  let threeShort = from;
  for (let frame = 0; frame < 3; frame++) {
    threeShort = lightStep(threeShort, to, 16, 80);
  }
  assert(Math.abs(oneLongFrame.x - threeShort.x) < 1e-6);
  assert(Math.abs(oneLongFrame.y - threeShort.y) < 1e-6);
});

Deno.test("the light enters and leaves from out of sight, through the nearest edge", () => {
  const box: LightBox = { left: 10, top: 60, right: 1430, bottom: 900 };
  const reach = 520;
  assertEquals(lightAway({ x: 40, y: 500 }, box, reach), { x: -510, y: 500 });
  assertEquals(lightAway({ x: 1400, y: 500 }, box, reach), {
    x: 1950,
    y: 500,
  });
  assertEquals(lightAway({ x: 700, y: 70 }, box, reach), { x: 700, y: -460 });
  assertEquals(lightAway({ x: 700, y: 890 }, box, reach), {
    x: 700,
    y: 1420,
  });
  // A pointer already past an edge still leaves through that edge.
  assertEquals(lightAway({ x: 700, y: 55 }, box, reach), { x: 700, y: -460 });

  for (let x = box.left; x <= box.right; x += 71) {
    for (let y = box.top; y <= box.bottom; y += 53) {
      const away = lightAway({ x, y }, box, reach);
      const outside = Math.max(
        box.left - away.x,
        away.x - box.right,
        box.top - away.y,
        away.y - box.bottom,
      );
      assert(
        outside >= reach - 1e-9,
        `from ${x},${y} the light waits a full reach outside the wall`,
      );
    }
  }
});

interface StyleRule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

/**
 * Every innermost block of a stylesheet with the selectors that head it,
 * however deeply at-rules nest it. A keyframe is such a block too; callers
 * select by selector, so a keyframe never matches a card.
 */
function styleRules(css: string): StyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((selector) =>
      selector.replace(/\s+/g, " ").trim()
    ),
    declarations: new Map(
      (match[2] ?? "").split(";").map((declaration) => {
        const colon = declaration.indexOf(":");
        return [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).replace(/\s+/g, " ").trim(),
        ] as const;
      }).filter(([name]) => name.length > 0),
    ),
  }));
}

/** Whether a selector's subject is the card's own list item. */
function selectsTheCardItself(selector: string): boolean {
  return /\.wall-card(?![\w-])(?:\[[^\]]*\]|:[\w-]+(?:\([^()]*\))?)*$/.test(
    selector,
  );
}

Deno.test("the lens and an opening card change a card's opacity, color, and transition name, and never move it", async () => {
  const rules = styleRules(await stylesheet("wall-interactions.css")).filter((
    rule,
  ) => rule.selectors.some(selectsTheCardItself));
  assert(
    rules.length > 0,
    "the stylesheet styles the receded and opening card",
  );
  const allowed = new Set([
    "opacity",
    "filter",
    "transition",
    "view-transition-name",
  ]);
  for (const rule of rules) {
    assert(
      rule.selectors.every(selectsTheCardItself),
      `"${rule.selectors.join(", ")}" mixes the card with something else`,
    );
    for (const [property, value] of rule.declarations) {
      assert(
        allowed.has(property),
        `${
          rule.selectors.join(", ")
        } sets ${property}, which could move a card`,
      );
      if (property === "transition" && value !== "none") {
        assertEquals(
          value.split(",").map((part) => part.trim().split(" ")[0]).toSorted(),
          ["filter", "opacity"],
          "a card's own transition covers opacity and filter only",
        );
      }
    }
  }
});

Deno.test("the stylesheet styles every state the hook marks an opening card with", async () => {
  const css = await stylesheet("wall-interactions.css");
  const selectors = styleRules(css).flatMap((rule) => rule.selectors);
  for (const state of OPENING_STATES) {
    assert(
      selectors.some((selector) =>
        selector.includes(`.wall-card[${OPENING_ATTRIBUTE}="${state}"]`)
      ),
      `no rule styles a card marked ${state}`,
    );
  }
  const styled = [...css.matchAll(
    new RegExp(`\\[${OPENING_ATTRIBUTE}="([^"]*)"\\]`, "g"),
  )].map((match) => match[1] ?? "");
  assertEquals(
    styled.filter((state) => !OPENING_STATES.some((known) => known === state)),
    [],
    "the stylesheet styles a state the hook never sets",
  );
});

/**
 * Every value a stylesheet declares for a custom property, in order, with any
 * `var()` inside it resolved against the sheet's first declaration of that name.
 */
function customProperty(sheet: string, css: string, name: string): string[] {
  const declared = new Map<string, string[]>();
  for (const rule of styleRules(css)) {
    for (const [property, value] of rule.declarations) {
      if (!property.startsWith("--")) continue;
      declared.set(property, [...(declared.get(property) ?? []), value]);
    }
  }
  const resolve = (value: string, depth: number): string =>
    value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, inner: string) => {
      const [first] = values(inner);
      assert(first !== undefined && depth < 8);
      return resolve(first, depth + 1);
    });
  const values = (property: string): string[] => {
    const found = declared.get(property);
    assert(
      found !== undefined,
      `the receded-contrast guard reads ${property} from ${sheet}, which no longer declares it: point the guard at the color's new home`,
    );
    return found;
  };
  return values(name).map((value) => resolve(value, 0));
}

interface Oklch {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
  readonly alpha: number;
}

/** Every `oklch()` color written in a CSS value, in order. */
function oklchColors(value: string): Oklch[] {
  return [...value.matchAll(
    /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/g,
  )].map((match) => ({
    lightness: Number(match[1]) / 100,
    chroma: Number(match[2]),
    hue: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  }));
}

type Rgb = readonly [number, number, number];

/** An OKLCH color as sRGB, each channel from 0 to 1, by the site's own converter. */
function srgb({ lightness, chroma, hue }: Oklch): Rgb {
  const hex = oklchHex(lightness, chroma, hue);
  const channel = (at: number): number =>
    Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

/** `top` laid over `under` at `alpha`, as a browser composites it. */
function over(top: Rgb, under: Rgb, alpha: number): Rgb {
  return [
    top[0] * alpha + under[0] * (1 - alpha),
    top[1] * alpha + under[1] * (1 - alpha),
    top[2] * alpha + under[2] * (1 - alpha),
  ];
}

/** The WCAG contrast ratio between two sRGB colors. */
function contrast(one: Rgb, other: Rgb): number {
  const luminance = (color: Rgb): number => {
    const [r, g, b] = color.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [light, dark] = [luminance(one), luminance(other)].toSorted((a, b) =>
    b - a
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

Deno.test("a receded card's title and line stay legible, because the card can still be read and opened", async () => {
  const [room, cards, interactions] = await Promise.all([
    stylesheet("wall.css"),
    stylesheet("wall-card.css"),
    stylesheet("wall-interactions.css"),
  ]);
  const receded = styleRules(interactions).find((rule) =>
    rule.selectors.includes(".wall-card[data-receded]")
  );
  assert(receded !== undefined, "the stylesheet styles a receded card");
  const opacity = Number(receded.declarations.get("opacity"));
  assert(opacity > 0 && opacity < 1, "a receded card is dimmed");
  assert(
    /^saturate\(/.test(receded.declarations.get("filter") ?? ""),
    "a receded card loses color, and the filter does nothing else",
  );

  const [canvas] = customProperty("wall.css", room, "--wall-canvas").flatMap(
    oklchColors,
  );
  const [ink] = customProperty("wall.css", room, "--wall-ink").flatMap(
    oklchColors,
  );
  const [muted] = customProperty("wall.css", room, "--wall-ink-muted").flatMap(
    oklchColors,
  );
  // Light text has least contrast on the lightest surface any card kind
  // carries, so that one stop stands for every face.
  const [surface] = customProperty(
    "wall-card.css",
    cards,
    "--wall-card-surface",
  )
    .flatMap(oklchColors).filter((color) => color.alpha === 1).toSorted((
      a,
      b,
    ) => b.lightness - a.lightness);
  assert(canvas !== undefined && ink !== undefined && muted !== undefined);
  assert(surface !== undefined, "the card's surface has an opaque color");

  const behind = over(srgb(surface), srgb(canvas), opacity);
  const measured = {
    title: contrast(
      over(over(srgb(ink), srgb(surface), ink.alpha), srgb(canvas), opacity),
      behind,
    ),
    line: contrast(
      over(
        over(srgb(muted), srgb(surface), muted.alpha),
        srgb(canvas),
        opacity,
      ),
      behind,
    ),
  };
  for (const [text, ratio] of Object.entries(measured)) {
    assert(
      ratio >= 4.5,
      `a receded card's ${text} has a contrast of ${
        ratio.toFixed(2)
      } to 1 at opacity ${opacity}: WCAG AA needs 4.5 to 1 for text this size`,
    );
  }
});
