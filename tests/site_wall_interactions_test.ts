/**
 * The wall's interactions hold their contracts without a browser: what the
 * opened card's sheet says for each kind of card and what its link is called,
 * how a lens orders the wall and what it says it did, how a card is chosen to
 * open, which early end of a view transition is a fault, which click is a
 * plain one, and that one function alone makes a click on a visitor's
 * behalf. The stylesheet is held to the
 * same contracts: a receded card stays legible, the list's order is the only
 * thing that places a card, the morph never shows two sets of words at once,
 * and a card's mark crosses on the sheet's own clock.
 *
 * Focus, the modal dialog, the re-sorted list, and the view transitions
 * themselves need a real browser and are checked in
 * `site_homepage_browser_test.ts` and `site_wall_sheet_browser_test.ts`.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { oklchHex } from "../site/social/draw.tsx";
import {
  Card,
  cardGlyph,
  cardHeading,
  cardNumeral,
  RECEDED_ATTRIBUTE,
} from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { type LinkLabels, linkRoute } from "../site/wall/host.ts";
import {
  Lens,
  LENS_REST,
  lensGroups,
  lensRecedes,
  lensStatus,
} from "../site/wall/Lens.tsx";
import { OpenCard } from "../site/wall/OpenCard.tsx";
import type { WallCard, WallLens } from "../site/wall/types.ts";
import {
  type ClickKind,
  drawnFlat,
  openChange,
  OPENING_ATTRIBUTE,
  OPENING_STATES,
  plainClick,
  transitionOvertaken,
} from "../site/wall/use_open_card.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
import {
  declared,
  readWallSheet,
  type StyleRule,
  styleRules,
} from "./wall_stylesheets.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

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

/** The manual route a card links to, or nothing for a card with no link. */
function linkedRoute(card: WallCard): string | undefined {
  return card.href === undefined ? undefined : linkRoute(card.href);
}

/**
 * A label for every route the sample cards and the deck link to. No label
 * is the address it stands for, so a sheet that shows one has looked it up.
 */
const LABELS: LinkLabels = Object.fromEntries(
  [...SAMPLE_CARDS, ...WALL_DECK].flatMap((card) => {
    const route = linkedRoute(card);
    return route === undefined ? [] : [[route, `The page at ${route}`]];
  }),
);

