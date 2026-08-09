---
name: discern-clear-the-decks
description: Clear the decks — sweep out the clutter agent-built codebases accumulate, the stack-agnostic agentic smells — duplicated helpers, dead code from abandoned approaches, one-caller indirection, leftover scaffolding, convention drift. Every cut proven safe, landed as small behaviour-preserving commits, with the entropy capped by a standard so the mess can only shrink. Use when asked to clean up, tidy, simplify, or de-slop a codebase, to remove dead code or duplication, when a project "is getting messy" after many agent sessions, or as periodic maintenance between features. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Clear the decks — before the clutter teaches the next session to make more

## Operational contract

```toml
effectful = true
cross_worktree = false
authority_sensitive = true
relay_bearing = true
recoverable = true
targets = ["stable: the current worktree's declared cleanup scope", "stable: the evidence-backed candidate worklist"]
sequence = ["act: enumerate candidates and prove each cut against dynamic reachability", "act: commit each behavior-preserving cut and cap the improved metric", "verify: run the full gate on the final committed tree"]
stop_conditions = ["A candidate cannot be proven dead or equivalent.", "A living wrong pattern requires a migration outside the cleanup scope.", "The cleanup would loosen or move a Standard."]
recovery = ["A cut changes behavior or fails its focused checks. => Revert that atomic cut and keep the candidate with its evidence.", "The metric change is intrinsic to required work. => Relay the measured breach and leave the limit unchanged."]
authority = "The cleanup request covers behavior-preserving cuts in scope; a broader migration, a consequential deletion, or landing needs the owner's explicit or recorded authority."
authority_check = "command: `discern accept` re-verifies landing authority against the final changed paths."
relay_message = "I removed <cuts> with <evidence>. <standard> holds the improved metric. I left <residual>. <proof>"
relay_facts = ["cuts", "evidence", "standard", "residual", "proof"]
```

Codebases built through agent sessions accumulate clutter in a recognizable way. Each session adds a little: a helper written because the existing one wasn't found, scaffolding left by an abandoned approach, a wrapper that seemed prudent and gained exactly one caller, a debug print that outlived the debugging. No single session made a mess; the mess is the _sum_. And it compounds, because agents write code by pattern-matching the code around it — every duplicated helper teaches the next session that duplication is house style. The clutter is not a cosmetic problem: it is the substrate every future session builds on, quietly degrading.

This skill is the systematic sweep: know the signatures, enumerate them with structure rather than eyes, prove every cut safe before making it, land the clearing in small behaviour-preserving commits, and — the actual point — cap the entropy with a standard so the number can never quietly climb back.

---

## 1. Know the clutter signatures

Sweep for these shapes — they recur in every language and domain:

- **Duplicated helpers** — two pieces of code doing the same job under different spellings, because a session wrote what it couldn't find.
- **Dead ends** — unreferenced files, exports, branches, and configuration left behind by approaches that were started and abandoned.
- **One-caller indirection** — the wrapper with a single caller, the interface with a single implementation, the layer that only forwards: flexibility nothing ever asked for.
- **Leftover scaffolding** — debug output, commented-out blocks, placeholder names, TODOs describing work since finished.
- **Convention drift** — three names for one concept, competing idioms for one operation; each a fork the next session must guess between.
- **Stale references** — comments and docs describing code that no longer exists.

## 2. Enumerate with structure, and keep a worklist

Find instances by their shape, not their spelling — the same rule that governs `discern-cure-a-bug`. Reach for what the project's stack offers: dead-code detection, unused-export analysis, reference counts, structural or AST-aware search for duplicates that share a shape but no token. A text search is a starting hint, never the enumeration. Walk the tree subsystem by subsystem, recording each candidate with its evidence (what it is, why it looks prunable, what says so) in a running worklist — the pass stays interruptible and resumable, and the worklist becomes the report.

## 3. Prove each cut safe — adversarially

An over-eager sweep does more damage than the clutter ever did, so reverse the burden of proof: a candidate stays until _you_ prove it dead. The classic false kill is **dynamic reachability** — code reached by reflection, string-keyed lookup, configuration-named entry points, serialized names, or callers outside the repo entirely (a published interface, a deploy script, a scheduled job). Hunt for those before deleting anything a plain reference count calls unused; the project's change history helps too (`discern coupling <file>` names the files that historically change with it — a live co-change partner is a hint the "dead" code isn't).

For duplicates, apply the essential/incidental test before merging: **essential** duplicates are one decision spelled twice — merge them into the better spelling. **Incidental** look-alikes merely resemble each other today and have independent fates — merging those manufactures the very one-caller abstraction you came here to remove. When unsure, leave it standing and record why.

## 4. Cut small, keep it green

Cut in atomic, behaviour-preserving commits — one candidate or one tight cluster per commit — running the fast loop between cuts and the full gate on the final tree. The tree must do exactly what it did before, minus the weight; the suite passing after every cut is the evidence. Cutting small is what makes mistakes cheap: a wrong cut reverts alone instead of unwinding an afternoon.

## 5. Cap the entropy with a standard

The sweep is relief; the ceiling is the cure. Pick the metric your clearing actually moved and that the project can count mechanically — dead exports, duplicated blocks, total lines, suppression or TODO count — and set it as a ceiling at the new, lower value (`discern-set-the-standard` is the procedure). From then on the clutter can only shrink: a change that regrows it fails the standard and must justify itself, and the next sweep starts from here instead of rediscovering this one.

## 6. Report the standing candidates

Close with what you did **not** cut, and why: couldn't prove it dead, genuinely load-bearing, risk outweighs the weight. A clean-up that reports only its kills looks thorough while claiming nothing checkable — the residual list is what makes "the codebase is clean" a falsifiable claim, and it seeds the next sweep's worklist.

One escalation to watch for: if the sweep keeps surfacing the same _living_ pattern — not dead, but everywhere and wrong — that is not clean-up, it is a migration. Hand it to `discern-set-the-standard`'s outlaw procedure, which makes a pattern illegal and standards it to zero.

---

## Done when

- the tree was swept **signature by signature, with structural tools and a recorded worklist** — resumable and reported, never "I looked around";
- every deletion was **proven dead against dynamic reachability**, and every merge passed the essential/incidental test — no cut on a reference count's word alone;
- the clearing landed as **small behaviour-preserving commits**, with the gate green on the final tree;
- at least one entropy metric is **protected at its new value by a standard**, so the clutter can only shrink from here;
- the report lists the **standing candidates and the reasons they stand** — a falsifiable claim of cleanliness, and the seed of the next sweep.
