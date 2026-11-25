/**
 * The homepage's fixed dark theme in a real browser: what a reader sees on a
 * light device, what the visit leaves of their stored choice, and what goes
 * to paper. `site_theme_test.ts` holds the same choice in the server's markup
 * for every route.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { DOCUMENT_ROUTES } from "../site/routes.ts";
import { THEME_STORAGE_KEY } from "../site/theme.ts";
import { SETUP_PROMPT_ID } from "../site/wall/SetupPrompt.tsx";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import {
  motionSettled,
  openLiveWall,
  openPage,
  ORIGIN,
  VIEWPORTS,
  withBrowser,
} from "./site_wall_browser.ts";

/** A route whose theme is its reader's, to hold a stored choice against. */
const READER_ROUTE = DOCUMENT_ROUTES.manual;

/** The parts of the page a theme paints: the canvas, both bars, and the margin round the room. */
const PARTS = ["html", "body > header", "main", "body > footer"] as const;

/** How bright a part is to the eye, from 0 for black to 1 for white. */
interface Look {
  readonly part: string;
  /** Every background from the canvas up to the part, one over the other. */
  readonly ground: number;
  /** The part's own text color over that ground. */
  readonly ink: number;
}

interface Seen {
  readonly looks: readonly Look[];
  /** The root's color scheme, which native controls and scrollbars follow. */
  readonly scheme: string;
  readonly theme: string | null;
  readonly controls: number;
  readonly stored: string | null;
}

/** Read the page as painted, with no script of the page's own involved. */
function see(page: Page): Promise<Seen> {
  return page.evaluate(({ parts, key }) => {
    const pen = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });
    const rgba = (color: string): number[] => {
      if (pen === null) return [0, 0, 0, 0];
      pen.clearRect(0, 0, 1, 1);
      pen.fillStyle = color;
      pen.fillRect(0, 0, 1, 1);
      return [...pen.getImageData(0, 0, 1, 1).data];
    };
    const over = (top: number[], under: number[]): number[] => {
      const alpha = (top[3] ?? 0) / 255;
      return [0, 1, 2].map((channel) =>
        (top[channel] ?? 0) * alpha + (under[channel] ?? 0) * (1 - alpha)
      );
    };
    const brightness = ([red = 0, green = 0, blue = 0]: number[]): number =>
      (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    // The canvas behind a page that paints nothing follows the root's scheme.
    const swatch = document.createElement("i");
    swatch.style.backgroundColor = "Canvas";
    document.documentElement.append(swatch);
    const canvas = rgba(getComputedStyle(swatch).backgroundColor);
    swatch.remove();

    const looks = parts.map((part) => {
      const element = document.querySelector(part);
      const chain: Element[] = [];
      for (let box = element; box !== null; box = box.parentElement) {
        chain.unshift(box);
      }
      const ground = chain.reduce(
        (under, box) =>
          over(rgba(getComputedStyle(box).backgroundColor), under),
        canvas,
      );
      const ink = element === null
        ? ground
        : over(rgba(getComputedStyle(element).color), ground);
      return { part, ground: brightness(ground), ink: brightness(ink) };
    });
    return {
      looks,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      theme: document.documentElement.getAttribute("data-discern-theme"),
      controls: document.querySelectorAll("[data-discern-theme-toggle]").length,
      stored: localStorage.getItem(key),
    };
  }, { parts: PARTS, key: THEME_STORAGE_KEY });
}

/** The parts that are not dark ground under light ink. */
function notDark(seen: Seen): readonly Look[] {
  return seen.looks.filter((look) => look.ground > 0.2 || look.ink < 0.6);
}

