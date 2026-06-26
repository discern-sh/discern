---
name: delegate-task
description: Turn the change you've been discussing into a complete, self-contained prompt for a fresh agent to carry out in its own worktree — then review the result adversarially when it lands. Use when the user wants to delegate, hand off, or spin off a task to a new, separate, or clean agent session, asks you to "write a prompt for another agent", or to "kick this off in a fresh worktree".
---

# Delegate a task to a fresh agent

Handing a task to a clean session is one of discern's sharpest tools — an isolated worktree, an uncluttered context window, and, when you review what comes back, a second independent pass over the same problem. But a delegated agent is only as good as its prompt. It cannot see this conversation; it wakes with nothing but the prompt you write plus whatever lives in the project's own files. A vague brief becomes vague work, in a worktree you then have to go and find.

This skill turns the change you've been discussing into a brief that stands entirely on its own, hands it off, and closes the loop — because delegation isn't done when the prompt is sent, it's done when the result has been checked by someone treating it as the work's first adversary rather than its author.

---

## 1. Pin down exactly what you're delegating

Before writing a word, make the task unambiguous — the fresh agent can't ask you what you meant. From the conversation so far, settle three things:

- **The goal** — the single outcome that means *done*, stated as a result, not an activity.
- **The shape of the work** — the concrete changes you expect, and anything the discussion already ruled in or out.
- **The unknowns** — anything still undecided. Resolve it with the user *now*, or name it in the prompt as a decision the agent must make and justify. A silent gap is the most expensive thing you can leave: a fresh agent fills gaps with guesses, and you won't see the guess until you review.

If the discussion was loose, ask the user the one or two questions whose answers would otherwise become the fresh agent's wrong assumptions.

---

## 2. Write a prompt that stands on its own

The cardinal rule: **assume the new agent knows nothing of this conversation.** Everything that mattered here and isn't already plain from the project's own files must be restated. The shared project context — the guidance files, the docs — it can read for itself, so *point* it at the parts that matter rather than trusting it to find them; but any conclusion the two of you reached that the code does not record, you must write down again. It is gone otherwise.

Give the prompt a clear spine. Adapt the headings to the task, but cover:

- **Title and one-line goal** — what this achieves, in a sentence.
- **Orient first** — have it begin by orienting (`discern_status`, or `discern status`) and reading the project's guidance file before it edits anything.
- **Background — why this, why now** — the context you hold and it doesn't: the problem, what's true today, what made the change worth doing. Usually the part only you can supply, and the part most often skipped.
- **Deliverables** — the concrete, ordered changes. For each, say *what* and *where*, and name an existing thing to mirror for house style ("model it on X"). Real anchors — files, tests, patterns — are the difference between aimed work and a wander.
- **Constraints** — the rules it must hold to (see §3).
- **Out of scope** — what *not* to touch. Naming the non-goals prevents scope creep as reliably as the goals direct the work.
- **Definition of done** — a short, falsifiable checklist: "the gate is green and X, Y, Z hold," never "it works."

Anchor the prompt in the real tree, then tell the agent to **verify those anchors against the live code** — files move, and a brief written from this conversation can be stale by the time someone runs it.

---

## 3. Bake in what every delegated task needs

A handful of constraints hold for any task in any discern project. Fold them in so the fresh agent inherits them rather than rediscovering them:

- **The gate is the bar for done** — it must run the full quality gate (`discern finish`, or the `discern_finish` tool) to green before calling the work complete, iterating with the fast loop (`discern prepare`) and fixing from the reported diagnostics.
- **Commit atomically** — one logical step per commit, clear messages, so the result reviews cleanly step by step.
- **Never hand-edit generated files** — change the source and re-run the producing command; the gate flags drift either way.
- **Fix the class, not the instance** — a real fix leaves behind a check that fails on the whole class of defect (the `fix-a-bug-class` skill is the procedure).
- **Record notable decisions** — a hard-to-reverse or surprising choice deserves an ADR (the `write-adr` skill).

Keep this to a few lines — the agent's own guidance file already states most of it. You are reinforcing the ones *this* task leans on, not re-teaching the rules.

---

## 4. Splitting the work across several agents (optional)

If what you're delegating is really several independent pieces, write **one prompt per piece** and let the user launch each in its own worktree — isolation by design, so parallel efforts never collide. Split only on genuine seams: each prompt must own a disjoint slice with no files in flight shared with another, or two agents will edit the same lines and you'll merge a mess. State each one's boundary in its own prompt.

That kind of fan-out is just the user launching several sessions — always available. Telling a *single* delegated agent to spawn its own sub-agents is different: not every agent can run sub-agents. If parallelism inside one prompt would genuinely help, phrase it as an option conditioned on support, never a hard instruction.

---

## 5. Hand it off

Present the finished prompt as one self-contained block the user can copy verbatim — clearly delimited, complete top to bottom, nothing left for them to fill in by hand (offer to save it to a file if they'd rather). Then explain how it runs: launched as a **new session, it starts on a fresh `agent/` branch in its own worktree**, isolated from your current work. (If you can launch that session or worktree directly yourself and the user would prefer it, offer — but handing the prompt over is the default.)

---

## 6. Offer to review the result — adversarially

Say so now, while it's cheap to promise: **when the agent is done, have the user give you the branch or worktree name, and you'll review it.** That second independent pass is half of why delegating is worth doing — don't let it lapse into a rubber stamp.

When the work returns, review it as its adversary, not its author — assume it falls short until the evidence says otherwise:

- **Read the diff, not the summary** — the branch's diff against the trunk (`git diff main...<branch>`) and the changed files (find the branch via `discern status` if you need to). Review **read-only**: never start working inside a worktree you didn't create.
- **Hold it to the prompt** — walk every deliverable and the definition of done. Was each one actually done, or only reported done? What was skipped, half-finished, or quietly added beyond scope?
- **Verify green, don't trust it** — confirm the gate actually passes against the branch (from its own worktree, or a checkout of it), and hold the ratchets if the change touches them.
- **Hunt the known failure modes** — the instance fixed but not the class; a test loosened to pass; a generated file hand-edited; a decision made silently that warranted an ADR; scope creep past what you asked for.

Report what you find plainly — what stands, what needs another pass — and feed any real defect back as the next task (delegated the same way, if that fits).

---

## Done when

- The task is pinned down — goal, shape, and every unknown either resolved or explicitly handed to the agent to decide.
- A **self-contained** prompt exists that assumes no memory of this conversation, carrying title, orientation, background, deliverables, constraints, out-of-scope, and a falsifiable definition of done.
- The standing project constraints (the gate as the bar, atomic commits, no hand-editing generated files) are baked into it.
- The user has it as a copyable block and knows that launching it spins up a fresh worktree.
- You've committed to reviewing the result, and know to ask for the branch or worktree name when it's ready.
