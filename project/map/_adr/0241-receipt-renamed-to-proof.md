# ADR 0241: The receipt becomes the proof

**Status**: accepted

## Context

Since [ADR 0114](0114-the-gate-emits-the-receipt.md), the gate's minted record — the versioned envelope tying a green run to one exact tree — has been the **receipt**. [ADR 0120](0120-launch-verb-canon.md) reviewed the whole verb surface and left the name standing.

Three pressures reopened it. The brand direction ([ADR 0240](0240-brand-addresses-the-owner.md)) judged "receipt" wrong as a public word: transactional, waste-associated, the slip you discard. Banning a word from marketing while it names the most-shared artifact the product mints splits the vocabulary. The split already exists in the tree: the desk's tips say "passing proof" while the feature canon says receipt — a live synonym pair the one-name-per-concept rule forbids ([ADR 0018](0018-vocabulary-consolidation.md), [ADR 0167](0167-term-registry-polices-the-vocabulary.md)). And v1.0.0 ships the envelope as a signature-ready public contract. After launch the name lives in schemas and git notes ([ADR 0215](0215-landing-receipts-travel-as-git-notes.md)), and a rename becomes the expensive walk-back the verb canon pre-empted. Before launch it costs about an hour.

## Decision

The record is **the proof**. The family serves every register the name must hold:

- the gate **proves** the tree
- a green tree stands **proven**
- ungated work stays **unproven**
- the artifact is **a proof**, plural **proofs**
- the one-line form is the **proof line**

One name everywhere: CLI and MCP surfaces, the result envelope and schemas, the feature canon and glossary, docs, marketing. Per the verb canon's alias policy, no legacy aliases: the retired spelling hard-errors with a one-line redirect naming the successor. The guard matches product surfaces, not English prose.

Two disciplines attach to the word:

- **Proof attaches to the work, never to the worker.** Copy and product strings say "the change lands proven", never "make the agent prove it". The verifier frame retired by [ADR 0240](0240-brand-addresses-the-owner.md) must not re-enter through the new noun.
- **The canonical sense owns the word.** In docs, loose idiomatic uses ("proof that this works") yield to precise alternatives, so the glossary term stays exact.

The explicit noes: "attestation" is not a second name for the artifact — docs may say once that proofs function as attestations for supply chain audiences — and "receipt" survives nowhere as an alias.

## Consequences

- The rename sweep executes pre-launch across engine, schemas, canon, docs, and marketing. The unlanded envelope branch is re-briefed against this record rather than landed and renamed; the owner is coordinating that sequencing.
- The receipt-family decisions take one-line amendment notes when the sweep lands ([ADR 0106](0106-standards-pin-carries-the-gate-receipt.md), [ADR 0112](0112-standard-measurement-receipt.md), [ADR 0114](0114-the-gate-emits-the-receipt.md), [ADR 0116](0116-receipts-vouch-only-for-the-pinned-tree.md), [ADR 0188](0188-the-receipt-relays-as-one-line.md), [ADR 0215](0215-landing-receipts-travel-as-git-notes.md)). The notes follow the verb canon's pointer-refresh discipline, and their reasoning stays intact. [ADR 0120](0120-launch-verb-canon.md)'s line keeping the receipt name carries its amendment note now.
- The desk's "passing proof" strings become canonical instead of divergent.
- Marketing gains the artifact word: "you don't ship trust, you ship proof" now names the thing the product mints.
- "Proof" is common in technical prose, so holding the canonical sense costs ongoing editorial attention — the accepted price of a name that works in every register.

## Alternatives considered

- **hallmark** — the richest story: assaying is the same conceptual system as standards (a declared standard, an independent test, a mark struck on the artifact), and it verbs well ("hallmarked at green"). Rejected: for much of the audience the dominant association is the American greeting-card company, and the everyday idiom ("a hallmark of good design") would make canon discipline expensive.
- **attestation** — precise, and the supply chain ecosystem's own term (in-toto, SLSA). Rejected as the product noun: corporate-cold on marketing surfaces and clunky at a prompt. One compatibility sentence in docs captures the value.
- **seal · stamp · warrant · certificate** — each fails a register: "sealed" reads as closed; a stamp is approval without scrutiny; a warrant threatens; a certificate smells of X.509.
- **Keeping receipt** — plain, and internet vernacular ("bring the receipts") even means evidence. Rejected: the primary sense stays transactional, the brand may not lean on the word, and a name marketing cannot speak splits the canon the moment proofs reach shared surfaces.
