# Orientation

The shape of the system in plain English. Read this tier once and the rest of
the documentation tree slots into place.

Orientation is deliberately small and stable. The subsystem subtrees go deep on
mechanism; this tier exists so you understand _what the pieces are_ and _why the
system is shaped the way it is_ before you read how any one piece works.

---

## What's in here

| Read this                                    | If you want to...                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [concepts.md](concepts.md)                   | Understand the moving parts at a glance — a short narrative tour of the system.           |
| [system-map.md](system-map.md)               | See the architecture as one picture (ASCII).                                              |
| [glossary.md](glossary.md)                   | Look up a specific term. The canonical names live here.                                   |
| [design-principles.md](design-principles.md) | Understand why the system is shaped the way it is — the hard rules every change respects. |

Once you've read these, return to the [docs front page](../README.md) and pick a
subsystem subtree to drill into.

---

## How the orientation tier relates to the rest

- **concepts.md** is the narrative; **glossary.md** is the dictionary;
  **system-map.md** is the picture. They describe the same system at three
  altitudes.
- **design-principles.md** is the constitution. When a subsystem doc explains
  _why_ a thing is done a certain way, it usually traces back to a principle
  here — and any deliberate exception to a principle is recorded as an ADR in
  [`../_adr/`](../_adr/).
- The capitalised canonical nouns defined in the glossary are used verbatim
  everywhere else in the tree. Synonyms are not introduced.
