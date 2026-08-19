/** Structural guards for the public agent-native page and machine guide. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { JSDOM } from "jsdom";
import { PROVIDERS } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { AGENTS_TITLE } from "../site/brand.ts";
import { renderAgents } from "../site/page-src/agents.tsx";
import {
  handler,
  renderTextEdition,
  SUPPORTED_PROVIDER_NAMES_MARKER,
  TEXT_EDITION,
} from "../site/serve.ts";

const REQUIRED_MACHINE_ROUTES = [
  "/llms.txt",
  "/docs/getting-started/quickstart",
  "/docs/reference/mcp-and-results",
  "/schema/v1/discern-results.schema.json",
  "/docs/orientation/glossary",
  "/docs/agent-integrations",
  "/docs/orientation/trust-and-data",
] as const;

const CURL = { accept: "*/*", "user-agent": "curl/8.6.0" };

Deno.test("the For Agents composition carries the complete public contract", () => {
  const dom = new JSDOM(renderAgents());
  const document = dom.window.document;

  assertEquals(document.title, AGENTS_TITLE);
  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(
    document.querySelector("h1")?.textContent?.trim(),
    "Finally, software designed around the way you work.",
  );
  for (
    const id of [
      "main",
      "context",
      "operations",
      "continuity",
      "authority",
      "sources",
    ]
  ) {
    assert(document.getElementById(id) !== null, `missing #${id}`);
  }

  const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
  assertEquals(new Set(ids).size, ids.length, "document ids must be unique");

  const providerItems = [
    ...document.querySelectorAll(".agents-provider-cloud li"),
  ];
  assertEquals(providerItems.length, AGENT_NAMES.length);
  assertEquals(
    providerItems.map((item) => item.textContent?.trim()),
    AGENT_NAMES.map((name) => PROVIDERS[name].label),
  );

  for (const route of REQUIRED_MACHINE_ROUTES) {
    assert(
      document.querySelector(`.agents-sources a[href="${route}"]`) !== null,
      `missing exact source route ${route}`,
    );
  }
  assertEquals(document.querySelectorAll(".agents-terms").length, 1);
  assertEquals(document.querySelectorAll(".agents-provider-note").length, 1);

  const themeToggle = document.querySelector("[data-theme-toggle]");
  assert(themeToggle?.classList.contains("discern-theme-toggle--outlined"));
  assertEquals(themeToggle?.hasAttribute("aria-pressed"), false);
});

Deno.test("the machine guide projects supported providers from the live registry", async () => {
  const source = await Deno.readTextFile(
    new URL(`../site/${TEXT_EDITION}`, import.meta.url),
  );
  assertStringIncludes(source, SUPPORTED_PROVIDER_NAMES_MARKER);
  const rendered = renderTextEdition(source);
  assert(!rendered.includes(SUPPORTED_PROVIDER_NAMES_MARKER));
  for (const name of AGENT_NAMES) {
    assertStringIncludes(rendered, PROVIDERS[name].label);
  }

  const response = await handler(
    new Request("https://discern.sh/agents", { headers: CURL }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.text(), rendered);
});
