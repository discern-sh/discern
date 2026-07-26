# ADR 0187: tidy checks diagram geometry in the Markdown it formats

**Status**: accepted

## Context

The bundled skeleton asks each project's setup agent to draw the system map as an ASCII diagram, and agents keep editing fenced diagrams as prose: borders drift, columns shift, junctions detach. No formatter can repair this — formatters skip fence bodies, and the embedded Markdown formatter keeps them byte-for-byte — so diagram geometry had no owner in any project. This repository cured its own instance with a repo-wide sweep (`tests/diagram_geometry_test.ts`), but a guard in this repository's test suite ships to nobody.

## Decision

`discern tidy` scans every Markdown target it formats with the shared scanner (`src/lib/diagram_geometry.ts`): inside any fenced block containing a corner or junction glyph, vertical connections must be reciprocated (label text anchors a line; space does not) and arrowheads must sit on their shafts. Findings fail the result under `diagrams_misaligned`, one diagnostic per glyph with file, line, and column. Formatting writes still apply, so the tree converges while the run fails. A fence whose info string carries `freeform` is exempt.

tidy does not redraw diagrams. Two misaligned borders admit more than one faithful repair, so an auto-fix would guess at intent; the check names the glyph and leaves the fix with the author.

## Consequences

- Every project with `discern tidy` in its format job gets the check on upgrade, with no configuration. A map whose diagrams were already broken fails its next gate run at the fix stage with per-glyph pointers — the intended surfacing, and cheap while discern has no installed base.
- The repo-wide sweep and tidy import one scanner module, so this repository's gate and the shipped check cannot disagree about what "aligned" means.
- Deliberate character art needs the `freeform` tag; the failure message names it.
- The scanner's tolerances (label anchoring, corner-triggered fences, arrowhead point-facing) are the compatibility contract with real diagram idioms; tightening them is a behavior change for every project and deserves its own record.
