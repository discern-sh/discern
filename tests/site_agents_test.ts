/** Structural guards for the public agent-native page and machine guide. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import { JSDOM } from "jsdom";
import { proseWordCount } from "../scripts/prose_lib.ts";
import { projectSiteProse } from "../scripts/site_prose_lib.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { AGENTS_TITLE } from "../site/brand.ts";
import {
  AGENTS_PROSE_WORD_CEILING,
  CLOSING_ENVELOPE,
} from "../site/page-src/agents-content.ts";
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
    "Finally, software where you are the user.",
  );
  for (
    const id of [
      "main",
      "recognition",
      "agent-ergonomics",
      "context",
      "continuity",
      "proof",
      "authority",
      "not-included",
      "next-actions",
      "evaluate",
    ]
  ) {
    assert(document.getElementById(id) !== null, `missing #${id}`);
  }

  const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
  assertEquals(new Set(ids).size, ids.length, "document ids must be unique");

  const providerItems = [
    ...document.querySelectorAll(".agents-compiler__outputs article"),
  ];
  assertEquals(providerItems.length, AGENT_NAMES.length);
  assertEquals(
    providerItems.map((item) => item.children.item(1)?.textContent?.trim()),
    AGENT_NAMES.map((name) => PROVIDERS[name].label),
  );
  assertEquals(
    providerItems.map((item) => item.querySelector("code")?.textContent),
    AGENT_NAMES.map((name) => PROVIDERS[name].instructionFile.path),
  );

  for (const route of REQUIRED_MACHINE_ROUTES) {
    assert(
      document.querySelector(`a[href="${route}"]`) !== null,
      `missing exact source route ${route}`,
    );
  }
  assertEquals(document.querySelector('a[href="/agents.md"]'), null);
  assertEquals(document.querySelector("[data-theme-toggle]"), null);
});

Deno.test("the page's advertised word ceiling is the gated standard, and holds", async () => {
  const config = parse(
    await Deno.readTextFile(new URL("../discern.toml", import.meta.url)),
  ) as { standards?: { agents_page_words?: { limit?: number } } };
  assertEquals(
    config.standards?.agents_page_words?.limit,
    AGENTS_PROSE_WORD_CEILING,
    "discern.toml and the page must advertise one ceiling",
  );

  const envelope = JSON.parse(CLOSING_ENVELOPE) as {
    data: { prose_word_ceiling: number; your_context: string };
  };
  assertEquals(envelope.data.prose_word_ceiling, AGENTS_PROSE_WORD_CEILING);
  assertStringIncludes(
    envelope.data.your_context,
    String(AGENTS_PROSE_WORD_CEILING),
  );

  const dom = new JSDOM(renderAgents());
  const meter =
    dom.window.document.querySelector(".agents-context__meter")?.textContent ??
      "";
  assertStringIncludes(
    meter,
    AGENTS_PROSE_WORD_CEILING.toLocaleString("en-US"),
  );

  const page = projectSiteProse().find(({ route }) => route === "/agents");
  assert(page !== undefined, "the marketing registry must serve /agents");
  const words = proseWordCount(page.prose);
  assert(
    words <= AGENTS_PROSE_WORD_CEILING,
    `/agents prose is ${words} words; the advertised ceiling is ${AGENTS_PROSE_WORD_CEILING}`,
  );
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
  assertStringIncludes(
    response.headers.get("content-type") ?? "",
    "text/plain",
  );
  assertEquals(await response.text(), rendered);
});
