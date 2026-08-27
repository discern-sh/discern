/** RFC 9116 serving, expiry maintenance, and human-policy parity. */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  SECURITY_DISCLOSURE,
  securityTxt,
  securityTxtFields,
} from "../site/security.ts";
import { handler } from "../site/serve.ts";
import { canonicalUrl } from "../site/seo.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

Deno.test("security.txt serves the exact RFC 9116 disclosure registry", async () => {
  const response = await handler(
    new Request(canonicalUrl(SECURITY_DISCLOSURE.route)),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.text();
  assertEquals(body, securityTxt());

  assert(body.endsWith("\n"), "every security.txt field must end with LF");
  const fields = body.trimEnd().split("\n").map((line) => {
    const match = /^([A-Za-z][A-Za-z-]*): (\S(?:.*\S)?)$/.exec(line);
    assert(match !== null, `invalid security.txt field: ${line}`);
    return { name: match[1] ?? "", value: match[2] ?? "" };
  });
  const contacts = fields.filter((field) => field.name === "Contact");
  const expires = fields.filter((field) => field.name === "Expires");
  assert(contacts.length > 0, "RFC 9116 requires at least one Contact field");
  assertEquals(
    expires.length,
    1,
    "RFC 9116 requires exactly one Expires field",
  );
  assertEquals(
    fields.filter((field) => field.name === "Canonical").map((field) =>
      field.value
    ),
    [canonicalUrl(SECURITY_DISCLOSURE.route)],
  );
  assertEquals(
    fields.filter((field) => field.name === "Policy").map((field) =>
      field.value
    ),
    [SECURITY_DISCLOSURE.policyUrl],
  );
  assertEquals(
    fields,
    [...securityTxtFields()],
    "the wire fields must match the disclosure registry",
  );
  for (const contact of contacts) {
    const protocol = new URL(contact.value).protocol;
    assert(
      protocol === "mailto:" || protocol === "https:",
      `unsupported Contact URI: ${contact.value}`,
    );
  }
  assertEquals(
    fields.filter((field) => field.name === "Preferred-Languages").map(
      (field) => field.value,
    ),
    [SECURITY_DISCLOSURE.preferredLanguages.join(", ")],
  );

  const sitemap = await handler(new Request(canonicalUrl("/sitemap.xml")));
  assert(
    !(await sitemap.text()).includes(SECURITY_DISCLOSURE.route),
    "security.txt is a machine endpoint, not a canonical HTML page",
  );
});

Deno.test("security.txt expiry stays current without exceeding one year", () => {
  const expiresAt = Date.parse(SECURITY_DISCLOSURE.expiresAt);
  assert(
    Number.isFinite(expiresAt),
    `invalid RFC 3339 expiry: ${SECURITY_DISCLOSURE.expiresAt}`,
  );
  const remaining = expiresAt - SYSTEM_CLOCK.wallNow();
  const reviewLead = SECURITY_DISCLOSURE.expiryReviewLeadDays * DAY_MS;
  const maximumValidity = SECURITY_DISCLOSURE.maximumValidityDays * DAY_MS;
  assert(
    remaining >= reviewLead,
    `security.txt expires at ${SECURITY_DISCLOSURE.expiresAt}; ` +
      `renew it at least ${SECURITY_DISCLOSURE.expiryReviewLeadDays} days ahead`,
  );
  assert(
    remaining < maximumValidity,
    `security.txt expiry must remain less than ` +
      `${SECURITY_DISCLOSURE.maximumValidityDays} days away`,
  );
});

Deno.test("SECURITY.md uses the registered private reporting channels", async () => {
  const policy = await Deno.readTextFile(
    new URL("../SECURITY.md", import.meta.url),
  );
  const mailtoLinks = [...policy.matchAll(/\(mailto:([^)]+)\)/g)].map(
    (match) => match[1] ?? "",
  );
  const advisoryLinks = [...policy.matchAll(
    /\(https:\/\/github\.com\/[^)]+\/security\/advisories\/new\)/g,
  )].map((match) => match[0].slice(1, -1));

  assertEquals(mailtoLinks, [SECURITY_DISCLOSURE.contactEmail]);
  assertEquals(advisoryLinks, [SECURITY_DISCLOSURE.advisoryUrl]);
  assertStringIncludes(policy, "Do not open a public issue.");
  assertEquals(
    SECURITY_DISCLOSURE.policyUrl,
    `${SECURITY_DISCLOSURE.repositoryUrl}/blob/main/SECURITY.md`,
  );
});
