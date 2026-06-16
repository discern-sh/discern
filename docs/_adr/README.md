# Architecture Decision Records — icculus itself

This directory holds **icculus's own** Architecture Decision Records: short
documents capturing a significant decision about the kit's design, the context
that forced it, and the reasoning behind it.

icculus _ships_ the ADR discipline to the projects it scaffolds
([`templates/docs/_adr/`](../../templates/docs/_adr/)). This directory is
icculus eating its own cooking — recording the decisions behind the engine and
installer here, in the same format.

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
