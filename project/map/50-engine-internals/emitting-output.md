---
title: Emitting output from a new verb
description: The one blessed pattern for narration lines, groups, aligned listings, and errors with recovery.
order: 47
aliases:
  - output recipe
  - narration authority
  - aligned listing
  - error idiom
  - Out and Logger
---

# Emitting output from a new verb

_One narration authority, one boundary-owning sink, one aligned-listing policy, one error form. Copy these patterns; the guards reject every other spelling._

[`narration.ts`](../../../src/lib/narration.ts) renders every small terminal-output verb once through the bound package presenter: the glyph lines (`◮` info, `✓` success, `!` warning, `✕` danger), the strong heading, the `──` ruled group label, and the blank-line boundary between semantic groups ([ADR 0250](../_adr/0250-discern-managed-human-output-declares-semantic-groups.md)). The package narration verbs own glyph choice, colour, wrapping, and ASCII degradation; the product sink owns streams and rhythm. Its sink tracks the trailing blank state of everything written, so a block declares "one blank line before me" and receives it mechanically. No caller writes a boundary newline; the sink owns them all.

`Out` and `Logger` are its stream configurations. The engine's `Out` ([`output.ts`](../../../src/engine/output.ts)) narrates on stdout with warnings and errors on stderr, plus a raw stdout channel. The installer's `Logger` ([`log.ts`](../../../src/lib/log.ts)) narrates on stderr when stdout is reserved for a result and keeps `line()` as the always-stdout content channel. Both fall silent in quiet result mode: the selected JSON or Markdown result is the entire output ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

## A narration line

```ts
const log = new Logger({ json: opts.json, noColor: opts.noColor });
log.info("Scanning the configured sources.");
log.ok("Sources are current.");
log.warn("One source is missing; the default applies.");
```

Dynamic facts are made inert by the authority itself (`terminalLine` runs inside `info`/`ok`/`warn`/`error`/`heading`/`detail` and group labels). `humanLine` and `line` emit verbatim — sanitize what you interpolate.

## A group

```ts
log.info("Checked 3 sources.");
log.group("findings", "Findings");
log.info("Two files drifted.");
```

`group(id, label?)` asserts a stable, non-rendered id, lets the sink place its blank line, and draws the ruled label when given. Repeated boundaries never accumulate. `heading(text)` is the strong banner form; it owns one leading blank line the same way, so a heading directly after a group never double-spaces.

## An aligned listing

```ts
import { renderAlignedRows } from "../lib/text.ts";

for (
  const row of renderAlignedRows(entries.map((entry) => ({
    label: terminalLine(entry.name),
    body: terminalLine(entry.summary),
  })))
) log.line(row);
```

[`renderAlignedRows`](../../../src/lib/text.ts) is the single column policy: widest label capped (default 32; pass `labelCap` to tighten), a two-cell gutter, and body wrap with a hanging indent when you pass `width`, stacking whenever the body column would fall under 24 cells, with hard-broken overlong labels so no line overflows. Multi-section listings that must share one column compute it once with `alignedLabelWidth` and pass `labelWidth`. Style hooks (`styleLabel`, `styleBody`) apply after geometry. Never hand-pad with `padEnd`; the guard rejects it.

## An error, with recovery

```ts
import { reportFailure } from "../lib/narration.ts";

reportFailure(log, "the requested page is missing.", [
  "Run: discern map",
]);
```

The failure form is the danger line (state the condition, name the object), optionally followed by one recovery group carrying the next step. A message that already ends with its next step stays a single `log.error(...)`; a distinct actionable command gets the recovery group. A product-composed message whose paragraphs carry the meaning (a batched refusal, an issue list) goes through `errorBlock`: authored newlines stay real structure, each line's dynamic facts are made inert, and every line wraps under the glyph. Captured foreign text stays on `error`, where every separator renders visible. A refusal with several detail groups composes the same primitives directly: `error`, then `group(id)` and indented `humanLine` items per group. The retired `discern:` prefix never returns: the package-owned `✕` glyph is discern's voice, and only raw child-process bytes reach the terminal without it.

