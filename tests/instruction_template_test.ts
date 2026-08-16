/**
 * Unit coverage for the strict, dependency-free instructions template engine
 * (`src/engine/instruction_template.ts`): `{{var}}` substitution, `{{#if}}` /
 * `{{else}}` blocks (including nesting), and the strictness that turns a typo into
 * a loud compile error rather than blank output. The config→context mapping and
 * the determinism/currency guards live in `instruction_render_test.ts`.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type InstructionContext,
  InstructionTemplateError,
  renderInstructionTemplate,
} from "../src/engine/instruction_template.ts";

const CTX: InstructionContext = {
  vars: { name: "discern", branch: "agent/" },
  preds: { yes: true, no: false },
};

Deno.test("renderInstructionTemplate: literal text passes through untouched", () => {
  const t = "# Heading\n\nA paragraph with no tags.\n";
  assertEquals(renderInstructionTemplate(t, CTX), t);
});

Deno.test("renderInstructionTemplate: {{var}} substitutes (ignoring inner whitespace)", () => {
  assertEquals(
    renderInstructionTemplate("use {{name}} on {{ branch }}x", CTX),
    "use discern on agent/x",
  );
});

Deno.test("renderInstructionTemplate: {{#if}} includes the body when true, drops it when false", () => {
  assertEquals(renderInstructionTemplate("a{{#if yes}}B{{/if}}c", CTX), "aBc");
  assertEquals(renderInstructionTemplate("a{{#if no}}B{{/if}}c", CTX), "ac");
});

Deno.test("renderInstructionTemplate: {{else}} selects the branch", () => {
  assertEquals(
    renderInstructionTemplate("{{#if yes}}T{{else}}F{{/if}}", CTX),
    "T",
  );
  assertEquals(
    renderInstructionTemplate("{{#if no}}T{{else}}F{{/if}}", CTX),
    "F",
  );
});

Deno.test("renderInstructionTemplate: variables work inside an {{#if}} body", () => {
  assertEquals(
    renderInstructionTemplate("{{#if yes}}hi {{name}}{{/if}}", CTX),
    "hi discern",
  );
});

Deno.test("renderInstructionTemplate: {{#if}} nests inside {{#if}}", () => {
  const t = "{{#if yes}}[{{#if no}}x{{else}}{{name}}{{/if}}]{{/if}}";
  assertEquals(renderInstructionTemplate(t, CTX), "[discern]");
});

Deno.test("renderInstructionTemplate: an unknown variable throws (never a silent blank)", () => {
  const err = assertThrows(
    () => renderInstructionTemplate("x {{nope}} y", CTX),
    InstructionTemplateError,
  );
  assert(err.message.includes("nope"));
});

Deno.test("renderInstructionTemplate: an unknown predicate throws", () => {
  assertThrows(
    () => renderInstructionTemplate("{{#if maybe}}x{{/if}}", CTX),
    InstructionTemplateError,
    "maybe",
  );
});

Deno.test("renderInstructionTemplate: a typo in an UNREACHABLE branch still throws (validated whole-tree)", () => {
  // `no` is false, so the body never renders — but the bad name must still fail
  // the compile, so it can't lurk until a project's config flips the predicate.
  assertThrows(
    () => renderInstructionTemplate("{{#if no}}{{bogus}}{{/if}}", CTX),
    InstructionTemplateError,
    "bogus",
  );
});

Deno.test("renderInstructionTemplate: unbalanced and stray block tags are rejected", () => {
  assertThrows(
    () => renderInstructionTemplate("{{#if yes}}x", CTX),
    InstructionTemplateError,
    "unclosed",
  );
  assertThrows(
    () => renderInstructionTemplate("x{{/if}}", CTX),
    InstructionTemplateError,
    "stray",
  );
  assertThrows(
    () =>
      renderInstructionTemplate("{{#if yes}}a{{else}}b{{else}}c{{/if}}", CTX),
    InstructionTemplateError,
  );
});

Deno.test("renderInstructionTemplate: malformed tags are rejected", () => {
  // empty tag, a bad if shape, and a non-name variable.
  assertThrows(
    () => renderInstructionTemplate("{{}}", CTX),
    InstructionTemplateError,
  );
  assertThrows(
    () => renderInstructionTemplate("{{#if}}x{{/if}}", CTX),
    InstructionTemplateError,
    "#if",
  );
  assertThrows(
    () => renderInstructionTemplate("{{Bad-Name}}", CTX),
    InstructionTemplateError,
  );
});

Deno.test("renderInstructionTemplate: a lone {{ with no close is literal text", () => {
  // Not a well-formed tag, so it is preserved rather than treated as an error —
  // matches the 'deliberately dumb' contract documented on the module.
  const t = "a {{ b";
  assertEquals(renderInstructionTemplate(t, CTX), t);
});
