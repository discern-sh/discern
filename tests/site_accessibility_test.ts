/**
 * Automated WCAG guard for the docs shell. Axe scans representative rendered
 * pages; interaction checks cover responsive and client-generated states
 * a layoutless DOM cannot activate (drawer, modal, reduced motion, no-JS).
 */

import { assertEquals } from "@std/assert";
import axe from "axe-core";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { loadDocsSite } from "../site/docs.ts";
import { handler } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 accessibility audit",
};

interface AxeWindow extends Window {
  axe: typeof axe;
  eval(source: string): unknown;
}

/** Serve a browser-negotiated route through the production handler for accessibility auditing. */
function get(path: string): Promise<Response> {
  return handler(
    new Request(`https://discern.sh${path}`, { headers: BROWSER }),
  );
}

/** Audit a served page and its opened search modal against WCAG, retaining serious and critical evidence. */
async function seriousAxeFindings(path: string): Promise<string[]> {
  const response = await get(path);
  const dom = new JSDOM(await response.text(), {
    runScripts: "outside-only",
    url: `https://discern.sh${path}`,
  });
  const window = dom.window as unknown as AxeWindow;
  window.eval(axe.source);

  // Audit the modal itself as well as its default-hidden state. Layoutless DOM
  // cannot click it open, but removing `hidden` exercises its static contract.
  window.document.querySelector("[data-search]")?.removeAttribute("hidden");
  const result = await window.axe.run(window.document, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
    rules: { "color-contrast": { enabled: false } },
  });
  window.close();
  return result.violations
    .filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )
    .map((violation) =>
      `${path}: ${violation.id} (${violation.impact}) — ${violation.help}`
    );
}

Deno.test("representative built docs pages have no serious or critical WCAG 2.2 AA findings", async () => {
  const site = await loadDocsSite();
  const decision = site.decisions.pages[0];
  const routes = [
    "/docs",
    ...site.sections.map((section) =>
      section.pages.find((page) => !page.isIndex)?.route ?? section.index.route
    ),
    site.decisions.route,
    decision?.route,
  ].filter(
    (route): route is string => route !== undefined,
  );
  const findings = (
    await Promise.all(routes.map(seriousAxeFindings))
  ).flat();
  assertEquals(findings, []);
});

Deno.test("permalink controls stay outside every heading accessible name", async () => {
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const fixtures = [
    ["h2", "alpha-surface", "Alpha surface"],
    ["h3", "unrelated-beta", "Unrelated beta"],
    ["h4", "future-gamma", "Future gamma"],
  ] as const;
  const body = fixtures.map(([tag, id, text]) =>
    `<${tag} id="${id}">${text}</${tag}>`
  ).join("");
  const dom = new JSDOM(`<article class="doc-body">${body}</article>`, {
    runScripts: "outside-only",
    url: "https://discern.sh/docs/test",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => undefined }),
  });
  dom.window.eval(client.replace(/^import .*?;\n/gm, ""));

  const states = fixtures.map(([, id]) => {
    const heading = dom.window.document.getElementById(id);
    const wrapper = heading?.parentElement;
    return {
      tag: heading?.tagName.toLowerCase(),
      text: heading?.textContent,
      permalinkInsideHeading: heading?.querySelector(".docs-anchor") !== null,
      permalinkNextToHeading: wrapper?.querySelector(
        ":scope > .docs-anchor",
      ) !== null,
      label: wrapper?.querySelector(":scope > .docs-anchor")?.getAttribute(
        "aria-label",
      ),
    };
  });
  dom.window.close();

  assertEquals(
    states,
    fixtures.map(([tag, , text]) => ({
      tag,
      text,
      permalinkInsideHeading: false,
      permalinkNextToHeading: true,
      label: `Link to “${text}”`,
    })),
  );
});

