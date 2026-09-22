/**
 * Automated WCAG guard for the docs shell. Axe scans representative rendered
 * pages; interaction checks cover the client-generated states a layoutless
 * DOM can activate (search modal, copy, navigation position). The package
 * drawer follows a container query, so its contract runs in a real browser
 * in `site_docs_shell_browser_test.ts`.
 */

import { assertEquals } from "@std/assert";
import axe from "axe-core";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { designSystemAssetPath } from "../site/design_system.ts";
import { decorateDocumentHtml, loadDocsSite } from "../site/docs.tsx";
import { handler, PAGES } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 accessibility audit",
};

const WORKFLOW_FIXTURE_PAGE_ID = "guide-fix-a-red-gate";

type DocsSite = Awaited<ReturnType<typeof loadDocsSite>>;

/** Resolve a representative page by stable manual identity, not a legacy route. */
function pageById(site: DocsSite, id: string): DocsSite["pages"][number] {
  const page = site.pages.find((candidate) => candidate.entry.pageId === id);
  if (page === undefined) throw new Error(`manual fixture ${id} is missing`);
  return page;
}

interface WorkflowFixture {
  site: DocsSite;
  page: DocsSite["pages"][number];
  client: string;
  dom: JSDOM;
}

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

/** Compose the real docs client and its browser scheduler for JSDOM evaluation. */
async function executableDocsClient(): Promise<string> {
  const [scheduler, matcher, client] = await Promise.all([
    Deno.readTextFile(
      new URL("../site/pages/assets/scheduler.js", import.meta.url),
    ),
    Deno.readTextFile(
      new URL("../site/pages/assets/search.js", import.meta.url),
    ),
    Deno.readTextFile(
      new URL("../site/pages/assets/docs.js", import.meta.url),
    ),
  ]);
  return `${scheduler.replace(/^export /gm, "")}\n${
    matcher.replace(/^export /gm, "")
  }\n${client.replace(/^import .*?;\n/gm, "")}`;
}

/** Load one canonical Workflow page with the production client ready to evaluate. */
async function workflowFixture(): Promise<WorkflowFixture> {
  const site = await loadDocsSite();
  const page = pageById(site, WORKFLOW_FIXTURE_PAGE_ID);
  const [response, client] = await Promise.all([
    get(page.route),
    executableDocsClient(),
  ]);
  const dom = new JSDOM(await response.text(), {
    runScripts: "outside-only",
    url: `https://discern.sh${page.route}`,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => undefined }),
  });
  return { site, page, client, dom };
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
  window.document.querySelector("[data-discern-search-palette]")
    ?.removeAttribute("hidden");
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