/** Render the opened card on the server and hand back its one dialog. */
function sheetOf(
  card: WallCard,
  linkLabels: LinkLabels = LABELS,
): { readonly dialog: Element } {
  const markup = renderToStaticMarkup(
    createElement(OpenCard, { card, linkLabels, onClose: () => {} }),
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

/** A link's words as they are read out: without the arrow that decorates them. */
function linkWords(link: Element): string {
  return [...link.childNodes].filter((node) =>
    !(node.nodeType === node.ELEMENT_NODE &&
      link.querySelector("[aria-hidden='true']") === node)
  ).map((node) => node.textContent ?? "").join("").trim();
}

Deno.test("no card open renders no dialog at all", () => {
  assertStrictEquals(
    renderToStaticMarkup(
      createElement(OpenCard, {
        card: null,
        linkLabels: LABELS,
        onClose: () => {},
      }),
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
    const glyph = dialog.querySelector(".wall-open-glyph");
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

    // The link into the manual is there only when the card names a page,
    // and its words are that page's label, so the link says where it goes.
    const links = [...dialog.querySelectorAll("a")];
    assertEquals(
      links.map((link) => link.getAttribute("href")),
      card.href === undefined ? [] : [card.href],
      card.id,
    );
    for (const link of links) {
      assert(link.classList.contains("wall-open-link"));
      assertEquals(linkWords(link), LABELS[linkedRoute(card) ?? ""], card.id);
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
  assert(
    WALL_DECK.some((card) => card.href?.includes("#") === true),
    "a card links to a section of a page",
  );
});

Deno.test("a link to a section of a page is named by the page, and a page with no label by its own address", () => {
  const [, linked] = SAMPLE_CARDS;
  assert(linked?.href !== undefined, "a sample card names a page");
  const section: WallCard = { ...linked, href: `${linked.href}#a-section` };
  const words = (card: WallCard, labels: LinkLabels): string[] =>
    [...sheetOf(card, labels).dialog.querySelectorAll("a")].map(linkWords);

  assertEquals(linkRoute(section.href ?? ""), linked.href);
  assertEquals(words(section, { [linked.href]: "A page" }), ["A page"]);
  assertEquals(words(linked, { [linked.href]: "A page" }), ["A page"]);
  assertEquals(
    words(section, { [`${linked.href}/elsewhere`]: "Another page" }),
    [linked.href],
    "a link is never blank",
  );
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

Deno.test("a lens leads the wall with the cards it kept and sets the rest after them, each group in the deck's order", () => {
  const ids = (cards: readonly WallCard[]): string[] =>
    cards.map((card) => card.id);
  const place = new Map(WALL_DECK.map((card, index) => [card.id, index]));
  const inDeckOrder = (cards: readonly WallCard[]): boolean =>
    cards.every((card, index) =>
      index === 0 ||
      (place.get(cards[index - 1]?.id ?? "") ?? -1) < (place.get(card.id) ?? -1)
    );

  // With no lens the wall is the deck itself, and nothing is set aside.
  const whole = lensGroups(undefined, WALL_DECK);
  assertEquals(ids(whole.kept), ids(WALL_DECK));
  assertEquals(whole.rest, []);

  for (const lens of WALL_LENSES) {
    const { kept, rest } = lensGroups(lens, WALL_DECK);
    assertEquals(
      ids(kept),
      ids(WALL_DECK.filter((card) => !lensRecedes(lens, card))),
      `${lens.id}: the cards it kept`,
    );
    assertEquals(
      ids(rest),
      ids(WALL_DECK.filter((card) => lensRecedes(lens, card))),
      `${lens.id}: the cards it set aside`,
    );
    assert(inDeckOrder(kept), `${lens.id} keeps its cards in the deck's order`);
    assert(inDeckOrder(rest), `${lens.id} keeps the rest in the deck's order`);
    assertEquals(
      ids([...kept, ...rest]).toSorted(),
      ids(WALL_DECK).toSorted(),
      `${lens.id} neither drops nor repeats a card`,
    );
  }
});

Deno.test("a lens says in words what it did to the wall, and says nothing with no lens", () => {
  assertStrictEquals(
    lensStatus(undefined, lensGroups(undefined, WALL_DECK)),
    "",
    "no lens, nothing to announce",
  );
  for (const lens of WALL_LENSES) {
    const groups = lensGroups(lens, WALL_DECK);
    assert(groups.kept.length > 1 && groups.rest.length > 1, lens.id);
    assertEquals(
      lensStatus(lens, groups),
      `${groups.kept.length} cards for "${lens.label}". The other ${groups.rest.length} follow under "${LENS_REST}".`,
      lens.id,
    );
  }

  // A count of one reads as one, and a lens that keeps every card names no
  // divider, because the wall then shows none.
  const [first, second, ...others] = WALL_DECK;
  assert(first !== undefined && second !== undefined && others.length > 1);
  const lens: WallLens = { id: "sample", label: "Sample", clusters: [] };
  assertEquals(
    lensStatus(lens, { kept: [first], rest: [second] }),
    `1 card for "Sample". The other card follows under "${LENS_REST}".`,
  );
  assertEquals(
    lensStatus(lens, { kept: [first, second], rest: [] }),
    '2 cards for "Sample".',
  );
});

Deno.test("the lens is one pressed chip among toggles, each keyed to its clusters' hues", () => {
  for (const active of [null, ...WALL_LENSES.map((lens) => lens.id)]) {
    const status = active === null ? "" : `What ${active} did.`;
    const markup = renderToStaticMarkup(
      createElement(Lens, {
        lenses: WALL_LENSES,
        active,
        status,
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

    // The status is a live region inside the group. It is there with no
    // lens, empty, so assistive technology hears the first lens fill it.
    const regions = [...group.querySelectorAll("[role='status']")];
    assertEquals(regions.length, 1, "the group holds one status");
    assertEquals(regions[0]?.textContent, status);
    assertStrictEquals(
      regions[0]?.closest("[aria-hidden]"),
      null,
      "assistive technology can read the status",
    );
    assertEquals(
      [...group.children].filter((child) =>
        !chips.includes(child) && !regions.includes(child)
      ),
      [],
      "the group holds chips and its status, and nothing else",
    );
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

Deno.test("a view transition that ends early is expected when the page is hidden, a later request ended it, or the window changed size, and is a fault otherwise", () => {
  const overtaken = new DOMException("skipped", "AbortError");
  // The browser gives one name to a window that changed size and to a
  // transition name that stands on two boxes. Only the first is expected.
  const invalid = new DOMException("invalid state", "InvalidStateError");
  const steady = { hidden: false, resized: false };
  const cases:
    readonly (readonly [string, unknown, boolean, boolean, boolean])[] = [
      ["a later request ended it", overtaken, false, false, true],
      ["a later request, after a resize", overtaken, false, true, true],
      ["the window changed size", invalid, false, true, true],
      ["a transition name on two boxes", invalid, false, false, false],
      ["a hidden page, whatever the reason", invalid, true, false, true],
      ["a hidden page and no reason", undefined, true, false, true],
      ["another fault during a resize", new TypeError("a"), false, true, false],
      [
        "another DOM fault during a resize",
        new DOMException("too slow", "TimeoutError"),
        false,
        true,
        false,
      ],
      ["a reason that is no error", "skipped", false, false, false],
    ];
  for (const [name, reason, hidden, resized, expected] of cases) {
    assertEquals(
      transitionOvertaken({ ...steady, reason, hidden, resized }),
      expected,
      name,
    );
  }
});

Deno.test("only a click of the primary button, with no modifier key held, is a plain one", () => {
  const plain: ClickKind = {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  };
  assert(plainClick(plain), "the plain click");
  const keys = Object.entries(plain).flatMap(([part, value]) =>
    typeof value === "boolean" ? [part] : []
  );
  assert(keys.length >= 4, "a click names its modifier keys");
  for (const key of keys) {
    assertEquals(plainClick({ ...plain, [key]: true }), false, key);
  }
  for (const button of [1, 2, 3, 4]) {
    assertEquals(plainClick({ ...plain, button }), false, `button ${button}`);
  }
});

Deno.test("a click made by script is made in one place, which hands on a plain click alone", async () => {
  // A click made by script carries no modifier key and no button. It can
  // stand in for a visitor's click only when theirs was a plain one, so one
  // function makes such a click, for the sheet and for the lens alike, and
  // it asks first.
  const sources = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_interactions_test.ts#script-made-clicks",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only the site's own modules run in a visitor's browser, where a click made by script stands in for theirs.",
        include: (path) => path.startsWith("site/"),
      },
    }),
  );
  assert(sources.length > 0);
  const makesClick = /\.click\(|new (?:Mouse|Pointer)Event\(\s*["'`]click/g;
  const home = "site/wall/use_open_card.ts";
  assertEquals(
    sources.flatMap(({ path, source }) =>
      [...source.matchAll(makesClick)].map(() => path)
    ),
    [home],
    "one line of the site makes a click on a visitor's behalf",
  );
  const handsOn =
    /\nexport function deliverClick\(event: MouseEvent\): void \{\n([\s\S]*?)\n\}\n/
      .exec(sources.find(({ path }) => path === home)?.source ?? "")?.[1];
  assert(handsOn !== undefined, `${home} exports deliverClick`);
  assert(
    [...handsOn.matchAll(makesClick)].length === 1,
    "deliverClick is the function that makes the click",
  );
  assert(
    handsOn.trimStart().startsWith("if (!plainClick(event)) return;"),
    "deliverClick refuses any click but a plain one before it reads the page",
  );
});

/** Whether a selector's subject is the card's own list item. */
function selectsTheCardItself(selector: string): boolean {
  return /\.wall-card(?![\w-])(?:\[[^\]]*\]|:[\w-]+(?:\([^()]*\))?)*$/.test(
    selector,
  );
}

Deno.test("the list's order alone places a card: the stylesheet changes a receded or opening card's opacity, color, and transition name, and never moves it", async () => {
  const sheet = styleRules(await readWallSheet("wall-interactions.css"));
  const rules = sheet.filter((rule) =>
    rule.selectors.some(selectsTheCardItself)
  );
  assert(
    rules.length > 0,
    "the stylesheet styles the receded and opening card",
  );
  // A lens re-sorts the list, and the cards a lens set aside are drawn
  // receded where the list puts them. So a rule that moved or resized a card
  // would be a second thing placing it, and a card would be seen to travel.
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

  // The divider between the two groups is one row across every column, so
  // the cards a lens kept end above it in each column and the rest start
  // below it.
  const dividers = sheet.filter((rule) =>
    rule.selectors.includes(".wall-rest") &&
    declared(rule, "column-span") !== undefined
  );
  assertEquals(
    dividers.map((rule) => declared(rule, "column-span")),
    ["all"],
    "the divider spans every column of the wall",
  );
});

Deno.test("the stylesheet styles every state the hook marks an opening card with", async () => {
  const css = await readWallSheet("wall-interactions.css");
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

/** Every time a CSS value writes, in seconds, in the order written. */
function seconds(value: string): number[] {
  return [...value.matchAll(/(?<![\w.-])([\d.]+)(m?s)\b/g)].map((time) =>
    Number(time[1]) / (time[2] === "ms" ? 1000 : 1)
  );
}

/**
 * When one picture of the morph is on screen, in seconds from its start,
 * while a card carries `state`. One rule times the picture for every state,
 * and a rule for one state alone may move its delay or its duration. A later
 * declaration wins, as it does in the browser, because both rules name the
 * mark by one attribute.
 */
function morphPicture(
  rules: readonly StyleRule[],
  picture: "old" | "new",
  state: string,
): { readonly starts: number; readonly ends: number } {
  const pseudo = `::view-transition-${picture}(wall-open)`;
  const marks = [`[${OPENING_ATTRIBUTE}]`, `[${OPENING_ATTRIBUTE}="${state}"]`];
  const timing = rules.filter((rule) =>
    rule.selectors.some((selector) =>
      selector.endsWith(pseudo) &&
      marks.some((mark) => selector.includes(mark))
    )
  );
  let whole = 0;
  let duration: number | undefined;
  let delay = 0;
  for (const rule of timing) {
    // An animation shorthand gives its duration first and then its delay.
    const shorthand = declared(rule, "animation");
    if (shorthand !== undefined) {
      whole++;
      [duration, delay = 0] = seconds(shorthand);
    }
    [duration = duration] = seconds(declared(rule, "animation-duration") ?? "");
    [delay = delay] = seconds(declared(rule, "animation-delay") ?? "");
  }
  assertEquals(
    whole,
    1,
    `one rule times the ${picture} picture of the morph for a card marked ${state}`,
  );
  assert(duration !== undefined && duration > 0, `${picture} has a duration`);
  return { starts: delay, ends: delay + duration };
}

Deno.test("as a card and its sheet morph, the outgoing words are gone before the incoming words show, on the way out and on the way back", async () => {
  const rules = styleRules(await readWallSheet("wall-interactions.css"));
  for (const state of OPENING_STATES) {
    const outgoing = morphPicture(rules, "old", state);
    const incoming = morphPicture(rules, "new", state);
    assertEquals(
      outgoing.starts,
      0,
      `${state}: the outgoing picture starts to go at once`,
    );
    assert(
      incoming.starts >= outgoing.ends,
      `${state}: the incoming picture shows from ${incoming.starts}s, while the outgoing one is on screen until ${outgoing.ends}s: for that long two sets of words overlap`,
    );
  }
});

/**
 * How tall the stylesheet draws the morph's incoming picture while a card
 * carries each state. Filling the box suits the sheet's picture on the way
 * out: the box grows to the sheet's own shape. The card's picture on the way
 * back is shorter for its width than the box it arrives in, and filling that
 * box would draw its words several times their size and cut each line at the
 * box's edge, so it keeps its own shape at the box's width.
 */
const INCOMING_HEIGHT: Readonly<
  Record<(typeof OPENING_STATES)[number], string>
> = { held: "100%", morph: "auto" };

Deno.test("the morph's incoming picture fills the box on the way out, and keeps its own shape on the way back so no line of the card is cut", async () => {
  const rules = styleRules(await readWallSheet("wall-interactions.css"));
  const pseudo = "::view-transition-new(wall-open)";
  for (const state of OPENING_STATES) {
    const marks = [
      `[${OPENING_ATTRIBUTE}]`,
      `[${OPENING_ATTRIBUTE}="${state}"]`,
    ];
    // A later declaration wins, as it does in the browser, because every
    // rule here names the mark by one attribute.
    const height = rules.filter((rule) =>
      rule.selectors.some((selector) =>
        selector.endsWith(pseudo) &&
        marks.some((mark) => selector.includes(mark))
      )
    ).map((rule) => declared(rule, "block-size")).findLast((size) =>
      size !== undefined
    );
    assertEquals(
      height,
      INCOMING_HEIGHT[state],
      `the height of the incoming picture while a card is marked ${state}`,
    );
  }
});

/** The name a card's mark crosses to the sheet under. */
const MARK_NAME = "wall-open-mark";

/** One card as its list item, rendered on the server. */
function cardOf(card: WallCard): Element {
  const markup = renderToStaticMarkup(
    createElement(Card, { card, receded: false, onOpen: () => {} }),
  );
  const item = new JSDOM(`<ul>${markup}</ul>`).window.document.querySelector(
    "li",
  );
  assert(item !== null, `${card.id} renders as a list item`);
  return item;
}

Deno.test("a card's mark crosses under a name of its own, given to its box on the card and in the sheet, on the sheet's own clock", async () => {
  const rules = styleRules(await readWallSheet("wall-interactions.css"));

  // One rule gives the name, and each of its selectors ends at the mark's
  // box. Run against the components' own markup, those ends find the one
  // box that holds a card's glyph or numeral, and never a drawing inside it:
  // a glyph is a box of drawings, and a name on one of them would carry only
  // part of the glyph across.
  const naming = rules.filter((rule) =>
    declared(rule, "view-transition-name") === MARK_NAME
  );
  assertEquals(naming.length, 1, "one rule names the mark");
  const boxes = [
    ...(naming[0]?.prelude ?? "").matchAll(/(:is\([^()]*\))\s*(?=,|$)/g),
  ].map((match) => match[1] ?? "");
  assertEquals(boxes.length, 2, "the card's box and the sheet's");
  const marked = SAMPLE_CARDS.filter((card) =>
    cardGlyph(card) !== undefined || cardNumeral(card) !== undefined
  );
  assert(
    marked.length > 1 && marked.length < SAMPLE_CARDS.length,
    "the sample cards lead with a glyph, with a numeral, and with neither",
  );
  for (const card of SAMPLE_CARDS) {
    for (
      const [where, scope] of [
        ["on the card", cardOf(card)],
        ["in the sheet", sheetOf(card).dialog],
      ] as const
    ) {
      const found = [...scope.querySelectorAll(boxes.join(", "))];
      assertEquals(
        found.length,
        marked.includes(card) ? 1 : 0,
        `${card.id}: the boxes the stylesheet names ${where}`,
      );
      for (const box of found) {
        assertStrictEquals(
          box.closest("svg"),
          null,
          `${card.id}: the name stands on a drawing ${where}, not on its box`,
        );
      }
    }
  }

  // The mark travels on the sheet's box, so whatever times that box times
  // the mark with it, in one rule.
  const box = "::view-transition-group(wall-open)";
  const mark = `::view-transition-group(${MARK_NAME})`;
  const timed = rules.filter((rule) =>
    rule.selectors.some((selector) =>
      selector.endsWith(box) || selector.endsWith(mark)
    )
  );
  assert(timed.length > 1, "the box is timed on its way out and its way back");
  for (const rule of timed) {
    const heads = (part: string): string[] =>
      rule.selectors.filter((selector) => selector.endsWith(part)).map((
        selector,
      ) => selector.slice(0, -part.length)).toSorted();
    assertEquals(
      heads(mark),
      heads(box),
      `"${rule.prelude}" times the sheet's box and the mark apart`,
    );
  }

  // The mark's two pictures are one drawing at two sizes. Each is scaled to
  // the travelling box's height, so a numeral, whose box is as wide as its
  // heading, keeps its shape.
  const pictures = rules.filter((rule) =>
    rule.selectors.some((selector) =>
      /^::view-transition-(?:old|new)\(wall-open-mark\)$/.test(selector)
    )
  );
  assertEquals(
    pictures.map((rule) => [
      rule.selectors.toSorted(),
      declared(rule, "block-size"),
      declared(rule, "inline-size"),
    ]),
    [[
      [
        `::view-transition-new(${MARK_NAME})`,
        `::view-transition-old(${MARK_NAME})`,
      ],
      "100%",
      "auto",
    ]],
    "both pictures of the mark take the box's height and their own width",
  );
});

/** Every declaration a stylesheet makes under exactly this selector, later ones winning. */
function declaredFor(css: string, selector: string): Map<string, string> {
  return new Map(
    styleRules(css).filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => [...rule.declarations]),
  );
}

/** The properties that give a run of text its shape at any size. */
const TEXT_SHAPE = [
  "font-family",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-variant-numeric",
  "font-feature-settings",
  "line-height",
  "letter-spacing",
  "text-transform",
] as const;

Deno.test("the sheet draws a card's mark as the card does, a size up, so the two are one drawing while one grows into the other", async () => {
  const [cards, interactions] = await Promise.all([
    readWallSheet("wall-card.css"),
    readWallSheet("wall-interactions.css"),
  ]);
  const onCard = declaredFor(cards, ".wall-card-numeral");
  const inSheet = declaredFor(interactions, ".wall-open-numeral");
  assert(
    onCard.has("font-size") && inSheet.has("font-size"),
    "each stylesheet sets its numeral",
  );
  for (const property of TEXT_SHAPE) {
    assertEquals(
      inSheet.get(property),
      onCard.get(property),
      `the sheet sets a numeral's ${property} apart from the card's, so the two pictures of it do not lie on each other`,
    );
  }
  for (const property of ["line-height", "letter-spacing"]) {
    assert(
      /^-?[\d.]+(?:em)?$/.test(onCard.get(property) ?? ""),
      `a numeral's ${property} is a share of its size, so it grows with it`,
    );
  }

  // A glyph is a square box on the card and in the sheet, at every size
  // either stylesheet gives it.
  const sized = [
    ...styleRules(cards).filter((rule) =>
      rule.selectors.some((selector) => selector.endsWith(".wall-card-glyph"))
    ),
    ...styleRules(interactions).filter((rule) =>
      rule.selectors.some((selector) => selector.endsWith(".wall-open-glyph"))
    ),
  ].filter((rule) =>
    declared(rule, "inline-size") !== undefined ||
    declared(rule, "block-size") !== undefined
  );
  assert(sized.length > 1, "both stylesheets size the glyph");
  for (const rule of sized) {
    assertEquals(
      declared(rule, "inline-size"),
      declared(rule, "block-size"),
      `"${rule.prelude}" gives the glyph a box that is not square`,
    );
  }
});

/**
 * Every value a stylesheet declares for a custom property, in order, with any
 * `var()` inside it resolved against the sheet's first declaration of that name.
 */
function customProperty(sheet: string, css: string, name: string): string[] {
  const set = new Map<string, string[]>();
  for (const rule of styleRules(css)) {
    for (const [property, value] of rule.declarations) {
      if (!property.startsWith("--")) continue;
      set.set(property, [...(set.get(property) ?? []), value]);
    }
  }
  const resolve = (value: string, depth: number): string =>
    value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, inner: string) => {
      const [first] = values(inner);
      assert(first !== undefined && depth < 8);
      return resolve(first, depth + 1);
    });
  const values = (property: string): string[] => {
    const found = set.get(property);
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
    readWallSheet("wall.css"),
    readWallSheet("wall-card.css"),
    readWallSheet("wall-interactions.css"),
  ]);
  const receded = styleRules(interactions).find((rule) =>
    rule.selectors.includes(`.wall-card[${RECEDED_ATTRIBUTE}]`)
  );
  assert(receded !== undefined, "the stylesheet styles a receded card");
  const opacity = Number(declared(receded, "opacity"));
  assert(opacity > 0 && opacity < 1, "a receded card is dimmed");
  assert(
    /^saturate\(/.test(declared(receded, "filter") ?? ""),
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
  // carries, so that one stop stands for every face. The card names its
  // surface, and the room declares the colors that surface is made of.
  const [surface] = customProperty(
    "wall.css and wall-card.css",
    `${room}\n${cards}`,
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
