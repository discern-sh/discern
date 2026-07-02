---
name: discern-document-subsystem
description: Write or refresh a subtree of the configured documentation tree for one subsystem (its README plus leaves), following the project's documenter brief. Use when the user says "document the X subsystem", "write the docs for X", "refresh the X docs", "the docs for X are stale", or after a change that altered a subsystem's documented behaviour. Can fan out one documenter per subsystem to do several at once. Bundled with discern.
---

# Document a subsystem

First read `[docs].dir` from `discern.toml`; call that project-relative path
`<docs-dir>`. This skill produces or refreshes one subtree there — a subsystem's
`README.md` and its leaf docs — so the documentation tree keeps describing what
the code actually does.

**The method lives in `<docs-dir>_internal/documenter-agent-brief.md`.** That
brief is the constant — read-first order, audience contract, per-doc template,
hard rules, deliverable.

> Keep what you write present-tense and grounded in the code — describe only what exists. Outstanding work goes in [`TODO.md`](/TODO.md), not the docs.

---

## 1. Confirm the prerequisites

**If `<docs-dir>_internal/documenter-agent-brief.md` doesn't exist yet**, create
the `_internal` scaffolding from this skill's skeleton first: copy this skill's
own `skeleton/docs/_internal/` directory to `<docs-dir>_internal/`.

The brief assumes the orientation tier already exists under
`<docs-dir>00-orientation/`. If those files are still skeletons, run
`discern setup` first.

Identify the target subtree (e.g. `30-<subsystem>/`). If the user named a subsystem rather than a path, map it to its numbered subtree.

## 2. Write (or refresh) the scope manifest

Each subtree is documented against a **scope manifest** at
`<docs-dir>_internal/scopes/<NN-subsystem>.md`.

- If a manifest for this subtree doesn't exist, copy
  `<docs-dir>_internal/scopes/_template.md` and fill it. **Verify every source
  path exists** before relying on it.
- If one exists, reconcile it with the current code (files move, areas shift) before documenting.

A good manifest is what keeps the doc accurate and stops two documenters from colliding.

## 3. Document the subtree, following the brief

Hand the documenter the brief plus this subtree's scope manifest, and produce every file the manifest lists — the `README.md` (≈250 words, plain language, ends with a table of leaves) and each leaf (400–800 words, precise, file-pathed, per the brief's template). Honour the brief's hard rules: real names only, verified paths, no modal verbs about the system, relative links inside the configured docs tree, the length ceiling, a "Current state & gotchas" section that quotes real TODO/FIXME comments.

**Refreshing rather than writing fresh?** Update only what drifted — re-read the source, fix stale claims and paths, keep wording the manifest says to preserve. Don't rewrite a sound doc for its own sake.

### Doing several subsystems at once (optional)

The tree was designed to be built by a small fleet — one documenter per subtree,
in parallel, after a single skeleton-and-orientation pass. Keep each agent
strictly inside its own `<docs-dir><subtree>/`.

## 4. Collect the deliverable and reconcile

Each documenter returns a short summary (per the brief): what it covered, preserved TODO/FIXME notes, glossary additions to fold in, subtree-overlap observations, and deprecation candidates. Acting as the orchestrator:

- Fold genuine **glossary additions** into
  `<docs-dir>00-orientation/glossary.md`.
- Resolve any **overlap** a documenter flagged: assign the contested code to exactly one subtree and link from the other.
- Add the cross-**subtree** links the brief deferred to this polish phase (intra-subtree links are already in place; inter-subtree ones are added now).
- Record any **deprecation candidates** worth tracking in [`TODO.md`](/TODO.md).

---

## Done when

The target subtree's `README.md` and every leaf its manifest lists exist (or are refreshed), follow the brief's template and rules, link correctly, and describe only what the code currently does — with glossary additions folded in and any flagged overlaps resolved.
