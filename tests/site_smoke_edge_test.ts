/** Edge exceptions are bounded and retain source and application verification. */
import { assertEquals, assertThrows } from "@std/assert";
import { JSDOM } from "jsdom";
import {
  cloudflareEmailText,
  productionRedirectFailures,
} from "../scripts/site_smoke_edge.ts";

const SCRIPT =
  '<script src="/cdn-cgi/scripts/abcd1234/cloudflare-static/email-decode.min.js"></script>';

/** Encode one synthetic address using the edge's byte transformation. */
function encoded(value: string): string {
  return "42" +
    [...new TextEncoder().encode(value)].map((byte) =>
      (byte ^ 0x42).toString(16).padStart(2, "0")
    ).join("");
}

Deno.test("protected email exceptions require a decoder and matching authored text", () => {
  const source = new JSDOM(
    '<p>reader@example.test</p><a href="mailto:hidden@example.test">Contact</a>',
  );
  for (const value of ["reader@example.test", "hidden@example.test"]) {
    const payload = encoded(value);
    for (
      const markup of [
        `<a href="/cdn-cgi/l/email-protection" data-cfemail="${payload}">protected</a>`,
        `<a href="/cdn-cgi/l/email-protection#${payload}">protected</a>`,
        `<a href="/cdn-cgi/l/email-protection#${payload}"><span data-cfemail="${payload}">protected</span></a>`,
      ]
    ) {
      const page = new JSDOM(markup + SCRIPT);
      const anchor = page.window.document.querySelector("a");
      if (!anchor) throw new Error("fixture anchor missing");
      assertEquals(cloudflareEmailText(anchor, source.window.document), value);
    }
  }
  for (
    const markup of [
      '<a href="/cdn-cgi/l/email-protection#invalid">bad</a>' + SCRIPT,
      `<a href="/cdn-cgi/l/email-protection#${
        encoded("eader@example.test")
      }">partial</a>` + SCRIPT,
      `<a href="/cdn-cgi/l/email-protection#${
        encoded("reader@example")
      }">partial domain</a>` + SCRIPT,
      `<a href="/cdn-cgi/l/email-protection#${
        encoded("reader@example.test")
      }">no script</a>`,
      `<a href="/cdn-cgi/l/email-protection#${
        encoded("stranger@example.test")
      }">unknown</a>` + SCRIPT,
      `<a href="/cdn-cgi/l/email-protection#${
        encoded("reader@example.test")
      }" data-cfemail="${encoded("hidden@example.test")}">mismatch</a>` +
      SCRIPT,
      '<a href="/cdn-cgi/l/email-protection#42424242">nulls</a>' + SCRIPT,
    ]
  ) {
    const anchor = new JSDOM(markup).window.document.querySelector("a");
    if (!anchor) throw new Error("fixture anchor missing");
    assertThrows(() => cloudflareEmailText(anchor, source.window.document));
  }
});

Deno.test("domain checks accept one exact upgrade and retain canonical security checks", async () => {
  const source = "http://discern.sh/docs/";
  const upgrade = "https://discern.sh/docs/";
  const target = "https://discern.sh/docs";
  for (const status of [301, 308]) {
    const seen: string[] = [];
    const checked: string[] = [];
    const failures = await productionRedirectFailures(source, target, (url) => {
      seen.push(url);
      return Promise.resolve(
        url === source
          ? new Response(null, { status, headers: { location: upgrade } })
          : url === upgrade
          ? new Response(null, {
            status: 308,
            headers: { location: target, "x-application": "yes" },
          })
          : new Response("page", { headers: { "x-application": "yes" } }),
      );
    }, (response, label) => {
      checked.push(label);
      return response.headers.has("x-application") ? [] : ["missing security"];
    });
    assertEquals(failures, []);
    assertEquals(seen, [source, upgrade, target]);
    assertEquals(checked.length, 2);
  }
  for (
    const location of [
      "https://elsewhere.test/docs/",
      "https://discern.sh/other",
      target,
    ]
  ) {
    const failures = await productionRedirectFailures(
      source,
      target,
      () =>
        Promise.resolve(
          new Response(null, { status: 301, headers: { location } }),
        ),
      () => ["security still checked"],
    );
    assertEquals(failures.length, 2);
  }
  const insecure = await productionRedirectFailures(
    "https://www.discern.sh/docs/",
    target,
    (url) =>
      Promise.resolve(
        url === target
          ? new Response("page")
          : new Response(null, { status: 308, headers: { location: target } }),
      ),
    () => ["missing application security"],
  );
  assertEquals(insecure.length, 2);
});
