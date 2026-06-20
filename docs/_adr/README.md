# Architecture Decision Records — icculus itself

This directory holds **icculus's own** Architecture Decision Records: short
documents capturing a significant decision about the kit's design, the context
that forced it, and the reasoning behind it.

icculus _ships_ the ADR discipline to the projects it scaffolds
([`templates/docs/_adr/`](../../templates/docs/_adr/)). This directory is
icculus applying that discipline to itself — recording the decisions behind the
engine and installer here, in the same format.

**The canonical ADR format is the one icculus ships:**
[`templates/docs/_adr/README.md`](../../templates/docs/_adr/README.md), with the
copy-paste template at
[`templates/docs/_adr/0000-template.md`](../../templates/docs/_adr/0000-template.md).
Read it before drafting. In brief: number continuously (`NNNN-slug.md`, first
real ADR is `0001`); state the decision in the title; write one only when the
decision is hard to reverse, surprising without context, and a real trade-off.

## Index

- [0001 — Project-owned recipes](0001-project-owned-recipes.md)
- [0002 — First-class side-gates](0002-first-class-side-gates.md)
- [0003 — Named metric ratchets](0003-named-metric-ratchets.md)
- [0004 — Structured `finish --json`](0004-structured-finish-json.md)
- [0005 — Declarative config](0005-declarative-config.md)
- [0006 — Long-slot ergonomics](0006-long-slot-ergonomics.md)
- [0007 — Adapter contract](0007-adapter-contract.md)
- [0008 — Declarative managed-set](0008-declarative-managed-set.md)
- [0009 — 1.0: drop backward compatibility](0009-one-point-zero-drop-backward-compat.md)
- [0010 — Self-host the harness](0010-self-host-the-harness.md)
- [0011 — Adopt the worktree workflow](0011-adopt-worktree-workflow.md)
- [0012 — Engine noglob (`set -f`) by default](0012-engine-noglob-default.md)
- [0013 — Product vocabulary in user-facing output](0013-product-vocabulary-in-user-output.md)
- [0014 — A versioned, reversible migration system](0014-versioned-migration-system.md)
- [0015 — `icculus docs` browser + terminal Markdown renderer](0015-docs-browser.md)
- [0016 — Consolidate the install surface under `.icculus/`](0016-consolidate-install-surface.md)
- [0017 — Declare capabilities, derive the gate](0017-capabilities-model.md)
- [0018 — Consolidate the harness vocabulary into four layers](0018-vocabulary-consolidation.md)
- [0019 — Collapse into one binary with a TypeScript-native engine](0019-single-binary-ts-engine.md)
