## Documentation & decisions

This project keeps a documentation tree under `docs/`, browsable with **`icculus
docs`** (a target argument opens a specific page; `--list` prints the table of
contents). Keep the docs current with the code: when you change documented
behaviour, update the matching page in the same change — a stale doc is a bug.

Significant or hard-to-reverse decisions are recorded as **Architecture Decision
Records** under `docs/_adr/` (numbered `0001+`). When you make a notable design
choice — especially one that overturns an earlier decision or accepts a surprising
trade-off — add an ADR capturing the decision and why. Cross-link an ADR that
supersedes an earlier one in both directions.