Deno.test("public marketing and representative document pages have no serious or critical WCAG 2.2 AA findings", async () => {
  const site = await loadDocsSite();
  const decision = site.decisions.pages[0];
  const routes = [
    ...Object.keys(PAGES),
    "/docs",
    ...site.sections.map((section) =>
      section.pages.find((page) => !page.isIndex)?.route ?? section.index.route
    ),
    "/map",
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

Deno.test("permalink controls stay outside every heading accessible name", () => {
  const fixtures = [
    ["h2", "alpha-surface", "Alpha surface"],
    ["h3", "unrelated-beta", "Unrelated beta"],
    ["h4", "future-gamma", "Future gamma"],
  ] as const;
  const body = fixtures.map(([tag, id, text]) =>
    `<${tag} id="${id}">${text}</${tag}>`
  ).join("");
  const dom = new JSDOM(
    `<article class="doc-body">${decorateDocumentHtml(body)}</article>`,
  );

  const states = fixtures.map(([, id]) => {
    const heading = dom.window.document.getElementById(id);
    const wrapper = heading?.parentElement;
    return {
      tag: heading?.tagName.toLowerCase(),
      text: heading?.textContent,
      permalinkInsideHeading:
        heading?.querySelector(".discern-anchor-heading__anchor") !== null,
      permalinkNextToHeading: wrapper?.querySelector(
        ":scope > .discern-anchor-heading__anchor",
      ) !== null,
      label: wrapper?.querySelector(":scope > .discern-anchor-heading__anchor")
        ?.getAttribute("aria-label"),
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
  const { dom, client } = await workflowFixture();
  dom.window.document.querySelector(".docs-toc")?.remove();
  dom.window.eval(client);

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
  const { site, dom, client } = await workflowFixture();
  dom.window.document.querySelector(".docs-toc")?.remove();
  const document = dom.window.document;
  const navScroll = document.querySelector<HTMLElement>(
    "#docs-nav",
  );
  const current = navScroll?.querySelector<HTMLElement>(
    '[aria-current="page"]',
  );
  if (!navScroll || !current) {
    throw new Error("navigation fixture has no current page");
  }
  navScroll.getBoundingClientRect = () => ({ top: 0, bottom: 300 } as DOMRect);
  current.getBoundingClientRect = () => ({ top: 340, bottom: 365 } as DOMRect);
  dom.window.sessionStorage.setItem("discern:manual-nav-scroll", "180");
  dom.window.eval(client);
  await Promise.resolve();

  assertEquals(navScroll.scrollTop, 245);
  navScroll.scrollTop = 312;
  navScroll.dispatchEvent(new dom.window.Event("scroll"));
  const persisted = dom.window.sessionStorage.getItem(
    "discern:manual-nav-scroll",
  );
  const routes = [
    ...navScroll.querySelectorAll("li > a"),
  ].map((link) => link.getAttribute("href"));
  const disclosure = navScroll.querySelector("[data-nav-disclosure]");
  dom.window.close();

  assertEquals(persisted, "312");
  assertEquals(routes, site.pages.map((candidate) => candidate.route));
  assertEquals(disclosure, null);
});

Deno.test("deep links expose page and heading context without competing claims", async () => {
  const { page, dom, client } = await workflowFixture();
  const route = page.route;
  const tocClient = await Deno.readTextFile(
    new URL("../site/pages/assets/docs-toc.js", import.meta.url),
  );
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
    `${tocClient.replace("export function", "function")}\n${client}`,
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

Deno.test("search keeps its modal focus contract without showModal support", async () => {
  const html = await (await get("/docs")).text();
  const client = await executableDocsClient();
  const runtime = await (await get(designSystemAssetPath("docs", "discern.js")))
    .text();
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://discern.sh/docs",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => undefined }),
  });
  // The drawer behaviour observes its layout; layoutless DOM has nothing to report.
  Object.defineProperty(dom.window, "ResizeObserver", {
    value: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  });
  dom.window.document.querySelector(".docs-toc")?.remove();
  dom.window.eval(runtime);
  dom.window.eval(client);

  const document = dom.window.document;
  const opener = document.querySelector<HTMLButtonElement>(
    "[data-discern-search-palette-open]",
  );
  const palette = document.querySelector<HTMLDialogElement>(
    "[data-discern-search-palette]",
  );
  const input = palette?.querySelector<HTMLInputElement>(
    "[data-discern-search-palette-input]",
  );
  const close = palette?.querySelector<HTMLButtonElement>(
    "[data-discern-search-palette-close]",
  );
  const background = [
    document.querySelector<HTMLElement>(".docs-skip"),
    document.querySelector<HTMLElement>(".docs-top"),
    document.querySelector<HTMLElement>("[data-discern-docs-layout]"),
  ].filter((element): element is HTMLElement => element !== null);
  assertEquals(background.length, 3, "the fallback inerts the whole shell");
  if (!opener || !palette || !input || !close) {
    throw new Error("search fallback fixture has no complete modal surface");
  }

  opener.focus();
  opener.click();
  await Promise.resolve();
  const opened = {
    open: palette.hasAttribute("open"),
    fallback: palette.hasAttribute("data-discern-search-palette-fallback"),
    expanded: input.getAttribute("aria-expanded"),
    focusedInput: document.activeElement === input,
    backgroundInert: background.every((element) => element.inert),
  };
  close.focus();
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
  );
  const wrapsToInput = document.activeElement === input;
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  const closed = {
    open: palette.hasAttribute("open"),
    expanded: input.getAttribute("aria-expanded"),
    restored: document.activeElement === opener,
    backgroundInteractive: background.every((element) => !element.inert),
  };
  dom.window.close();

  assertEquals(opened, {
    open: true,
    fallback: true,
    expanded: "true",
    focusedInput: true,
    backgroundInert: true,
  });
  assertEquals(wrapsToInput, true);
  assertEquals(closed, {
    open: false,
    expanded: "false",
    restored: true,
    backgroundInteractive: true,
  });
});

Deno.test("responsive and client-generated accessibility contracts remain wired", async () => {
  const html = await (await get("/docs")).text();
  const css = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.css", import.meta.url),
  );
  const runtimeCss = await (await get(
    designSystemAssetPath("docs", "discern.css"),
  )).text();
  const runtimeJs = await (await get(
    designSystemAssetPath("docs", "discern.js"),
  )).text();
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );

  const dom = new JSDOM(html);
  const document = dom.window.document;
  const attribute = (selector: string, name: string): string | null =>
    document.querySelector(selector)?.getAttribute(name) ?? null;

  const contracts = [
    [
      "mobile search has a durable name",
      attribute("[data-discern-search-palette-open]", "aria-label") !== null,
    ],
    [
      "the drawer toggle names its controlled nav and both of its states",
      attribute("[data-discern-docs-drawer-toggle]", "aria-controls") ===
        "docs-nav" &&
      attribute(
          "[data-discern-docs-drawer-toggle]",
          "data-discern-open-label",
        ) ===
        "Open navigation" &&
      attribute(
          "[data-discern-docs-drawer-toggle]",
          "data-discern-close-label",
        ) === "Close navigation",
    ],
    [
      "the open drawer takes the manual navigation's name",
      attribute("#docs-nav", "data-discern-docs-drawer-label") ===
        "Manual navigation",
    ],
    [
      "search input is a labelled combobox",
      attribute("[data-discern-search-palette-input]", "role") ===
        "combobox" &&
      attribute("[data-discern-search-palette-input]", "aria-controls") ===
        "docs-search-results",
    ],
    [
      "search results are a labelled listbox",
      attribute("#docs-search-results", "role") === "listbox",
    ],
    [
      "search has an explicit close control",
      attribute(
        "[data-discern-search-palette] [data-discern-search-palette-close]",
        "aria-label",
      ) === "Close search",
    ],
    [
      "the docs runtime carries the package search-palette behaviour",
      runtimeJs.includes("discern.search-palette"),
    ],
    [
      "search options expose selection",
      /aria-selected/.test(client) && /aria-activedescendant/.test(client),
    ],
    [
      "the theme control names its destination and its opted-in root",
      /data-discern-theme-toggle/.test(html) &&
      /data-discern-to-light-label="Switch to the light theme"/.test(html) &&
      /data-discern-to-dark-label="Switch to the dark theme"/.test(html) &&
      /data-discern-theme-storage-key="/.test(html),
    ],
    [
      "copy outcomes are live",
      /aria-live/.test(client) && /Copy failed/.test(client),
    ],
    [
      "no-JS navigation stays in flow: the toggle ships hidden and the nav is the layout's",
      attribute("[data-discern-docs-drawer-toggle]", "hidden") !== null &&
      document.getElementById("docs-nav")?.closest(
          "[data-discern-docs-layout]",
        ) !== null,
    ],
    [
      "no-JS readers never see the script-only search control",
      /html:not\(\.docs-js\) \.docs-search-btn/.test(css),
    ],
    [
      "drawer and palette motion is design-system-owned",
      !/transition/.test(css.slice(css.indexOf("/* ── Responsive"))) &&
      /prefers-reduced-motion:\s*reduce/.test(runtimeCss),
    ],
    [
      "print keeps the document while removing interactive chrome",
      /@media print/.test(css) && /\.docs-search/.test(css) &&
      /\.docs-copy/.test(css) && /\.doc-body/.test(css) &&
      /#docs-nav/.test(css) && /\.docs-toc/.test(css) &&
      /max-width:\s*none/.test(css),
    ],
    [
      "narrow prose and exact raw links can reflow without widening the page",
      /\.doc-body\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css) &&
      /\.docs-colophon :is\(a, code\)\s*\{[^}]*overflow-wrap:\s*anywhere/s
        .test(css),
    ],
    [
      "forced-colour mode preserves borders and visible focus",
      /@media \(forced-colors:\s*active\)/.test(css) &&
      /outline-color:\s*Highlight/.test(css),
    ],
  ] as const;

  dom.window.close();

  assertEquals(
    contracts.filter(([, present]) => !present).map(([name]) => name),
    [],
  );
});
