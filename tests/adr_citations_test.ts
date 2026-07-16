/**
 * The ADR citation pipeline: the normalized strippable form, the stripper,
 * the collector, and the gate's malformed-reference check. The invariant the
 * fixtures pin: prose reads correctly with the citations deleted, and no
 * citation ever escapes collection or survives into human-rendered prose.
 */

import { assert, assertEquals } from "@std/assert";
import {
  collectAdrCitations,
  findMalformedAdrReferences,
  stripAdrCitations,
} from "../src/lib/adr_citations.ts";

const PAGE = `# The landing model

The trunk is the one landing target ([ADR 0110](../_adr/0110-the-landing-model.md));
acceptance fast-forwards it. Metrics replay with input keys ([ADR 0003](../_adr/0003-standards.md), [ADR 0059](../_adr/0059-replay.md)).

Wrapped citations rejoin their clause
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)) when stripped.

\`\`\`
code fences keep everything: (ADR 0001) and ([ADR 0002](../_adr/0002-x.md))
\`\`\`

Inline code keeps \`(ADR 0017)\` too. A repeat citation dedupes
([ADR 0110](../_adr/0110-the-landing-model.md)).
`;

Deno.test("stripAdrCitations round-trips a page to grammatical prose", () => {
  const stripped = stripAdrCitations(PAGE);
  assertEquals(
    stripped,
    `# The landing model

The trunk is the one landing target;
acceptance fast-forwards it. Metrics replay with input keys.

Wrapped citations rejoin their clause when stripped.

\`\`\`
code fences keep everything: (ADR 0001) and ([ADR 0002](../_adr/0002-x.md))
\`\`\`

Inline code keeps \`(ADR 0017)\` too. A repeat citation dedupes.
`,
  );
  // Nothing citation-shaped survives outside code.
  assert(!stripped.replace(/```[\s\S]*?```/g, "").includes("[ADR "));
});

Deno.test("collectAdrCitations gathers cited decisions in order, deduplicated", () => {
  assertEquals(collectAdrCitations(PAGE), [
    {
      number: "0110",
      slug: "the-landing-model",
      path: "../_adr/0110-the-landing-model.md",
    },
    { number: "0003", slug: "standards", path: "../_adr/0003-standards.md" },
    { number: "0059", slug: "replay", path: "../_adr/0059-replay.md" },
    {
      number: "0028",
      slug: "result-envelope-and-diagnostics",
      path: "../_adr/0028-result-envelope-and-diagnostics.md",
    },
  ]);
});

Deno.test("a normalized page passes the gate check; code-only refs never fail it", () => {
  assertEquals(findMalformedAdrReferences(PAGE), []);
});

Deno.test("bare text references fail the normalized-form check", () => {
  const issues = findMalformedAdrReferences(
    "Generated files never drift (ADR 0034, ADR 0128).\n",
  );
  assertEquals(issues.length, 2);
  assertEquals(issues[0]?.line, 1);
  assert(issues[0]?.reason.includes("bare text reference"), issues[0]?.reason);
});

Deno.test("a linked citation woven in as a grammatical subject fails", () => {
  const issues = findMalformedAdrReferences(
    "Per [ADR 0074](../_adr/0074-co-owned-mcp-json.md), the file is co-owned.\n",
  );
  assertEquals(issues.length, 1);
  assert(
    issues[0]?.reason.includes("outside a parenthetical group"),
    issues[0]?.reason,
  );
});

Deno.test("a citation whose destination disagrees with its number fails", () => {
  const mismatch = findMalformedAdrReferences(
    "At clause end ([ADR 0110](../_adr/0111-wrong.md)).\n",
  );
  assertEquals(mismatch.length, 1);
  assert(mismatch[0]?.reason.includes("links 0111"), mismatch[0]?.reason);

  const stray = findMalformedAdrReferences(
    "At clause end ([ADR 0110](../guides/elsewhere.md)).\n",
  );
  assertEquals(stray.length, 1);
  assert(
    stray[0]?.reason.includes("not an `_adr/NNNN-slug.md` record"),
    stray[0]?.reason,
  );
});

Deno.test("the stripper leaves malformed references alone — the gate owns those", () => {
  const subject = "Per [ADR 0074](../_adr/0074-co-owned.md), it is co-owned.\n";
  assertEquals(stripAdrCitations(subject), subject);
});