Deno.test("Workflow commands receive the accessible package copy anatomy", async () => {
  const html = await (
    await get("/docs/quality-gate/when-the-gate-fails")
  ).text();
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://discern.sh/docs/quality-gate/when-the-gate-fails",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => undefined }),
  });
  dom.window.document.querySelector(".docs-toc")?.remove();
  dom.window.eval(client.replace(/^import .*?;\n/gm, ""));

  const document = dom.window.document;
  const execution = document.querySelector(".discern-command__execution");
  const copy = execution?.querySelector<HTMLButtonElement>(
    ":scope > .discern-command__copy.docs-command-copy",
  );
  if (!copy) throw new Error("Workflow command has no copy enhancement");
  const initial = {
    label: copy.getAttribute("aria-label"),
    live: copy.querySelector("[aria-live=polite]")?.textContent,
    insidePre: copy.closest("pre") !== null,
  };
  copy.click();
  await Promise.resolve();
  await Promise.resolve();
  const unavailable = {
    label: copy.getAttribute("aria-label"),
    live: copy.querySelector("[aria-live=polite]")?.textContent,
    state: copy.hasAttribute("data-discern-copied"),
  };
  dom.window.close();

  assertEquals(initial, {
    label: "Copy command",
    live: "Copy command",
    insidePre: false,
  });
  assertEquals(unavailable, {
    label: "Command copy failed",
    live: "Command copy failed",
    state: false,
  });
});

Deno.test("navigation restores its position and keeps the current page visible", async () => {
  const site = await loadDocsSite();
  const page = site.pages.find((candidate) =>
    candidate.route === "/docs/quality-gate/when-the-gate-fails"
  );
  if (!page) throw new Error("navigation fixture page is missing");
  const html = await (await get(page.route)).text();
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: `https://discern.sh${page.route}`,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => undefined }),
  });
  dom.window.document.querySelector(".docs-toc")?.remove();
  const document = dom.window.document;
  const navScroll = document.querySelector<HTMLElement>(
    ".docs-nav-scroll",
  );
  const current = navScroll?.querySelector<HTMLElement>(
    '[aria-current="page"]',
  );
  if (!navScroll || !current) {
    throw new Error("navigation fixture has no current page");
  }
  navScroll.getBoundingClientRect = () => ({ top: 0, bottom: 300 } as DOMRect);
  current.getBoundingClientRect = () => ({ top: 340, bottom: 365 } as DOMRect);
  dom.window.sessionStorage.setItem("discern:docs-nav-scroll", "180");
  dom.window.eval(client.replace(/^import .*?;\n/gm, ""));
  await Promise.resolve();

  assertEquals(navScroll.scrollTop, 245);
  navScroll.scrollTop = 312;
  navScroll.dispatchEvent(new dom.window.Event("scroll"));
  const persisted = dom.window.sessionStorage.getItem(
    "discern:docs-nav-scroll",
  );
  const routes = [
    ...navScroll.querySelectorAll("[data-nav-page] > a"),
  ].map((link) => link.getAttribute("href"));
  const disclosure = navScroll.querySelector("[data-nav-disclosure]");
  dom.window.close();

  assertEquals(persisted, "312");
  assertEquals(routes, site.pages.map((candidate) => candidate.route));
  assertEquals(disclosure, null);
});