Deno.test("the homepage is dark on a light device for a reader who chose light, and leaves the choice as it was", async () => {
  const [, laptop] = VIEWPORTS;
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: laptop.width, height: laptop.height },
      colorScheme: "light",
    });
    // The reader chooses light on a page whose theme is theirs to choose.
    const { page, faults } = await openPage(context);
    await page.goto(`${ORIGIN}${READER_ROUTE}`);
    await page.evaluate(
      (key) => localStorage.setItem(key, "light"),
      THEME_STORAGE_KEY,
    );
    await page.reload();
    const chosen = await see(page);
    assertEquals(chosen.theme, "light", "the reader's page takes the choice");
    assertEquals(chosen.controls, 1, "the reader's page offers the control");
    const [canvas] = chosen.looks;
    assert(canvas !== undefined && canvas.ground > 0.8, "that page is light");

    const { page: home, faults: homeFaults } = await openLiveWall(context);
    await motionSettled(home);
    const seen = await see(home);
    assertEquals(notDark(seen), [], "these parts of the homepage are not dark");
    assertEquals(seen.scheme, "dark", "native controls and scrollbars");
    assertEquals(seen.theme, "dark", "no script moves the root's theme");
    assertEquals(seen.controls, 0, "the homepage offers no theme control");
    assertEquals(
      await home.getByRole("button", { name: /theme/i }).count(),
      0,
      "nothing on the homepage is named as a theme control",
    );
    assertEquals(seen.stored, "light", "the visit leaves the stored choice");

    // The page the reader chose light on looks as it did before the visit.
    await page.reload();
    assertEquals(await see(page), chosen);
    assertEquals([...faults, ...homeFaults], []);
  });
});

Deno.test("the homepage is dark from the server's markup alone, with script off on a light device", async () => {
  for (const viewport of VIEWPORTS) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: "light",
        javaScriptEnabled: false,
      });
      const { page, faults } = await openPage(context);
      await page.goto(`${ORIGIN}/`);
      const seen = await see(page);
      assertEquals(notDark(seen), [], `${viewport.name}: these are not dark`);
      assertEquals(seen.scheme, "dark", viewport.name);
      assertEquals(seen.controls, 0, viewport.name);
      assertEquals(faults, [], viewport.name);
    });
  }
});

Deno.test("on paper every word of the homepage is in dark ink", async () => {
  const [, laptop] = VIEWPORTS;
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: laptop.width, height: laptop.height },
      colorScheme: "light",
    });
    const { page, faults } = await openLiveWall(context);
    await page.emulateMedia({ media: "print" });
    await motionSettled(page);
    const paper = await page.evaluate((promptId) => {
      const pen = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      // Ink over white paper, from 0 for black to 1 for none at all.
      const faintness = (color: string): number => {
        if (pen === null) return 1;
        pen.fillStyle = "white";
        pen.fillRect(0, 0, 1, 1);
        pen.fillStyle = color;
        pen.fillRect(0, 0, 1, 1);
        const [red = 0, green = 0, blue = 0] = pen.getImageData(0, 0, 1, 1)
          .data;
        return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      };
      // Every element on the page that holds words of its own.
      const worded = [...document.querySelectorAll("body, body *")].filter(
        (element) =>
          element.getClientRects().length > 0 &&
          [...element.childNodes].some((node) =>
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent ?? "").trim() !== ""
          ),
      );
      // An agent's mark is a background drawn through a mask, and paper
      // drops backgrounds unless the element asks to keep its own.
      const marks = [...document.querySelectorAll(".wall-agent")].map(
        (mark) => {
          const style = getComputedStyle(mark);
          return {
            name: mark.getAttribute("aria-label"),
            drawn: mark.getClientRects().length > 0,
            faint: faintness(style.backgroundColor) > 0.5,
            kept: style.printColorAdjust,
          };
        },
      );
      return {
        worded: worded.length,
        faint: worded.filter((element) =>
          faintness(getComputedStyle(element).color) > 0.5
        ).map((element) =>
          `${element.tagName.toLowerCase()}.${element.classList}: ${
            (element.textContent ?? "").trim().slice(0, 24)
          }`
        ),
        marks,
        prompt: document.getElementById(promptId)?.getClientRects().length,
        copyControls: [...document.querySelectorAll(".wall-copy")].map((
          control,
        ) => control.getClientRects().length),
        scheme: getComputedStyle(document.documentElement).colorScheme,
      };
    }, SETUP_PROMPT_ID);
    assert(paper.worded > 100, "the page goes to paper with its words");
    assertEquals(paper.faint, [], "these words would not read on paper");
    assertEquals(paper.marks.length, AGENT_NAMES.length);
    assertEquals(
      paper.marks.filter((mark) =>
        !mark.drawn || mark.faint || mark.kept !== "exact"
      ),
      [],
      "these agents' marks would not show on paper",
    );
    assert(paper.prompt, "the setup prompt's words go to paper");
    assertEquals(
      paper.copyControls,
      [0, 0],
      "a control that copies has no use on paper, so neither is drawn there",
    );
    assertEquals(paper.scheme, "light", "paper takes the light system colors");
    assertEquals(faults, []);
  });
});
