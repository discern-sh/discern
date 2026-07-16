/**
 * Automated WCAG guard for the docs shell. Axe scans representative rendered
 * pages; focused contract checks cover responsive and client-generated states
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

function get(path: string): Promise<Response> {
  return handler(
    new Request(`https://discern.sh${path}`, { headers: BROWSER }),
  );
}

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
  const leaf = site.pages.find((page) => !page.isIndex);
  const routes = ["/docs", leaf?.route].filter(
    (route): route is string => route !== undefined,
  );
  const findings = (
    await Promise.all(routes.map(seriousAxeFindings))
  ).flat();
  assertEquals(findings, []);
});

Deno.test("responsive and client-generated accessibility contracts remain wired", async () => {
  const html = await (await get("/docs")).text();
  const css = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.css", import.meta.url),
  );
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
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
      "permalinks are siblings of headings",
      /heading\.before\(group\)/.test(client),
    ],
    [
      "theme state is exposed",
      /aria-pressed/.test(client) && /Use light theme/.test(client),
    ],
    [
      "copy outcomes are live",
      /aria-live/.test(client) && /Copy failed/.test(client),
    ],
    [
      "no-JS mobile navigation stays in flow",
      /html:not\(\.docs-js\) \.docs-nav/.test(css),
    ],
    [
      "drawer and dialog honor reduced motion",
      /prefers-reduced-motion:\s*reduce/.test(css) &&
      /\.docs-search-panel/.test(css),
    ],
  ] as const;

  assertEquals(
    contracts.filter(([, present]) => !present).map(([name]) => name),
    [],
  );
});
