# ADR 0141: ADR citations take one strippable form and strip at render time

**Status**: accepted

## Context

The map cites its decision records densely — that density is what lets a repo agent surface "we decided against that ([ADR NNNN])" mid-task, and thinning it would make every future session dumber. But the docs site launches from the same tree, and citation density is a poor reading experience for humans: launch-readiness reviews flagged pages where parenthetical record numbers interrupt every second sentence.

The insight from the decision session: citation density was only ever a _reader_ problem, not an _author_ problem. So density becomes a render-time concern, not an editorial one — provided every citation takes a form a machine can remove without damaging the sentence around it. Citations written as grammatical subjects ("per ADR 0074, the file is co-owned") cannot be stripped; citations appended to the clause they support can.

## Decision

Every ADR reference in published-tier prose takes ONE normalized form: a parenthetical group of linked citations at clause end — `([ADR 0110](../_adr/0110-the-landing-model.md))`, comma-separated when a clause cites several records. The invariant the form buys, and the test the gate enforces (`tests/adr_citation_form_test.ts`): **prose reads correctly with the citation deleted**. Bare `(ADR NNNN)` text, citations woven in as grammatical subjects, and number/destination mismatches fail `discern done`. Agents keep citing as liberally as reasoning requires, forever.

One stripper in the doc model (`stripAdrCitations`) removes the groups from human-rendered prose; one collector (`collectAdrCitations`) gathers each page's cited records onto the entry (`DocEntry.citedAdrs`) so human surfaces can present them separately (a related-decisions footer, a structured `cited_adrs` field). The surface split:

- **Stripped** (human eyes): site HTML, terminal `discern help`, MCP `discern_help` content.
- **Retained** (agent/machine consumers): the map on disk, `discern map` content, raw `.md` editions, `--raw`, exports, and llms surfaces — their consumers benefit from the citations exactly as repo agents do.

Unpublished tiers and `_private` carry no render contract and are exempt from the form. The existing law stands unchanged: documentation may cite decisions; the product's own output may not (`tests/adr_vocab_guard_test.ts`).

## Consequences

- Human-rendered pages read clean with zero editorial upkeep; per-page claim-to-decision traceability survives through the collected citations.
- The published tiers were normalized once (76 sites) to seed the invariant; every future page holds it or fails the gate.
- Authors accept a small grammatical discipline: a citation may never carry the sentence. Where a record IS the subject ("this decision is recorded in…"), the sentence must name the topic in words and cite at the end.
- The stripper only removes the normalized form — the gate is what guarantees nothing else exists in published prose, so the two mechanisms must ship and hold together.
