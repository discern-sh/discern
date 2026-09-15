/** Enduring HTML invariants for the server-rendered release comparison. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import {
  INSTALL_COMMAND,
  UPDATE_SEQUENCE,
} from "../src/shared/product_identity.ts";
import { loadReleaseCatalogue } from "../site/releases/catalogue.ts";
import {
  type CatalogueRecord,
  compareReleases,
  comparisonSchema,
} from "../site/releases/model.ts";
import { renderReleaseHtml } from "../site/releases/render.ts";
import { handlerWithRouting } from "../site/serve.ts";
import {
  releasePageCatalogue,
  releasePageRouting,
} from "./release_page_fixtures.ts";

/** Audit HTML without executing site JavaScript; comparison and notes must already exist. */
async function assertPage(
  records: readonly CatalogueRecord[],
  since?: string,
): Promise<string> {
  const model = compareReleases(records, since);
  const dom = new JSDOM(renderReleaseHtml(model), {
    runScripts: "outside-only",
  });
  const document = dom.window.document;
  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(document.querySelectorAll("main").length, 1);
  assertEquals(document.querySelectorAll("[data-release-status]").length, 1);
  assertEquals(
    document.querySelector("[data-release-status]")?.getAttribute(
      "data-release-status",
    ),
    model.status,
  );
  assertEquals(
    document.querySelectorAll("[data-release-version]").length,
    records.length,
  );
  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(new Set(ids).size, ids.length);
  for (const record of records) {
    const entry = document.getElementById(`release-${record.version}`);
    assert(entry);
    assertEquals(
      entry.getAttribute("data-release-publication"),
      record.publication,
    );
    assertEquals(entry.closest("details, [hidden], [aria-hidden=true]"), null);
    assertStringIncludes(
      entry.querySelector("h3")?.textContent ?? "",
      record.version,
    );
    if (record.codename !== undefined) {
      assertStringIncludes(
        entry.querySelector("h3")?.textContent ?? "",
        record.codename,
      );
    }
    if (record.publication !== "candidate") {
      assertEquals(entry.querySelector("time")?.dateTime, record.date);
    }
    assertStringIncludes(entry.textContent ?? "", record.summary);
  }
  let level = 0;
  for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const next = Number(heading.tagName.slice(1));
    assert(next <= level + 1, `heading level skips ${level} to ${next}`);
    level = next;
  }
  for (
    const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
  ) {
    assert(
      document.getElementById(decodeURIComponent(link.hash.slice(1))),
      link.href,
    );
  }
  const disclosure = document.querySelector("[data-release-disclosure]");
  assert(disclosure);
  assert(disclosure.closest("[data-release-status]"));
  assertEquals(disclosure.closest("details, [hidden]"), null);
  if (since !== undefined) {
    assertStringIncludes(disclosure.textContent ?? "", since);
  }
  assertEquals(
    document.querySelector("#update") !== null,
    model.status === "update-available",
  );
  if (model.status === "update-available") {
    assertEquals(
      document.querySelector("#update code")?.textContent,
      INSTALL_COMMAND,
    );
    assertEquals(
      [...document.querySelectorAll("#update li")].map((step) =>
        step.textContent?.replace(/\s+/g, " ").trim()
      ),
      [...UPDATE_SEQUENCE],
    );
    assertEquals(
      [...document.querySelectorAll("[data-release-ref]")].map((link) =>
        link.getAttribute("data-release-ref")
      ),
      model.applicable.map((record) => record.version),
    );
  } else assert(!document.body.textContent?.includes(INSTALL_COMMAND));
  for (
    const asset of document.querySelectorAll(
      "script[src], link[rel=stylesheet], link[rel=icon]",
    )
  ) {
    const url = asset.getAttribute("src") ?? asset.getAttribute("href") ?? "";
    assert(url.startsWith("/assets/"), url);
  }
  dom.window.eval(axe.source);
  const result = await (dom.window as unknown as { axe: typeof axe }).axe.run(
    document,
    {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
      rules: { "color-contrast": { enabled: false } },
    },
  );
  assertEquals([...result.violations].map((violation) => violation.id), []);
  dom.window.close();
  return model.status;
}

Deno.test("release HTML covers all normalized states and real records without client computation", async () => {
  const catalogue = releasePageCatalogue();
  const seen = new Set<string>();
  for (
    const since of [
      undefined,
      "7.8.2",
      "7.8.1",
      "7.8.0",
      "9.0.0-dev.1",
      "7.8.2-rc.1",
      "7.8.2+local.build",
      "0.1.0",
    ]
  ) {
    seen.add(await assertPage(catalogue, since));
  }
  const prereleases = catalogue.filter((record) =>
    record.publication === "prerelease"
  );
  seen.add(await assertPage(prereleases, "7.8.2"));
  seen.add(await assertPage([], undefined));
  await assertPage(await loadReleaseCatalogue());
  assertEquals(
    [...seen].sort(),
    [...comparisonSchema.shape.status.options].sort(),
  );
});

Deno.test("query metadata, errors, HEAD, and negotiation retain their route contracts", async () => {
  const routing = await releasePageRouting(releasePageCatalogue());
  for (
    const query of [
      "",
      "?since=7.8.0",
      "?since=7.8.2%2Blocal.build",
      "?since=9.0.0",
      "?since=wrong",
      "?since=7.8.0&since=7.8.0",
    ]
  ) {
    const invalid = query.includes("wrong") || query.includes("&");
    const url = `https://discern.sh/releases${query}`;
    const response = await handlerWithRouting(
      new Request(url, { headers: { accept: "text/html" } }),
      routing,
    );
    assertEquals(response.status, invalid ? 400 : 200);
    assertEquals(
      response.headers.get("x-robots-tag"),
      query ? "noindex, follow" : null,
    );
    assertEquals(
      response.headers.get("cache-control"),
      invalid ? "no-store" : "public, max-age=300",
    );
    assertEquals(response.headers.get("vary"), "Accept, User-Agent");
    assert(response.headers.has("content-security-policy"));
    const dom = new JSDOM(await response.text());
    const document = dom.window.document;
    assertEquals(
      document.querySelector("link[rel=canonical]")?.getAttribute("href"),
      "https://discern.sh/releases",
    );
    assertEquals(
      document.querySelector('meta[property="og:url"]')?.getAttribute(
        "content",
      ),
      "https://discern.sh/releases",
    );
    assertEquals(document.querySelectorAll("h1").length, 1);
    for (const script of document.querySelectorAll("script:not([src])")) {
      assert(script.getAttribute("nonce"));
    }
    if (invalid) {
      assert(document.querySelector('main a[href="/releases"]'));
      assertEquals(document.querySelector("#update"), null);
      assert(!document.body.textContent?.includes(INSTALL_COMMAND));
    }
    dom.window.close();
    const head = await handlerWithRouting(
      new Request(url, { method: "HEAD", headers: { accept: "text/html" } }),
      routing,
    );
    assertEquals(head.status, response.status);
    assertEquals(await head.text(), "");
    const text = await handlerWithRouting(
      new Request(url, { headers: { accept: "text/plain" } }),
      routing,
    );
    assertStringIncludes(text.headers.get("content-type") ?? "", "text/plain");
    assertEquals(text.status, response.status);
    assert(!(await text.text()).includes("<!doctype html>"));
  }
});