## Where interaction and Components enter

Interactive input goes through [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts), the sole product choke point over the package's `request*` primitives. Selection lists and the Markdown browser both project headings through `groupedSelectionEntries`. A destructive confirmation goes through `confirmDestructiveAction`: it presents the package's scope, impact, authority, and recovery notice only on the interactive human path, then asks the continuation question. A bounded, reversible act goes through `confirmDialogAction`, whose neutral Dialog names the act, scope, consequence, and choices without implying danger. Suppressed and machine paths emit no frame, so their established plan and result projections stay unchanged.

The Markdown-browser adapter passes admitted product entries, theme, motif, process-owned terminal IO, and a closed link resolver to the package. The package owns its alternate screen, raw input, mouse tracking, pane state, rendering, and restoration. Actions and external links return only after restoration; the command then performs the product effect and resumes with the package's opaque state. Only typed capability and minimum-geometry refusals select the sequential reader. Other faults remain visible failures instead of starting a second interaction.

Larger visual structures (Sections, Results, meters, tables) come from the published design-system package through the presenter bound in [`terminal.ts`](../../../src/lib/terminal.ts). Call sites supply safe product facts and any explicit local measure. Capabilities, theme, and process-owned terminal IO stay bound at that boundary. `--theme auto` senses a coloured interactive TTY background once and defaults to dark when unknown; `light` and `dark` bypass sensing. `--no-color`, `NO_COLOR`, CI static output, machine modes, and non-TTY paths never sense; explicit variants remain selected without colour. An embedded package Heading passes `leadingBlankLines: 0` and lets the sink own the transition ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)). Rendered Component frames reach the terminal through `out.raw(...)` or `log.humanLine(...)`/`log.line(...)`, between declared groups.

Component choice follows the result semantics. EmptyState represents a genuinely empty collection. Diffstat represents an actual added/removed line pair. The package `Callout` represents an explicit GFM admonition or the installed decision-record redirect. Markdown quotations keep their quote rail, and search truncation keeps its muted status line. A changed-file count, collision total, byte count, or lifecycle outcome uses prose or its existing Result component. Every Component receives the facts its props declare.

## Structured advisories

An advisory carrying a command, path, configuration key, flag, provider id, or member-framing rule stores that literal as typed data before presentation. Scope previews use `PreviewActionData`; provider activation uses the records in [`provider_trust.ts`](../../../src/shared/provider_trust.ts); generated inventories name a policy from [`GENERATED_INVENTORY_POLICIES`](../../../src/shared/generated_inventory_policy.ts). Terminal and Markdown renderers may add surface punctuation, but they do not parse prose or retype literals. JSON and MCP retain the records alongside the human explanation.

The [registry atlas](../_internal/registry-atlas.md) states whether each generated inventory obtains member wording from its registry or a named shared policy, then names its renderer, documentation path, and tests. [`canonical_sets_enrolment_test.ts`](../../../tests/canonical_sets_enrolment_test.ts) treats a future inventory without that account as a missing authority.

Outside the narration authority there are only exact process adapters: the machine envelope chokepoint ([`emit.ts`](../../../src/shared/emit.ts)), scalar stdout values for shell capture, raw document bodies, the crash frame, and supervised child streams. [`PROCESS_OUTPUT_BOUNDARIES`](../../../src/shared/process_boundaries.ts) names each direct console or stream-write operation by stable id, function, channel, purpose, and reason. The bidirectional structural census rejects unknown and stale sites; the falling `process_output_boundaries` Standard prevents the exception population from growing ([ADR 0344](../_adr/0344-process-egress-and-termination-have-exact-boundaries.md)). [`human_output_grouping_test.ts`](../../../tests/human_output_grouping_test.ts) separately holds semantic grouping, so a hand-emitted boundary newline, narration glyph outside the authority, or `padEnd` alignment in a shipped human surface still fails the gate.

A change to human terminal output also follows the [terminal-output review loop](../80-development/reviewing-terminal-output.md): capture the real command before and after, inspect the visual browser rendering, and attach the HTML artifact path to the handoff.
