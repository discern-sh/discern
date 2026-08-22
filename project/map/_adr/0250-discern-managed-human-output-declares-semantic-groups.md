# ADR 0250: Discern-managed human output declares semantic groups

> **Amendments.**
>
> - **[ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md) — interaction implementation:** the semantic grouping decision survives. `groupedSelectionEntries` now maps each populated group to a first-class, non-selectable package heading through the sole product interaction choke point; it no longer encodes a fake blank choice or a framework separator. The grouping guard scans shipped `src/**` human surfaces, while the broader Git-derived terminal outlaw rejects direct package-request bypasses in every authored Deno source.
> - **Heading boundary (2026-08-14):** package Heading now owns one leading line by default. A top-level Heading keeps that default; an embedded Heading requests zero; an unlabeled semantic group keeps its explicit output-layer boundary. Exactly one layer owns the transition.
> - **Sink ownership (2026-08-14):** the blank-line rule is unchanged; its enforcement moved from convention to mechanism. One boundary-accounting sink in [`src/lib/narration.ts`](../../../src/lib/narration.ts) owns every group and heading transition: `Out` and `Logger` are stream configurations of a single narration implementation, and a block declares "one blank line before me" and receives it mechanically — including the product heading, which therefore never double-spaces after an existing boundary. Where the two adapters' bookkeeping had diverged, the engine's exact accounting (trailing-newline counting; boundaries follow the last written stream) is the governed form. The grouping guard's outlaw list extends to hand-emitted boundary newlines, direct console presentation, narration glyphs outside the authority, and `padEnd` alignment, each with exact named protocol exceptions.

**Status**: accepted

## Context

discern's human CLI had several kinds of structured data but no shared presentation contract for their boundaries. Gate plans already carried `PlanStep.group`; the desk already classified rows through `DESK_BUCKETS`; status already computed distinct checkout, gate, landing, and next-action facts. Their writers still received only line-oriented methods. Each renderer either flattened those facts into one run of equally weighted lines or inserted empty strings and prompt separators by hand.

The result was inconsistent and fragile. A long status or improvement report could look like one list. The desk mixed task buckets with navigation actions unless that caller remembered a framework separator. Setup, docs search, and lifecycle summaries each invented their own blank-line mechanics. Colour helped on a terminal but disappeared under `--no-color`, pipes, screenshots, and copied text. Tests could pin one screenshot without enrolling the next renderer that repeated the defect.

Not every output is a report. JSON and Model Context Protocol (MCP) results are protocols; raw or exported docs are documents; crash frames and proof pages carry their own visible structure; project commands and gate jobs stream output they own; shell-facing verbs sometimes emit one scalar value. A universal formatter over those surfaces would corrupt contracts rather than clarify them.

## Decision

**Every transition between semantic groups in discern-managed human presentation goes through a shared grouping surface.** One homogeneous list may remain one group; the rule applies when a view moves from one meaning to another.

The shared vocabulary lives in [`src/shared/result.ts`](../../../src/shared/result.ts):

- `HumanOutputGroup<T>` gives each group a stable, non-rendered `id`, an optional user-facing `label`, and ordered `items`.
- `renderHumanOutputGroups` validates identities, rejects duplicates, removes empty groups, strips caller-owned outer line breaks, and places exactly one empty line between populated text groups. A caller may render a label or request one leading boundary.
- Plans and executed-step results derive group identity and labels from `PlanStep.group`; context and empty-state rows are explicit groups.

The two effectful presentation adapters expose the imperative form. `Out.group(id, label?)` and `Logger.group(id, label?)` add only the missing newline count, so leading and repeated blank boundaries cannot accumulate gaps. Supplying a label draws a ruled heading on the narration stream. A blank boundary is enough when the following block identifies itself; a long report whose contents do not name the group supplies the label. Callers use this form for live narration whose contents cannot be composed before effects run.

Package Heading follows the same ownership rule. A top-level Heading normally uses the package default of one leading line. A Heading nested inside `renderHumanOutputGroups`, an `Out.group` or `Logger.group` run, Markdown, or another populated block passes `leadingBlankLines: 0`; the containing group or document composer supplies the one transition. An unlabeled group has no visible heading to own spacing, so the output layer retains its explicit boundary. Package section rules and status headings are embedded labels and likewise rely on their surrounding group. No caller compensates with a second blank line.

Interactive option lists use `groupedSelectionEntries`. It consumes the same group vocabulary and puts a ruled heading before every populated group, including the first. One empty display row before each heading separates it from the interaction question or preceding option. Task buckets, actions, navigation, docs, scripts, and improvement choices therefore cannot collapse into one framework-owned list.

Existing composed reports use their own semantic data as the authority for membership. Status declares Setup, Checkout, Change, Gate, Landing, Tasks, and Next regions. The desk derives task groups from `DESK_BUCKETS` and keeps desk actions separate. Improvement renders Health, Next action, Areas, each catalog category, logbook findings, and Commands as ruled sections. Setup and docs views name their authored regions; repeated search results and map regions enroll through the collection being rendered.

[`tests/human_output_grouping_test.ts`](../../../tests/human_output_grouping_test.ts) is the class guard. It scans the Git-derived authored TypeScript universe and rejects hand-emitted empty output lines, escaped or doubled-newline writes, joined-line console reports, and direct Cliffy separators outside the shared prompt helper. It also enrolls every imported package Heading alias: an embedded call must request zero leading lines, a nonzero override is illegal, and a direct top-level return may use the default. Its synthetic unrelated functions prove that a new source tree and a future Heading renderer are caught. Shared-renderer tests pin identity validation, boundary counts, and the empty row above ruled headings. Behavior tests pin plan groups, status regions, every desk bucket, and every improvement category returned by the result envelope.

The contract excludes:

- JSON, MCP, schemas, and other machine protocols;
- scalar stdout values intended for shell capture;
- raw, exported, or rendered document bodies and visibly self-structured frames, tables, and proof pages;
- project-owned child-process output and live progress streams.

Those surfaces retain their own protocol or document structure. A surrounding discern report still declares a group before or after one when it changes meaning.

## Consequences

- Human hierarchy survives plain output, screenshots, copy-and-paste, and terminals without colour.
- A new multi-part report must name its groups. Adding a raw empty line or direct prompt separator fails the gate instead of creating another local convention.
- Empty conditional groups disappear without leaving double gaps. Repeated imperative boundaries are idempotent, and a block lacking a final newline still receives one complete empty-line boundary.
- Several human snapshots gain blank lines or ruled labels. JSON, MCP, raw docs, exported docs, scalar outputs, and child-process bytes do not change.
- The lexical detector proves that the shared surface owns each boundary; it cannot prove that a blank line creates enough visual hierarchy. Collection-driven behavior tests require visible labels on long closed-set reports such as improvement. Review still decides whether an otherwise self-labeled block needs a rule.

## Alternatives considered

- **Keep whitespace local and add snapshots for the reported commands.** This fixes instances. It leaves every future renderer free to flatten semantic data or invent another separator, and snapshots multiply across colour, plain, and terminal modes. Rejected.
- **Use Cliffy's separators everywhere.** They structure prompt options only. They cannot group status text, plans, setup reports, or live narration, and direct use would recreate a second presentation authority. Rejected.
- **Infer groups from line count, indentation, or colour.** Length is not meaning, indentation is already used within groups, and colour vanishes on important surfaces. Rejected.
- **Represent every byte of every command as one immutable report tree.** It would make effects, progress, project streams, documents, and scalar protocols pay for a presentation abstraction they do not need. The paired static and imperative surfaces cover the real split with less machinery. Rejected.