Deno.test("deep links expose page and heading context without competing claims", async () => {
  const route = "/docs/quality-gate/when-the-gate-fails";
  const html = await (await get(route)).text();
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const tocClient = await Deno.readTextFile(
    new URL("../site/pages/assets/docs-toc.js", import.meta.url),
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: `https://discern.sh${route}`,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => undefined }),
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  const document = dom.window.document;
  const leftNav = document.querySelector("#docs-nav");
  const contentsNav = document.querySelector(".docs-toc");
  const headingLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>('.docs-toc a[href^="#"]'),
  ];
  const [initialHeading, nextHeading] = headingLinks;
  if (!initialHeading || !nextHeading) {
    throw new Error("deep-link fixture needs two headings");
  }
  const hash = initialHeading.hash;
  dom.window.history.replaceState(null, "", hash);
  dom.window.eval(
    `${tocClient.replace("export function", "function")}\n${
      client.replace(/^import .*?;\n/gm, "")
    }`,
  );

  const initial = {
    page: [...leftNav?.querySelectorAll('[aria-current="page"]') ?? []]
      .map((link) => link.getAttribute("href")),
    heading: [
      ...contentsNav?.querySelectorAll('[aria-current="location"]') ?? [],
    ]
      .map((link) => link.getAttribute("href")),
  };
  const nextHash = nextHeading.hash;
  dom.window.location.hash = nextHash;
  dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
  const changed = {
    page: [...leftNav?.querySelectorAll('[aria-current="page"]') ?? []]
      .map((link) => link.getAttribute("href")),
    heading: [
      ...contentsNav?.querySelectorAll('[aria-current="location"]') ?? [],
    ]
      .map((link) => link.getAttribute("href")),
  };
  dom.window.close();

  assertEquals(initial, {
    page: [route],
    heading: [hash],
  });
  assertEquals(changed, {
    page: [route],
    heading: [nextHash],
  });
});

Deno.test("mobile drawer performs the complete modal focus contract", async () => {
  const html = await (await get("/docs")).text();
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://discern.sh/docs",
  });
  let drawerMediaListener:
    | ((event: { matches: boolean }) => void)
    | undefined;
  const drawerMedia = {
    matches: true,
    addEventListener: (
      type: string,
      listener: (event: { matches: boolean }) => void,
    ) => {
      if (type === "change") drawerMediaListener = listener;
    },
  };
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => drawerMedia,
  });
  dom.window.eval(client.replace(/^import .*?;\n/gm, ""));

  const document = dom.window.document;
  const burger = document.querySelector<HTMLElement>("[data-drawer-toggle]");
  const nav = document.querySelector<HTMLElement>("#docs-nav");
  const background = [
    document.querySelector<HTMLElement>(".docs-skip"),
    document.querySelector<HTMLElement>(".docs-brand"),
    document.querySelector<HTMLElement>(".docs-brand-docs"),
    document.querySelector<HTMLElement>(".discern-docs-header__middle"),
    document.querySelector<HTMLElement>(".discern-docs-header__actions"),
    document.querySelector<HTMLElement>(".docs-main"),
    document.querySelector<HTMLElement>(".docs-rail"),
  ].filter((element): element is HTMLElement => element !== null);
  const navLinks = nav?.querySelectorAll<HTMLElement>("a[href]") ?? [];
  const firstLink = navLinks[0];
  const lastLink = navLinks[navLinks.length - 1];
  if (!burger || !nav || !firstLink || !lastLink) {
    throw new Error("mobile drawer fixture has no complete focus surface");
  }
  if (!drawerMediaListener) {
    throw new Error("mobile drawer did not subscribe to breakpoint changes");
  }

  const initiallyClosed = {
    navInert: nav.inert,
    expanded: burger.getAttribute("aria-expanded"),
  };
  burger.focus();
  burger.click();
  await Promise.resolve();
  const opened = {
    expanded: burger.getAttribute("aria-expanded"),
    label: burger.getAttribute("aria-label"),
    role: nav.getAttribute("role"),
    modal: nav.getAttribute("aria-modal"),
    navLabel: nav.getAttribute("aria-label"),
    focusedFirstLink: document.activeElement === firstLink,
    backgroundInert: background.every((element) => element.inert),
    navInteractive: !nav.inert,
  };

  lastLink.focus();
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
  );
  const forwardWrapsToBurger = document.activeElement === burger;
  burger.focus();
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }),
  );
  const backwardWrapsToLastLink = document.activeElement === lastLink;
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  const closed = {
    expanded: burger.getAttribute("aria-expanded"),
    label: burger.getAttribute("aria-label"),
    role: nav.getAttribute("role"),
    modal: nav.getAttribute("aria-modal"),
    navLabel: nav.getAttribute("aria-label"),
    restoredToBurger: document.activeElement === burger,
    backgroundInteractive: background.every((element) => !element.inert),
    navInert: nav.inert,
  };
  drawerMedia.matches = false;
  drawerMediaListener({ matches: false });
  const wide = {
    navInteractive: !nav.inert,
    expanded: burger.getAttribute("aria-expanded"),
  };
  drawerMedia.matches = true;
  drawerMediaListener({ matches: true });
  const narrowAgain = {
    navInert: nav.inert,
    expanded: burger.getAttribute("aria-expanded"),
  };
  dom.window.close();

  assertEquals(initiallyClosed, {
    navInert: true,
    expanded: "false",
  });
  assertEquals(opened, {
    expanded: "true",
    label: "Close navigation",
    role: "dialog",
    modal: "true",
    navLabel: "Documentation navigation",
    focusedFirstLink: true,
    backgroundInert: true,
    navInteractive: true,
  });
  assertEquals(forwardWrapsToBurger, true);
  assertEquals(backwardWrapsToLastLink, true);
  assertEquals(closed, {
    expanded: "false",
    label: "Open navigation",
    role: null,
    modal: null,
    navLabel: null,
    restoredToBurger: true,
    backgroundInteractive: true,
    navInert: true,
  });
  assertEquals(wide, {
    navInteractive: true,
    expanded: "false",
  });
  assertEquals(narrowAgain, {
    navInert: true,
    expanded: "false",
  });
});

