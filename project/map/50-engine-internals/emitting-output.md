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

The failure form is the danger line (state the condition, name the object), optionally followed by one recovery group carrying the next step. A message that already ends with its next step stays a single `log.error(...)`; a distinct actionable command gets the recovery group. A refusal with several detail groups composes the same primitives directly: `error`, then `group(id)` and indented `humanLine` items per group. The retired `discern:` prefix never returns: the package-owned `✕` glyph is discern's voice, and only raw child-process bytes reach the terminal without it.

## Where interaction and Components enter

Interactive input goes through [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) — the sole product choke point over the package's `request*` primitives; selection lists group through `groupedSelectionEntries`. A destructive confirmation goes through `confirmDestructiveAction`: it presents the package's scope, impact, authority, and recovery notice only on the interactive human path, then asks the continuation question. A bounded, reversible act goes through `confirmDialogAction`, whose neutral Dialog names the act, scope, consequence, and choices without implying danger. Suppressed and machine paths emit no frame, so their established plan and result projections stay unchanged. Larger visual structures (Sections, Results, meters, tables) come from the published design-system package through the presenter bound in [`terminal.ts`](../../../src/lib/terminal.ts). Call sites supply safe product facts and any explicit local measure. Capabilities and theme stay bound in the terminal context. An embedded package Heading passes `leadingBlankLines: 0` and lets the sink own the transition ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)). Rendered Component frames reach the terminal through `out.raw(...)` or `log.humanLine(...)`/`log.line(...)`, between declared groups.

Component choice follows the result semantics. EmptyState represents a genuinely empty collection. Diffstat represents an actual added/removed line pair. A changed-file count, collision total, byte count, or lifecycle outcome uses prose or its existing Result component. Every Component receives the facts its props declare.

Outside the authority there are only protocol surfaces: the machine envelope chokepoint ([`emit.ts`](../../../src/shared/emit.ts)), scalar stdout values for shell capture, raw document bodies, the crash frame, and project-owned child streams. [`human_output_grouping_test.ts`](../../../tests/human_output_grouping_test.ts) names each one with an exact count; a new direct `console.log`, a hand-emitted boundary newline, a narration glyph outside the authority, or `padEnd` alignment in a shipped human surface fails the gate.
