/**
 * Unit coverage for the strict, dependency-free guidance template engine
 * (`src/engine/guidance_template.ts`): `{{var}}` substitution, `{{#if}}` /
 * `{{else}}` blocks (including nesting), and the strictness that turns a typo into
 * a loud compile error rather than blank output. The config→context mapping and
 * the determinism/currency guards live in `guidance_render_test.ts`.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type GuidanceContext,
  GuidanceTemplateError,
  renderGuidanceTemplate,
} from "../src/engine/guidance_template.ts";

const CTX: GuidanceContext = {
  vars: { name: "discern", branch: "agent/" },
  preds: { yes: true, no: false },
};

Deno.test("renderGuidanceTemplate: literal text passes through untouched", () => {
  const t = "# Heading\n\nA paragraph with no tags.\n";
  assertEquals(renderGuidanceTemplate(t, CTX), t);
});

Deno.test("renderGuidanceTemplate: {{var}} substitutes (ignoring inner whitespace)", () => {
  assertEquals(
    renderGuidanceTemplate("use {{name}} on {{ branch }}x", CTX),
    "use discern on agent/x",
  );
});

Deno.test("renderGuidanceTemplate: {{#if}} includes the body when true, drops it when false", () => {
  assertEquals(renderGuidanceTemplate("a{{#if yes}}B{{/if}}c", CTX), "aBc");
  assertEquals(renderGuidanceTemplate("a{{#if no}}B{{/if}}c", CTX), "ac");
});

Deno.test("renderGuidanceTemplate: {{else}} selects the branch", () => {
  assertEquals(
    renderGuidanceTemplate("{{#if yes}}T{{else}}F{{/if}}", CTX),
    "T",
  );
  assertEquals(
    renderGuidanceTemplate("{{#if no}}T{{else}}F{{/if}}", CTX),
    "F",
  );
});

Deno.test("renderGuidanceTemplate: variables work inside an {{#if}} body", () => {
  assertEquals(
    renderGuidanceTemplate("{{#if yes}}hi {{name}}{{/if}}", CTX),
    "hi discern",
  );
});

Deno.test("renderGuidanceTemplate: {{#if}} nests inside {{#if}}", () => {
  const t = "{{#if yes}}[{{#if no}}x{{else}}{{name}}{{/if}}]{{/if}}";
  assertEquals(renderGuidanceTemplate(t, CTX), "[discern]");
});

Deno.test("renderGuidanceTemplate: an unknown variable throws (never a silent blank)", () => {
  const err = assertThrows(
    () => renderGuidanceTemplate("x {{nope}} y", CTX),
    GuidanceTemplateError,
  );
  assert(err.message.includes("nope"));
});

Deno.test("renderGuidanceTemplate: an unknown predicate throws", () => {
  assertThrows(
    () => renderGuidanceTemplate("{{#if maybe}}x{{/if}}", CTX),
    GuidanceTemplateError,
    "maybe",
  );
});

Deno.test("renderGuidanceTemplate: a typo in an UNREACHABLE branch still throws (validated whole-tree)", () => {
  // `no` is false, so the body never renders — but the bad name must still fail
  // the compile, so it can't lurk until a project's config flips the predicate.
  assertThrows(
    () => renderGuidanceTemplate("{{#if no}}{{bogus}}{{/if}}", CTX),
    GuidanceTemplateError,
    "bogus",
  );
});

Deno.test("renderGuidanceTemplate: unbalanced and stray block tags are rejected", () => {
  assertThrows(
    () => renderGuidanceTemplate("{{#if yes}}x", CTX),
    GuidanceTemplateError,
    "unclosed",
  );
  assertThrows(
    () => renderGuidanceTemplate("x{{/if}}", CTX),
    GuidanceTemplateError,
    "stray",
  );
  assertThrows(
    () => renderGuidanceTemplate("{{#if yes}}a{{else}}b{{else}}c{{/if}}", CTX),
    GuidanceTemplateError,
  );
});

Deno.test("renderGuidanceTemplate: malformed tags are rejected", () => {
  // empty tag, a bad if shape, and a non-name variable.
  assertThrows(
    () => renderGuidanceTemplate("{{}}", CTX),
    GuidanceTemplateError,
  );
  assertThrows(
    () => renderGuidanceTemplate("{{#if}}x{{/if}}", CTX),
    GuidanceTemplateError,
    "#if",
  );
  assertThrows(
    () => renderGuidanceTemplate("{{Bad-Name}}", CTX),
    GuidanceTemplateError,
  );
});

Deno.test("renderGuidanceTemplate: a lone {{ with no close is literal text", () => {
  // Not a well-formed tag, so it is preserved rather than treated as an error —
  // matches the 'deliberately dumb' contract documented on the module.
  const t = "a {{ b";
  assertEquals(renderGuidanceTemplate(t, CTX), t);
});