Deno.test("responsive and client-generated accessibility contracts remain wired", async () => {
  const html = await (await get("/docs")).text();
  const css = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.css", import.meta.url),
  );
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const themeClient = await Deno.readTextFile(
    new URL("../site/pages/assets/theme.js", import.meta.url),
  );

  const contracts = [
    [
      "mobile search has a durable name",
      /data-search-open[^>]*aria-label=/s.test(html),
    ],
    [
      "drawer identifies its controlled nav",
      /data-drawer-toggle[^>]*aria-controls="docs-nav"/s.test(html),
    ],
    [
      "search input is a labelled combobox",
      /data-search-input[^>]*role="combobox"[^>]*aria-controls="docs-search-results"/s
        .test(html),
    ],
    [
      "search results are a labelled listbox",
      /id="docs-search-results"[^>]*role="listbox"/s.test(html),
    ],
    [
      "search has an explicit close control",
      /<button[^>]*data-search-close[^>]*aria-label="Close search"/s.test(html),
    ],
    [
      "drawer and dialog background state uses inert",
      /\.inert\s*=/.test(client),
    ],
    ["drawer label exposes open state", /Close navigation/.test(client)],
    [
      "search options expose selection",
      /aria-selected/.test(client) && /aria-activedescendant/.test(client),
    ],
    [
      "focus is moved, trapped, and restored",
      /focusFirstInDrawer/.test(client) && /trapFocus/.test(client) &&
      /restoreFocus/.test(client),
    ],
    [
      "theme state is exposed",
      /aria-pressed/.test(themeClient) &&
      /Switch to the light theme/.test(themeClient),
    ],
    [
      "copy outcomes are live",
      /aria-live/.test(client) && /Copy failed/.test(client),
    ],
    [
      "no-JS mobile navigation stays in flow",
      /id="docs-nav"/.test(html) &&
      /html:not\(\.docs-js\) \.docs-nav/.test(css),
    ],
    [
      "drawer honors reduced motion; palette motion is design-system-owned",
      /prefers-reduced-motion:\s*reduce/.test(css) &&
      /\.docs-nav/.test(css),
    ],
    [
      "print keeps the document while removing interactive chrome",
      /@media print/.test(css) && /\.docs-search/.test(css) &&
      /\.docs-copy/.test(css) && /\.doc-body/.test(css) &&
      /max-width:\s*none/.test(css),
    ],
  ] as const;

  assertEquals(
    contracts.filter(([, present]) => !present).map(([name]) => name),
    [],
  );
});
